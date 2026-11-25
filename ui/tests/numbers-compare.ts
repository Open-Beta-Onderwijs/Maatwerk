// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 38: compares the MockApi mirror (`bridge/mock/mock-numbers.ts`) with Rust output files
// (`maatwerk-cli numbers`), entry by entry. Used by the manual parity run
// (`numbers-parity.test.ts`) and the committed golden (`numbers-golden.test.ts`).

import fs from 'node:fs';
import path from 'node:path';
import { vakNumbers } from '../src/bridge/mock/mock-numbers';
import { readFormats, type Formats } from '../src/domain/numbers';
import { setRubricLookup } from '../src/domain/po';
import { normaliseRubric } from '../src/domain/rubric';

export interface Case {
  year: string;
  vak: string;
  rust: string;
}
export interface Manifest {
  data: string;
  out: string;
  cases: Case[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const readJson = (p: string): any => {
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

/** Differences as table rows; `formats` overrides the data's own Cijfergemiddelden. */
export function compare(m: Pick<Manifest, 'data' | 'cases'>, formats?: Formats): string[] {
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
  const fmts = formats ?? readFormats(files.read('instellingen.json'));

  for (const c of m.cases) {
    const rust = readJson(c.rust);
    const mock = vakNumbers(files, c.year, c.vak, fmts);
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
