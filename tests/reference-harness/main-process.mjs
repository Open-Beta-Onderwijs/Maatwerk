// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the reference main process (`_reference/main.js`) and preload bridge
// (`_reference/preload.js`) in Node with a fake `electron` module. The IPC
// handlers are the real ones; only Electron itself is replaced.

import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { REF_DIR, REPO_ROOT, readRef } from './reference.mjs';

function fakeElectron({ userDataDir }) {
  const handlers = new Map();
  const listeners = new Map();
  const sent = [];
  const electron = {
    app: {
      isPackaged: false,
      // Never ready: startup work (seeding, watcher, window) is not wanted in tests.
      whenReady: () => new Promise(() => {}),
      on: () => {},
      quit: () => {},
      getPath: (name) => {
        if (name !== 'userData') throw new Error(`fake electron: getPath(${name})`);
        return userDataDir;
      },
    },
    BrowserWindow: class {
      static getAllWindows() {
        return [];
      }
      static fromWebContents() {
        return null;
      }
    },
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
    },
    shell: { openPath: async () => '' },
    dialog: {},
    clipboard: {},
    nativeImage: {},
    contextBridge: {
      exposeInMainWorld: (key, api) => {
        electron.exposed[key] = api;
      },
    },
    ipcRenderer: {
      // Arguments and results cross a structured-clone boundary, as in Electron.
      invoke: async (channel, ...args) => {
        const fn = handlers.get(channel);
        if (!fn) throw new Error(`No handler registered for '${channel}'`);
        const event = {
          sender: {
            send: (ch, payload) => sent.push({ ch, payload: structuredClone(payload) }),
            isDestroyed: () => false,
          },
        };
        return structuredClone(await fn(event, ...structuredClone(args)));
      },
      on: (ch, fn) => listeners.set(ch, fn),
      removeListener: (ch) => listeners.delete(ch),
    },
    exposed: {},
  };
  return { electron, handlers, sent };
}

/** Evaluates a CommonJS reference file with a custom `require` and `__dirname`. */
function runCjs(relFile, { dirname, electron, extraModules = {} }) {
  const filename = path.join(REF_DIR, relFile);
  const realRequire = createRequire(filename);
  const localRequire = createRequire(import.meta.url);
  const req = (id) => {
    if (id === 'electron') return electron;
    if (id in extraModules) return extraModules[id];
    if (id === 'pdf-lib') return localRequire('pdf-lib');
    return realRequire(id);
  };
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(Module.wrap(readRef(relFile)), { filename });
  wrapper.call(module.exports, module.exports, req, module, filename, dirname);
  return module.exports;
}

/**
 * Directory listings in the order NTFS returns them (ordinal, case-insensitive).
 * `fs:readAllJson` returns files in readdir order and the Store keeps that order
 * (e.g. which of two groups a student gets, quirk B31), so it is pinned like the
 * clock and the locale. MAATWERK_READDIR_REVERSE=1 reverses the raw listing
 * first, to prove the pin works (tests/reference-harness/harness.test.mjs).
 */
export function ntfsOrder(entries) {
  const name = (e) => (typeof e === 'string' ? e : e.name);
  const raw = process.env.MAATWERK_READDIR_REVERSE === '1' ? [...entries].reverse() : [...entries];
  return raw.sort((a, b) => {
    const x = name(a).toUpperCase();
    const y = name(b).toUpperCase();
    if (x !== y) return x < y ? -1 : 1;
    return name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0;
  });
}

/**
 * Maatwerk's bundled emoji font. The goldens record the reference with this font
 * in `include/fonts` instead of the system's Segoe UI Emoji (quirk T2), so they
 * do not depend on the machine.
 */
export const EMOJI_FONT = path.join(
  REPO_ROOT,
  'crates',
  'maatwerk-core',
  'assets',
  'fonts',
  'NotoColorEmoji-COLRv1.ttf',
);

/**
 * Links `bin/` and every entry of `include/` except `fonts/` to the reference
 * (junctions); `include/fonts/` is a copy of the reference fonts plus EMOJI_FONT.
 */
function linkReference(appDir) {
  fs.symlinkSync(path.join(REF_DIR, 'bin'), path.join(appDir, 'bin'), 'junction');
  const include = path.join(appDir, 'include');
  fs.mkdirSync(include);
  for (const entry of fs.readdirSync(path.join(REF_DIR, 'include'))) {
    if (entry === 'fonts') continue;
    fs.symlinkSync(path.join(REF_DIR, 'include', entry), path.join(include, entry), 'junction');
  }
  const fonts = path.join(include, 'fonts');
  fs.cpSync(path.join(REF_DIR, 'include', 'fonts'), fonts, { recursive: true });
  fs.copyFileSync(EMOJI_FONT, path.join(fonts, path.basename(EMOJI_FONT)));
}

/** Unlinks the junctions of linkReference, so rmSync never follows them into _reference/. */
function unlinkReference(appDir) {
  fs.rmSync(path.join(appDir, 'bin'), { force: true });
  const include = path.join(appDir, 'include');
  let stat;
  try {
    stat = fs.lstatSync(include);
  } catch (_) {
    return;
  }
  // Runs from before include/fonts was a copy linked include/ itself.
  if (stat.isSymbolicLink()) return fs.rmSync(include, { force: true });
  for (const entry of fs.readdirSync(include)) {
    if (entry !== 'fonts') fs.rmSync(path.join(include, entry), { force: true });
  }
}

/** Removes leftovers of killed runs; junctions are unlinked before the folder. */
function sweepStale(tmp) {
  const dayAgo = Date.now() - 86_400_000;
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('maatwerk-ref-')) continue;
    const root = path.join(tmp, name);
    try {
      if (fs.statSync(root).mtimeMs > dayAgo) continue;
      unlinkReference(path.join(root, 'app'));
      fs.rmSync(root, { recursive: true, force: true });
    } catch (_) {
      // Another run may own it; leave it.
    }
  }
}

/**
 * Creates a throw-away app folder (`<tmp>/app/data`) and loads main.js +
 * preload.js against it. With `typst: true`, `bin/` and `include/` are linked
 * to the reference so the Typst handlers find the CLI and templates, with
 * EMOJI_FONT added to `include/fonts/` (linkReference).
 * Returns { appDir, dataDir, rtti (the window.rtti bridge), invoke, sent, dispose }.
 */
export function startMainProcess({ tmpRoot, onWrite, typst = false } = {}) {
  const tmp = tmpRoot ?? os.tmpdir();
  sweepStale(tmp);
  const root = fs.mkdtempSync(path.join(tmp, 'maatwerk-ref-'));
  const appDir = path.join(root, 'app');
  const dispose = () => {
    unlinkReference(appDir);
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    const userDataDir = path.join(root, 'userData');
    fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
    fs.mkdirSync(userDataDir);
    if (typst) linkReference(appDir);
    const { electron, handlers, sent } = fakeElectron({ userDataDir });
    // main.js gets an fs whose readdirSync has a pinned order and whose
    // writeFileSync reports to onWrite (Typst wrappers, preview copies).
    const mainFs = {
      ...fs,
      readdirSync: (...args) => ntfsOrder(fs.readdirSync(...args)),
      writeFileSync: (file, data, ...rest) => {
        onWrite?.(String(file), data);
        return fs.writeFileSync(file, data, ...rest);
      },
    };
    runCjs('main.js', { dirname: appDir, electron, extraModules: { fs: mainFs } });
    runCjs('preload.js', { dirname: REF_DIR, electron });
    return {
      root,
      appDir,
      dataDir: path.join(appDir, 'data'),
      rtti: electron.exposed.rtti,
      handlers,
      invoke: (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args),
      sent,
      dispose,
    };
  } catch (e) {
    dispose();
    throw e;
  }
}
