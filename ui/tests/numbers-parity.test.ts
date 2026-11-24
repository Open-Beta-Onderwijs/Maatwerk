// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 38: the Rust numbers (`maatwerk-cli numbers`, `maatwerk_core::numbers`) against the
// MockApi's mirror (`bridge/mock/mock-numbers.ts`, every number through the WASM grade rules),
// entry by entry, at any Cijfergemiddelden format. Runs only from
// `node tools/numbers-parity.mjs <tiny|school> [r-format [se-format]]`, which generates the
// fixture, runs the CLI and passes the manifest in MAATWERK_PARITY. Every difference is written
// to the manifest's `out` file and fails the test.
//
// Until the screens moved to Rust (step 38.5) this test also compared with the screens' old JS
// path: 0 differences on tiny and school (docs/phase-2/step-38-numbers.md).

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { vakNumbers } from '../src/bridge/mock/mock-numbers';
import { readFormats } from '../src/domain/numbers';
import { setRubricLookup } from '../src/domain/po';
import { normaliseRubric } from '../src/domain/rubric';

interface Case {
  year: string;
  vak: string;
  rust: string;
}
interface Manifest {
  data: string;
  out: string;
  cases: Case[];
}

const manifestPath = process.env.MAATWERK_PARITY;

/* eslint-disable @typescript-eslint/no-explicit-any */
const readJson = (p: string): any => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/** Objects with sorted keys, at every depth: key order is not a difference. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canon(x)]),
    );
  return v;
}

function compare(m: Manifest): string[] {
  const diffs: string[] = [];
  const data = m.data;
  const files = {
    read: (rel: string) => readJson(path.join(data, rel)),
    readAll: (dir: string) => {
      const abs = path.join(data, dir);
      if (!fs.existsSync(abs)) return [];
      return fs
        .readdirSync(abs)
        .filter((n) => n.endsWith('.json'))
        .map((name) => ({ name, data: readJson(path.join(abs, name)) }))
        .filter((f) => f.data !== null);
    },
    years: () =>
      fs
        .readdirSync(data)
        .filter((n) => /^\d{4}-\d{4}$/.test(n))
        .sort()
        .reverse(),
  };
  // As Store: a PO is graded with the rubric of its vak.
  const rubrics = files.readAll('rubrics').map((f) => normaliseRubric(f.data));
  setRubricLookup((id, subject) => rubrics.find((r) => r.id === id && r.subject === subject));
  const formats = readFormats(files.read('instellingen.json'));

  for (const c of m.cases) {
    const rust = readJson(c.rust);
    const mock = vakNumbers(files, c.year, c.vak, formats);
    const same = (what: string, ts: unknown, rs: unknown) => {
      const a = JSON.stringify(canon(ts ?? null));
      const b = JSON.stringify(canon(rs ?? null));
      if (a !== b) diffs.push(`| ${c.year} ${c.vak} ${what} | ${a} | ${b} |`);
    };
    same('formats', mock.formats, rust.formats);
    for (const part of ['students', 'exams', 'summaries', 'groups'] as const) {
      const keys = new Set([...Object.keys(mock[part]), ...Object.keys(rust[part] ?? {})]);
      for (const k of keys) same(`${part} ${k}`, mock[part][k], rust[part]?.[k]);
    }
  }
  return diffs;
}

describe.skipIf(!manifestPath)('Rust numbers = the MockApi mirror (step 38)', () => {
  it('has no differences', () => {
    const m = readJson(manifestPath!) as Manifest;
    const diffs = compare(m);
    fs.writeFileSync(
      m.out,
      ['| Where | MockApi (TS/WASM) | Rust |', '| --- | --- | --- |', ...diffs].join('\n') + '\n',
    );
    expect(diffs.length, `${diffs.length} differences, see ${m.out}`).toBe(0);
    // `school`: about 30 s.
  }, 600_000);
});
