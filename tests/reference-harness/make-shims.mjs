// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes tools/reference-shims/*.cjs: verbatim copies of the reference storage
// code (PLAN.md Step 2a) between `// @verbatim <file>:<a>-<b>` and `// @end`
// markers, plus the minimum glue to run them without Electron. The storage
// spec (tools/reference-shims/*.test.mjs) runs against these in CI, where
// `_reference/` is absent; shims.test.mjs checks the blocks against the reference.
//
//   node tests/reference-harness/make-shims.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE_COMMIT, REPO_ROOT, readRef, requireReference } from './reference.mjs';

export const SHIM_DIR = path.join(REPO_ROOT, 'tools', 'reference-shims');

const HEADER = (what) =>
  [
    '// SPDX-License-Identifier: AGPL-3.0-or-later',
    `// ${what}`,
    `// Blocks between @verbatim and @end are copied unchanged from the reference app at`,
    `// commit ${REFERENCE_COMMIT.slice(0, 7)} (docs/reference/VERSION.md); the rest is glue.`,
    '// Do not edit by hand: regenerate with `node tests/reference-harness/make-shims.mjs`.',
    '/* eslint-disable */',
  ].join('\n');

/** Returns the marked block for lines a..b, checking the first and last line. */
function block(file, a, b, first, last) {
  const lines = readRef(file).split(/\r?\n/);
  const body = lines.slice(a - 1, b);
  if (!body[0].includes(first)) throw new Error(`${file}:${a} does not start with ${first}`);
  if (!body[body.length - 1].includes(last))
    throw new Error(`${file}:${b} does not end with ${last}`);
  return `// @verbatim ${file}:${a}-${b}\n${body.join('\n')}\n// @end`;
}

export function shimSources() {
  const syncLines = readRef('sync.js').split(/\r?\n/).length - 1;
  return {
    'sync.cjs': [
      HEADER('Change detection and atomic writes (`_reference/sync.js`), complete file.'),
      block('sync.js', 1, syncLines, '// ----', 'module.exports'),
      '',
    ].join('\n'),

    'main-storage.cjs': [
      HEADER('Lock files and the JSON read/write/delete IPC handlers of `_reference/main.js`.'),
      "const path = require('path');",
      "const fs = require('fs');",
      "const { hashContent, readWithHash, writeFileAtomic } = require('./sync.cjs');",
      '',
      '// One instance per simulated app: `dataDir` replaces getDataDir() (main.js:22-26),',
      '// `watcher` is the createWatcher() result or null, handlers are called as invoke().',
      'function createMainStorage({ dataDir, watcher = null }) {',
      '  const handlers = new Map();',
      '  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };',
      '  const getDataDir = () => {',
      '    fs.mkdirSync(dataDir, { recursive: true });',
      '    return dataDir;',
      '  };',
      block('main.js', 31, 48, 'const LOCK_TTL_MS', '}'),
      block('main.js', 54, 121, '// Read any JSON file', '});'),
      block('main.js', 179, 205, '// Delete a single file', '});'),
      '  const invoke = async (channel, ...args) => structuredClone(await handlers.get(channel)({}, ...structuredClone(args)));',
      '  return { invoke, acquireLock, releaseLock, LOCK_TTL_MS };',
      '}',
      '',
      'module.exports = { createMainStorage };',
      '',
    ].join('\n'),

    'typst-wrappers.cjs': [
      HEADER('Typst wrapper builders of `_reference/main.js` (rapport and opdracht wrappers).'),
      '// rapportWrapper(students, examInfo): the body of app:renderRapportPdf that builds',
      '// the wrapper source (main.js:557-583), returned instead of written to temp/.',
      'function rapportWrapper(students, examInfo) {',
      block(
        'main.js',
        557,
        583,
        '// Recursively serialize a JS value',
        '#render(exam_info, student_data)',
      ),
      '  return { wrapperContent, toTypst };',
      '}',
      '',
      block('main.js', 604, 687, '// Draws an invisible link', '}'),
      '',
      'module.exports = { rapportWrapper, typStr, placeholderHeader, buildAssignmentWrapper, CURSOR_FOREGROUND };',
      '',
    ].join('\n'),

    'store-cas.cjs': [
      HEADER(
        'Compare-and-swap writes and _meta stamping of the renderer Store (`_reference/renderer/store.js`).',
      ),
      '// `rtti` is the bridge (here: { readJsonVersioned, writeJson } from main-storage).',
      'function createStoreCas({ rtti, activeUser = null }) {',
      '  const window = { rtti };',
      '  let _activeUser = activeUser;',
      block('renderer/store.js', 60, 123, 'const writeQueues = {};', '}'),
      '  return { update, saveEntity, stampMeta, setActiveUser: (u) => (_activeUser = u) };',
      '}',
      '',
      'module.exports = { createStoreCas };',
      '',
    ].join('\n'),
  };
}

/** Every @verbatim block of a shim file: { file, a, b, text }. */
export function verbatimBlocks(shimText) {
  const out = [];
  const re = /^\/\/ @verbatim (\S+):(\d+)-(\d+)\n([\s\S]*?)\n\/\/ @end$/gm;
  for (const m of shimText.matchAll(re))
    out.push({ file: m[1], a: Number(m[2]), b: Number(m[3]), text: m[4] });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireReference();
  fs.mkdirSync(SHIM_DIR, { recursive: true });
  for (const [name, text] of Object.entries(shimSources())) {
    fs.writeFileSync(path.join(SHIM_DIR, name), text);
    console.log(`wrote tools/reference-shims/${name}`);
  }
}
