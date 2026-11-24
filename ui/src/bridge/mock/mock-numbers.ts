// SPDX-License-Identifier: AGPL-3.0-or-later

// The MockApi's `vakNumbers`: the same selection as `maatwerk_core::numbers` (load.rs,
// compute.rs), every number from the grade rules through WebAssembly. Checked against the Rust
// output by `tools/numbers-parity.mjs`. A PO's rubric comes from the rubric lookup
// (`forGrading`), as everywhere in the UI: the caller sets it (Store does).

import {
  bestAttemptMany,
  compareHistory,
  resitsOf,
  type HistoryEntry,
} from '../../domain/attempts';
import { examResultsMany } from '../../domain/grades';
import {
  type ExamNumbers,
  type Formats,
  type GroupNumbers,
  type NumbersBar,
  type Shown,
  type StudentNumbers,
  type VakNumbers,
} from '../../domain/numbers';
import { forGrading } from '../../domain/po';
import {
  histogram,
  isFailShown,
  seAverage,
  shownAverage,
  stats,
  statsOfAverages,
  trend,
  yearAverage,
  type AverageFormat,
} from '../../domain/statistics';
import type { Exam, ScoreRecord } from '../../domain/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** What the numbers read, as the core's Storage gives it. */
export interface NumbersFiles {
  /** A JSON file, null when missing or broken. */
  read(rel: string): any;
  /** Every JSON file directly in `dir`, in directory order, with its name. */
  readAll(dir: string): { name: string; data: any }[];
  /** Year folders, newest first. */
  years(): string[];
}

const idText = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;

/** `Number(x)` of a jaarlaag, as `is_upper`. */
function isUpper(j: unknown): boolean {
  const n =
    typeof j === 'number'
      ? j
      : typeof j === 'string'
        ? j.trim() === ''
          ? 0
          : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(j.trim())
            ? Number(j.trim())
            : NaN
        : NaN;
  return n >= 4 && n <= 6;
}

interface Year {
  year: string;
  exams: Exam[];
  records: Map<string, any>;
  diagnostic: Set<string>;
}

function loadYear(f: NumbersFiles, year: string, vak: string): Year {
  const diagnostic = new Set<string>();
  const exams: Exam[] = [];
  for (const { data } of f.readAll(`${year}/exams`)) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.subject !== vak) continue;
    if (data.diagnostic === true) {
      const id = idText(data.id);
      if (id) diagnostic.add(id);
    }
    exams.push(forGrading({ ...data, academic_year: year }) as Exam);
  }
  const records = new Map<string, any>();
  for (const { name, data } of f.readAll(`${year}/scores/${vak}`)) {
    const id = name.replace(/\.json$/, '');
    if (id && data && typeof data === 'object' && !Array.isArray(data)) records.set(id, data);
  }
  return { year, exams, records, diagnostic };
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

function obsOf(rec: any, exam: Exam): string[] {
  if (!rec) return [];
  const out = strings(rec.observations?.[exam.id]);
  const cats = rec.po?.[exam.id]?.categoryObs;
  if (exam.kind === 'po' && cats && typeof cats === 'object' && !Array.isArray(cats))
    for (const v of Object.values(cats)) out.push(...strings(v));
  return [...new Set(out)];
}

function history(id: string, years: Year[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const y of years) {
    const rec = y.records.get(id);
    if (!rec) continue;
    const keys = (o: unknown) =>
      o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [];
    for (const examId of new Set([...keys(rec.scores), ...keys(rec.overrides)])) {
      const exam = y.exams.find((e) => e.id === examId);
      if (!exam) continue;
      const qs = rec.scores?.[examId];
      out.push({
        exam,
        questionScores: qs && typeof qs === 'object' && !Array.isArray(qs) ? qs : {},
        override: rec.overrides?.[examId],
        po: rec.po?.[examId],
      } as HistoryEntry);
    }
  }
  return out.sort(compareHistory);
}

const shown = (raw: number | null, fmt: AverageFormat): Shown | null => {
  if (raw === null) return null;
  const s = shownAverage(raw, fmt);
  return { raw, shown: s, fails: isFailShown(s) };
};

function card(grades: number[], obs: Map<string, number>): ExamNumbers {
  return {
    grades,
    stats: stats(grades),
    histogram: histogram(grades, 1),
    obs: Object.fromEntries([...obs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

const count = (obs: Map<string, number>, ids: string[]) => {
  for (const id of ids) obs.set(id, (obs.get(id) ?? 0) + 1);
};

const byKey = <T>(m: Map<string, T>): Record<string, T> =>
  Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** `maatwerk_core::numbers::vak_numbers`. */
export function vakNumbers(
  f: NumbersFiles,
  year: string,
  vak: string,
  formats: Formats,
): VakNumbers {
  const current = loadYear(f, year, vak);
  const file = f.read(`${year}/students-${year}.json`);
  const list: any[] = Array.isArray(file)
    ? file
    : Array.isArray(file?.students)
      ? file.students
      : [];
  const students = list.flatMap((s) => {
    const id = idText(s?.id);
    if (!id) return [];
    const j = s.jaarlaag ?? String(s.stamklas ?? '').match(/^\d*/)![0];
    return [{ id, upper: isUpper(j) }];
  });
  const groups = f
    .readAll(`${year}/groups`)
    .map(({ data }) => data)
    .filter((g) => g && g.subject === vak && Array.isArray(g.student_ids) && g.student_ids.length)
    .map((g) => ({
      // As the crate's `text`: a string, or a number as text.
      id: idText(g.id) ?? '',
      jaarlaag: idText(g.jaarlaag) ?? undefined,
      members: new Set<string>(g.student_ids.map(idText).filter(Boolean)),
    }));
  const upperGroups = groups.filter((g) => isUpper(g.jaarlaag));
  const inUpper = new Set(upperGroups.flatMap((g) => [...g.members]));
  const needAll = students.some((s) => s.upper) || upperGroups.length > 0;
  const all = needAll ? f.years().map((y) => (y === year ? current : loadYear(f, y, vak))) : [];
  const allExams = all.flatMap((y) => y.exams);

  const exams = current.exams;
  const originals = exams
    .filter((e) => !e.parent_id)
    .sort(
      (a, b) =>
        (a.volgnummer ?? 0) - (b.volgnummer ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((head) => ({ head, attempts: [head, ...resitsOf(exams, head.id)] }));

  const recs = students.map((s) => (current.records.get(s.id) ?? null) as ScoreRecord | null);
  const results = examResultsMany(recs, exams);
  const bests = originals.map((o) => bestAttemptMany(recs, o.attempts));

  const per = new Map(
    exams.map((e) => [e.id, { grades: [] as number[], obs: new Map<string, number>() }]),
  );
  const sums = new Map<string, { grades: number[]; obs: Map<string, number> }>();
  const outStudents = new Map<string, StudentNumbers>();
  students.forEach((s, k) => {
    const raw = current.records.get(s.id);
    const res: Record<string, number> = {};
    exams.forEach((e, j) => {
      const g = results[k]?.[j]?.grade;
      const c = per.get(e.id)!;
      if (g !== null && g !== undefined) {
        res[e.id] = g;
        c.grades.push(g);
      }
      count(c.obs, obsOf(raw, e));
    });
    const bars: NumbersBar[] = [];
    originals.forEach((o, i) => {
      const best = bests[i]![k];
      if (best)
        bars.push({
          examId: o.head.id,
          grade: best.grade,
          diagnostic: current.diagnostic.has(o.head.id),
        });
      if (o.attempts.length > 1) {
        let c = sums.get(o.head.id);
        if (!c) sums.set(o.head.id, (c = { grades: [], obs: new Map() }));
        if (best) {
          c.grades.push(best.grade);
          count(c.obs, obsOf(raw, best.exam));
        } else count(c.obs, [...new Set(o.attempts.flatMap((a) => obsOf(raw, a)))]);
      }
    });
    const rec = recs[k] ?? ({} as ScoreRecord);
    const se = s.upper || inUpper.has(s.id) ? seAverage(history(s.id, all), allExams) : null;
    outStudents.set(s.id, {
      upper: s.upper,
      results: byKey(new Map(Object.entries(res))),
      bars,
      average: shown(yearAverage(exams, rec), formats.r),
      trend: trend(exams, rec),
      se: shown(se, formats.se),
    });
  });

  const outGroups = new Map<string, GroupNumbers>();
  for (const g of groups) {
    const of = (pick: (n: StudentNumbers) => number | null, fmt: AverageFormat) =>
      statsOfAverages(
        students
          .filter((s) => g.members.has(s.id))
          .map((s) => pick(outStudents.get(s.id)!))
          .filter((x): x is number => x !== null),
        fmt,
      );
    const upper = upperGroups.some((u) => u.id === g.id);
    outGroups.set(g.id, {
      upper,
      year: of((n) => n.average?.raw ?? null, formats.r),
      se: upper ? of((n) => n.se?.raw ?? null, formats.se) : null,
    });
  }

  return {
    year,
    vak,
    formats,
    students: byKey(outStudents),
    exams: byKey(new Map([...per].map(([id, c]) => [id, card(c.grades, c.obs)]))),
    summaries: byKey(new Map([...sums].map(([id, c]) => [id, card(c.grades, c.obs)]))),
    groups: byKey(outGroups),
  };
}
