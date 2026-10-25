// SPDX-License-Identifier: AGPL-3.0-or-later
// Lock files and the JSON read/write/delete IPC handlers of `_reference/main.js`.
// Blocks between @verbatim and @end are copied unchanged from the reference app at
// commit 0e30a70 (docs/reference/VERSION.md); the rest is glue.
// Do not edit by hand: regenerate with `node tests/reference-harness/make-shims.mjs`.
/* eslint-disable */
const path = require('path');
const fs = require('fs');
const { hashContent, readWithHash, writeFileAtomic } = require('./sync.cjs');

// One instance per simulated app: `dataDir` replaces getDataDir() (main.js:22-26),
// `watcher` is the createWatcher() result or null, handlers are called as invoke().
function createMainStorage({ dataDir, watcher = null }) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const getDataDir = () => {
    fs.mkdirSync(dataDir, { recursive: true });
    return dataDir;
  };
// @verbatim main.js:31-48
const LOCK_TTL_MS = 10000;

function acquireLock(filePath) {
  const lockPath = filePath + '.lock';
  if (fs.existsSync(lockPath)) {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < LOCK_TTL_MS) return false;
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath, String(Date.now()));
  return true;
}

function releaseLock(filePath) {
  try {
    fs.unlinkSync(filePath + '.lock');
  } catch (_) {}
}
// @end
// @verbatim main.js:54-121
// Read any JSON file relative to the data directory.
// relPath: e.g. 'config.json', '2025-2026/students.json', '2025-2026/scores/105455.json'
ipcMain.handle('fs:readJson', (_event, relPath) => {
  const filePath = path.join(getDataDir(), relPath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error('readJson error:', filePath, e.message);
    return null;
  }
});

// Read a JSON file together with the hash of its content, for compare-and-swap writes.
// Returns { data, hash } (both null if the file does not exist) or { error } if it
// exists but cannot be parsed — callers must not overwrite such a file.
ipcMain.handle('fs:readJsonVersioned', (_event, relPath) => {
  const filePath = path.join(getDataDir(), relPath);
  try {
    const file = readWithHash(filePath);
    if (!file) return { data: null, hash: null };
    return { data: JSON.parse(file.buf.toString('utf8')), hash: file.hash };
  } catch (e) {
    console.error('readJsonVersioned error:', filePath, e.message);
    return { error: e.message };
  }
});

// Write any JSON file relative to the data directory (atomically).
// Score files (inside a 'scores' folder) skip locking; everything else is locked.
// opts.cas: only write if the file's current hash equals opts.expectedHash
// (null = the file must not exist yet); otherwise returns reason 'conflict'.
ipcMain.handle('fs:writeJson', (_event, relPath, data, opts = {}) => {
  const filePath = path.join(getDataDir(), relPath);
  const isScore = relPath.includes('/scores/');

  const write = () => {
    if (opts.cas) {
      const current = readWithHash(filePath);
      if ((current?.hash ?? null) !== (opts.expectedHash ?? null)) {
        return { ok: false, reason: 'conflict' };
      }
    }
    const content = JSON.stringify(data, null, 2);
    writeFileAtomic(filePath, content);
    watcher?.noteWrite(relPath, content);
    return { ok: true, hash: hashContent(content) };
  };

  if (isScore) {
    try {
      return write();
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const acquired = acquireLock(filePath);
    if (!acquired) return { ok: false, reason: 'locked' };
    try {
      return write();
    } catch (e) {
      return { ok: false, reason: e.message };
    } finally {
      releaseLock(filePath);
    }
  }
});
// @end
// @verbatim main.js:179-205
// Delete a single file relative to the data directory.
// Score files skip locking; all other files acquire lock first.
ipcMain.handle('fs:deleteFile', (_event, relPath) => {
  const filePath = path.join(getDataDir(), relPath);
  const isScore = relPath.includes('/scores/');
  if (isScore) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      watcher?.noteDelete(relPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  } else {
    const acquired = acquireLock(filePath);
    if (!acquired) return { ok: false, reason: 'locked' };
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      watcher?.noteDelete(relPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    } finally {
      releaseLock(filePath);
    }
  }
});
// @end
  const invoke = async (channel, ...args) => structuredClone(await handlers.get(channel)({}, ...structuredClone(args)));
  return { invoke, acquireLock, releaseLock, LOCK_TTL_MS };
}

module.exports = { createMainStorage };
