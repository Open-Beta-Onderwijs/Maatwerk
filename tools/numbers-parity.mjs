// SPDX-License-Identifier: AGPL-3.0-or-later
// Step 38.3: compares the Rust list-screen numbers (`maatwerk-cli numbers`) with the UI's path
// on a generated fixture, for every year and vak. Run from PowerShell (cargo, see CLAUDE.md):
//
//   node tools/numbers-parity.mjs <tiny|school>
//
// Writes the differences (the before/after table of decision 90) to
// target/numbers-parity/<name>.md and exits non-zero when there are any.

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './fixtures/generate.mjs';
import { toCurrent } from './fixtures/to-current.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!['tiny', 'school'].includes(name)) {
  console.error('usage: node tools/numbers-parity.mjs <tiny|school>');
  process.exit(2);
}

const work = path.join(ROOT, 'target', 'numbers-parity', name);
fs.rmSync(work, { recursive: true, force: true });
const data = path.join(work, 'data');
fs.mkdirSync(data, { recursive: true });
generate(name, data);
toCurrent(data);

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

const outFile = path.join(ROOT, 'target', 'numbers-parity', `${name}.md`);
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
