// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 38.3: the Rust numbers (`maatwerk-cli numbers`, `maatwerk_core::numbers`) against the
// UI's own path (the domain functions the list screens call today, fed as `Store` feeds them).
// Runs only from `node tools/numbers-parity.mjs <tiny|school>`, which generates the fixture,
// runs the CLI and passes the manifest in MAATWERK_PARITY. Every difference is written to the
// manifest's `out` file (the before/after table of decision 90) and fails the test.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareHistory, resitsOf, type HistoryEntry } from '../src/domain/attempts';
import { groupCardNumbers, isUpperSchool, studentCardNumbers } from '../src/domain/cards';
import { examResultsMany } from '../src/domain/grades';
import { jaarlaagFromStamklas } from '../src/domain/ids';
import { setRubricLookup } from '../src/domain/po';
import { normaliseRubric } from '../src/domain/rubric';
import { seAverage, yearAverage } from '../src/domain/statistics';
import type { Exam, Group, ScoreRecord } from '../src/domain/types';
import { addRecords, newBlock } from '../src/screens/toetsen/block-numbers';

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
const readAll = (dir: string): any[] => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => readJson(path.join(dir, n)))
    .filter((v) => v !== null);
};

function compare(m: Manifest): string[] {
  const diffs: string[] = [];
  const data = m.data;
  const rubrics = readAll(path.join(data, 'rubrics')).map(normaliseRubric);
  setRubricLookup((id, subject) => rubrics.find((r) => r.id === id && r.subject === subject));
  const years = fs
    .readdirSync(data)
    .filter((n) => /^\d{4}-\d{4}$/.test(n))
    .sort()
    .reverse();
  const examsOf = (year: string, vak: string): Exam[] =>
    readAll(path.join(data, year, 'exams')).filter((e) => e.subject === vak);
  const recOf = (year: string, vak: string, id: string): ScoreRecord | null =>
    readJson(path.join(data, year, 'scores', vak, `${id}.json`));

  for (const c of m.cases) {
    const rust = readJson(c.rust);
    const exams = examsOf(c.year, c.vak);
    const allExams = years.flatMap((y) =>
      examsOf(y, c.vak).map((e) => ({ ...e, academic_year: y })),
    );
    const history = (id: string): HistoryEntry[] => {
      const out: HistoryEntry[] = [];
      for (const y of years) {
        const rec = recOf(y, c.vak, id) ?? ({} as ScoreRecord);
        const ye = examsOf(y, c.vak);
        const ids = new Set([
          ...Object.keys(rec.scores ?? {}),
          ...Object.keys(rec.overrides ?? {}),
        ]);
        for (const examId of ids) {
          const exam = ye.find((e) => e.id === examId);
          if (!exam) continue;
          out.push({
            exam: { ...exam, academic_year: y },
            questionScores: rec.scores?.[examId] ?? {},
            override: rec.overrides?.[examId],
            po: rec.po?.[examId],
          } as HistoryEntry);
        }
      }
      return out.sort(compareHistory);
    };
    const where = (what: string) => `${c.year} ${c.vak} ${what}`;
    const same = (what: string, js: unknown, rs: unknown) => {
      const a = JSON.stringify(canon(js ?? null));
      const b = JSON.stringify(canon(rs ?? null));
      if (a !== b) diffs.push(`| ${where(what)} | ${a} | ${b} |`);
    };

    const file = readJson(path.join(data, c.year, `students-${c.year}.json`));
    const students = (Array.isArray(file) ? file : (file?.students ?? [])) as any[];
    const recs = students.map((s) => recOf(c.year, c.vak, String(s.id)));
    const results = examResultsMany(recs, exams);
    const seOf = new Map<string, number | null>();
    students.forEach((s, k) => {
      const id = String(s.id);
      const upper = isUpperSchool(s.jaarlaag ?? jaarlaagFromStamklas(s.stamklas ?? ''));
      const card = studentCardNumbers(
        exams,
        recs[k],
        upper ? { history: history(id), allExams } : null,
      );
      const r = rust.students[id];
      same(`student ${id} r`, card.average, r?.average?.shown);
      same(`student ${id} se`, card.se, upper ? r?.se?.shown : null);
      same(`student ${id} trend`, card.trend, r?.trend);
      same(
        `student ${id} bars`,
        card.bars.map((b) => [b.grade, b.diagnostic]),
        (r?.bars ?? []).map((b: any) => [b.grade, b.diagnostic]),
      );
      const own: Record<string, number> = {};
      exams.forEach((e, j) => {
        const g = results[k]?.[j]?.grade;
        if (g !== null && g !== undefined) own[e.id] = g;
      });
      same(`student ${id} results`, sortKeys(own), r?.results);
    });

    for (const original of exams.filter((e) => !e.parent_id)) {
      const resits = resitsOf(exams, original.id);
      const block = newBlock([original, ...resits]);
      addRecords(block, recs, original, resits);
      for (const [id, n] of block.per) {
        same(`exam ${id} grades`, n.grades, rust.exams[id]?.grades);
        same(`exam ${id} obs`, sortKeys(Object.fromEntries(n.obs)), rust.exams[id]?.obs);
      }
      if (resits.length) {
        same(
          `verzamel ${original.id} grades`,
          block.summary.grades,
          rust.summaries[original.id]?.grades,
        );
        same(
          `verzamel ${original.id} obs`,
          sortKeys(Object.fromEntries(block.summary.obs)),
          rust.summaries[original.id]?.obs,
        );
      }
    }

    const groups = readAll(path.join(data, c.year, 'groups')).filter(
      (g: Group) => g.subject === c.vak && g.student_ids?.length,
    ) as Group[];
    for (const g of groups) {
      const upper = isUpperSchool(g.jaarlaag);
      const ids = new Set(g.student_ids.map(String));
      const members = students
        .map((s, k) => ({ id: String(s.id), k }))
        .filter((s) => ids.has(s.id))
        .map(({ id, k }) => {
          if (upper && !seOf.has(id)) seOf.set(id, seAverage(history(id), allExams));
          return { year: yearAverage(exams, recs[k]), se: upper ? (seOf.get(id) ?? null) : null };
        });
      const js = groupCardNumbers(members, upper);
      same(`group ${g.id} year`, js.year, rust.groups[g.id]?.year);
      same(`group ${g.id} se`, js.se, rust.groups[g.id]?.se);
    }
  }
  return diffs;
}

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

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

describe.skipIf(!manifestPath)('Rust numbers = the UI path (step 38.3)', () => {
  it('has no differences', () => {
    const m = readJson(manifestPath!) as Manifest;
    const diffs = compare(m);
    fs.writeFileSync(
      m.out,
      ['| Where | UI (JS/WASM) | Rust |', '| --- | --- | --- |', ...diffs].join('\n') + '\n',
    );
    expect(diffs.length, `${diffs.length} differences, see ${m.out}`).toBe(0);
    // `school`: about 30 s.
  }, 600_000);
});
