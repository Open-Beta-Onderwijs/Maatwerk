// SPDX-License-Identifier: AGPL-3.0-or-later
// Step 38 review M2: the committed golden of the list-screen numbers. Writes the `tiny` fixture
// (current format, only the files `maatwerk_core::numbers` reads) and the Rust output
// (`maatwerk-cli numbers`) at two Cijfergemiddelden formats to
// crates/maatwerk-core/tests/fixtures/numbers/. Two tests keep Rust and the MockApi mirror on it:
// `crates/maatwerk-core/tests/numbers_golden.rs` and `ui/tests/numbers-golden.test.ts`.
// Run from PowerShell (cargo, see CLAUDE.md) after a deliberate change, and say why in the commit:
//
//   node tools/numbers-golden.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './fixtures/generate.mjs';
import { toCurrent } from './fixtures/to-current.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(ROOT, 'crates', 'maatwerk-core', 'tests', 'fixtures', 'numbers');
/** r and SE format per case: the default and one of each other method and decimals. */
export const CASES = [
  ['a1', 'a1'],
  ['k0', 'a2'],
];
const fmt = (f) => ({ methode: f[0] === 'a' ? 'afronden' : 'afkappen', decimalen: Number(f[1]) });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'numbers-golden-'));
const full = path.join(tmp, 'data');
fs.mkdirSync(full, { recursive: true });
generate('tiny', full);
toCurrent(full);

// Keep what the numbers read: settings, the school years and the rubrics.
fs.rmSync(GOLDEN, { recursive: true, force: true });
const data = path.join(GOLDEN, 'data');
fs.mkdirSync(data, { recursive: true });
for (const name of fs.readdirSync(full)) {
  const keep =
    /^\d{4}-\d{4}$/.test(name) ||
    name === 'rubrics' ||
    /^(config|instellingen|school)\.json$/.test(name);
  if (keep) fs.cpSync(path.join(full, name), path.join(data, name), { recursive: true });
}
const settings = path.join(data, 'instellingen.json');
const inst = fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')) : {};
delete inst.gemiddelden;
fs.writeFileSync(settings, `${JSON.stringify(inst, null, 2)}\n`);

execFileSync('cargo', ['build', '-q', '-p', 'maatwerk-cli'], { cwd: ROOT, stdio: 'inherit' });
const cli = path.join(
  ROOT,
  'target',
  'debug',
  process.platform === 'win32' ? 'maatwerk-cli.exe' : 'maatwerk-cli',
);

const years = fs.readdirSync(data).filter((n) => /^\d{4}-\d{4}$/.test(n));
for (const [r, se] of CASES) {
  // The CLI reads the format from the data folder: run it on a copy with the format set.
  const work = path.join(tmp, `${r}-${se}`);
  fs.cpSync(data, work, { recursive: true });
  fs.writeFileSync(
    path.join(work, 'instellingen.json'),
    `${JSON.stringify({ ...inst, gemiddelden: { r: fmt(r), se: fmt(se) } }, null, 2)}\n`,
  );
  const out = path.join(GOLDEN, 'expected', `${r}-${se}`);
  fs.mkdirSync(out, { recursive: true });
  for (const year of years) {
    const vakken = new Set();
    const dir = path.join(data, year, 'exams');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const subject = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).subject;
      if (subject) vakken.add(subject);
    }
    for (const vak of [...vakken].sort()) {
      const json = execFileSync(cli, ['numbers', work, '--year', year, '--vak', vak]).toString();
      fs.writeFileSync(path.join(out, `${year}-${vak}.json`), json.replace(/\r\n/g, '\n'));
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`golden written to ${path.relative(ROOT, GOLDEN)}`);
