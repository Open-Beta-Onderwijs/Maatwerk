// SPDX-License-Identifier: AGPL-3.0-or-later
// Regenerates (default) or checks (--check) the logic goldens in tests/golden/logic/.
//
//   npm run golden:regen [-- <suite>...]
//   npm run golden:check
//
// Needs `_reference/` at the pinned commit. Each suite runs in its own process
// so a frozen clock or a mutated global never leaks between suites.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOGIC_DIR, goldenPath } from './golden.mjs';
import { requireReference } from './reference.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES_DIR = path.join(HERE, 'suites');

export const suiteNames = () =>
  fs
    .readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => f.replace(/\.mjs$/, ''))
    .sort();

/** Runs one suite in a child process and returns the serialized golden text. */
export function runSuite(name) {
  return execFileSync(process.execPath, [path.join(HERE, 'run-suite.mjs'), name], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TZ: 'Europe/Amsterdam' },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireReference();
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const names = args.filter((a) => !a.startsWith('--'));
  const selected = names.length ? names : suiteNames();
  fs.mkdirSync(LOGIC_DIR, { recursive: true });
  let failed = 0;
  for (const name of selected) {
    const text = runSuite(name);
    const file = goldenPath(name);
    const cases = JSON.parse(text).cases.length;
    if (check) {
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (old !== text) {
        console.error(`DIFF ${name}: golden differs from the reference output`);
        failed++;
      } else console.log(`ok   ${name} (${cases} cases)`);
    } else {
      fs.writeFileSync(file, text);
      console.log(`wrote ${path.relative(process.cwd(), file)} (${cases} cases)`);
    }
  }
  if (check) {
    const stale = fs
      .readdirSync(LOGIC_DIR)
      .filter((f) => f.endsWith('.json') && !suiteNames().includes(f.replace(/\.json$/, '')));
    for (const f of stale) console.error(`STALE ${f}: no suite produces it`);
    if (failed || stale.length) process.exit(1);
  }
}
