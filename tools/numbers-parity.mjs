// SPDX-License-Identifier: AGPL-3.0-or-later
// Step 38: compares the Rust list-screen numbers (`maatwerk-cli numbers`) with the MockApi's
// mirror (ui/tests/numbers-parity.test.ts) on a generated fixture, for every year and vak. Run
// from PowerShell (cargo, see CLAUDE.md):
//
//   node tools/numbers-parity.mjs <tiny|school> [a0|a1|a2|k0|k1|k2 [a0..k2]]
//
// The optional formats are the school's Cijfergemiddelden for r and SE (default a1 a1), written
// into the fixture's instellingen.json.
//
// Writes the differences to target/numbers-parity/<name>[-r-se].md and exits non-zero when there
// are any.

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './fixtures/generate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name, rArg = 'a1', seArg = rArg] = process.argv.slice(2);
const FORMAT = /^[ak][012]$/;
if (!['tiny', 'school'].includes(name) || !FORMAT.test(rArg) || !FORMAT.test(seArg)) {
  console.error('usage: node tools/numbers-parity.mjs <tiny|school> [a0..k2 [a0..k2]]');
  process.exit(2);
}
const fmt = (f) => ({ methode: f[0] === 'a' ? 'afronden' : 'afkappen', decimalen: Number(f[1]) });
const tag = rArg === 'a1' && seArg === 'a1' ? name : `${name}-${rArg}-${seArg}`;

const work = path.join(ROOT, 'target', 'numbers-parity', tag);
fs.rmSync(work, { recursive: true, force: true });
const data = path.join(work, 'data');
fs.mkdirSync(data, { recursive: true });
generate(name, data);
const settings = path.join(data, 'instellingen.json');
const inst = fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')) : {};
inst.gemiddelden = { r: fmt(rArg), se: fmt(seArg) };
fs.writeFileSync(settings, `${JSON.stringify(inst, null, 2)}\n`);

execFileSync('cargo', ['build', '-q', '-p', 'maatwerk-cli'], { cwd: ROOT, stdio: 'inherit' });
const cli = path.join(
  ROOT,
  'target',
  'debug',
  process.platform === 'win32' ? 'maatwerk-cli.exe' : 'maatwerk-cli',
);

const cases = [];
for (const year of fs.readdirSync(data).filter((n) => /^\d{4}-\d{4}$/.test(n))) {
  const vakken = new Set();
  const dir = path.join(data, year, 'exams');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (e.subject) vakken.add(e.subject);
  }
  for (const vak of vakken) {
    const out = execFileSync(cli, ['numbers', data, '--year', year, '--vak', vak], {
      maxBuffer: 1 << 28,
    });
    const rust = path.join(work, `${year}-${vak}.json`);
    fs.writeFileSync(rust, out);
    cases.push({ year, vak, rust });
  }
}

const outFile = path.join(ROOT, 'target', 'numbers-parity', `${tag}.md`);
const manifest = path.join(work, 'manifest.json');
fs.writeFileSync(manifest, JSON.stringify({ data, out: outFile, cases }, null, 2));
console.log(`${cases.length} year/vak cases; differences go to ${outFile}`);
try {
  // One command string: npx is a .cmd on Windows, which needs a shell.
  execSync('npx vitest run tests/numbers-parity.test.ts', {
    cwd: path.join(ROOT, 'ui'),
    stdio: 'inherit',
    env: { ...process.env, MAATWERK_PARITY: manifest },
  });
} catch {
  process.exit(1);
}
