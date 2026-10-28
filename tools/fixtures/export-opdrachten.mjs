// SPDX-License-Identifier: AGPL-3.0-or-later
// Copies the tiny fixture's opdracht sources and images (`opdrachten/*.typ`, `opdrachten/images/`)
// to crates/maatwerk-core/tests/fixtures/opdrachten, the inputs of the Rust opdracht parity tests
// (Step 5b), so `cargo test` needs no Node. `--check` compares instead of writing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUST_FIXTURES = path.join(
  HERE,
  '..',
  '..',
  'crates',
  'maatwerk-core',
  'tests',
  'fixtures',
  'opdrachten',
);

/** Relative posix paths of the opdracht inputs in a generated data dir, sorted. */
function inputs(opdrachtenDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(opdrachtenDir, abs).split(path.sep).join('/'));
    }
  };
  walk(opdrachtenDir);
  return out.filter((f) => f.endsWith('.typ') || f.startsWith('images/')).sort();
}

/** Returns the list of differences between the tiny fixture and `target` (empty when in sync). */
export function exportOpdrachten(target = RUST_FIXTURES, { check = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maatwerk-fx-opdrachten-'));
  try {
    generate('tiny', tmp);
    const src = path.join(tmp, 'opdrachten');
    const want = inputs(src);
    const have = fs.existsSync(target) ? inputs(target) : [];
    const diffs = [];
    for (const f of have) if (!want.includes(f)) diffs.push(`extra: ${f}`);
    for (const f of want) {
      const a = fs.readFileSync(path.join(src, f));
      const p = path.join(target, f);
      if (!fs.existsSync(p)) diffs.push(`missing: ${f}`);
      else if (!a.equals(fs.readFileSync(p))) diffs.push(`differs: ${f}`);
    }
    if (!check) {
      fs.rmSync(target, { recursive: true, force: true });
      for (const f of want) {
        fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true });
        fs.copyFileSync(path.join(src, f), path.join(target, f));
      }
    }
    return diffs;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const diffs = exportOpdrachten(RUST_FIXTURES, { check });
  if (check && diffs.length) {
    console.error(diffs.join('\n'));
    process.exit(1);
  }
  console.log(check ? 'in sync' : `wrote ${RUST_FIXTURES}`);
}
