// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the reference main process (`_reference/main.js`) and preload bridge
// (`_reference/preload.js`) in Node with a fake `electron` module. The IPC
// handlers are the real ones; only Electron itself is replaced.

import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { REF_DIR, readRef } from './reference.mjs';

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
          sender: { send: (ch, payload) => sent.push({ ch, payload: structuredClone(payload) }) },
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
 * Creates a throw-away app folder (`<tmp>/app/data`, with `bin/` and `include/`
 * linked to the reference) and loads main.js + preload.js against it.
 * Returns { appDir, dataDir, rtti (the window.rtti bridge), invoke, sent, dispose }.
 */
export function startMainProcess({ tmpRoot } = {}) {
  const root = fs.mkdtempSync(path.join(tmpRoot ?? os.tmpdir(), 'maatwerk-ref-'));
  const appDir = path.join(root, 'app');
  const userDataDir = path.join(root, 'userData');
  fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
  fs.mkdirSync(userDataDir);
  for (const dir of ['bin', 'include']) {
    fs.symlinkSync(path.join(REF_DIR, dir), path.join(appDir, dir), 'junction');
  }
  const { electron, handlers, sent } = fakeElectron({ userDataDir });
  runCjs('main.js', { dirname: appDir, electron });
  runCjs('preload.js', { dirname: REF_DIR, electron });
  const rtti = electron.exposed.rtti;
  return {
    root,
    appDir,
    dataDir: path.join(appDir, 'data'),
    rtti,
    handlers,
    invoke: (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args),
    sent,
    dispose: () => {
      // Remove junctions first so rmSync never follows them into _reference/.
      for (const dir of ['bin', 'include']) fs.rmSync(path.join(appDir, dir), { force: true });
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
