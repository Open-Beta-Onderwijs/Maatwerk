// SPDX-License-Identifier: AGPL-3.0-or-later

// The PO overview's numbers (F-24; design spec 4.14, board 43). Pure: built from what
// `loadPoContext` read (the PO, its rubric, its students and their score files) and the grade
// rules' results per student. A projectgroep's grading is copied into each member's file
// (decision 19), so every member shows the group's category scores. Only placed students have a
// grade and count in the charts; unplaced ones are listed in Resultaten without one.

import { poLinesSum, type Results } from '../../domain/grades';
import { compareStudents, groupName } from '../../domain/po';
import { gradingOf, ownLinesOf, type GroupGrading } from '../../domain/po-grading';
import { checkRubric, type Rubric, type RubricCategory } from '../../domain/rubric';
import type { Exam, Observatie, PoLine, ScoreRecord, Student } from '../../domain/types';
import { resitInfo } from '../../overview/resit-dot';

/** "Herkansing (poging 2)": a resit's projectgroepen carry it in the verzameloverzicht. */
const resitLabel = (a: Exam) => resitInfo(a)?.title ?? `poging ${a.attempt ?? 2}`;

export interface PoGroupRef {
  id: string;
  name: string;
}

export interface PoRow {
  id: string;
  name: string;
  /** Verzameloverzicht: the resit that counts for this student (I/H dot); null: the original. */
  attempt: Exam | null;
  /** The student's klas (the first matching class), or "—". */
  klas: string;
  group: PoGroupRef | null;
  grading: GroupGrading;
  groupLines: PoLine[];
  ownLines: PoLine[];
  /** Rubric points (bonus in, diagnostic out); null without a scored category. */
  points: number | null;
  /** The grade that counts (lines in), null without one. */
  grade: number | null;
  /** The projectgroepcijfer: the rubric alone, before the lines. */
  rubricGrade: number | null;
}

export interface PoGroup extends PoGroupRef {
  members: PoRow[];
  rubricGrade: number | null;
  groupLines: PoLine[];
}

export interface PoModel {
  exam: Exam;
  /** The verzameloverzicht (F-32): every row reads the attempt that counts. */
  isSummary: boolean;
  rubric: Rubric | null;
  categories: RubricCategory[];
  /** Normal points (the grade's maximum). */
  max: number;
  bonusMax: number;
  /** Every student, by achternaam. */
  rows: PoRow[];
  placed: PoRow[];
  groups: PoGroup[];
  /** The klassen of the rows, in class order. */
  klassen: string[];
}

export interface PoModelInput {
  exam: Exam;
  rubric: Rubric | null;
  students: ReadonlyMap<string, Student>;
  records: ReadonlyMap<string, ScoreRecord>;
  classTag: (id: string) => string;
  name: (id: string) => string;
  /** The grade rules' results of `attempt` for a student. */
  results: (rec: ScoreRecord | undefined, attempt: Exam) => Results | null;
  /**
   * Verzameloverzicht (F-32): the resits after the original (`exam`), and per student the attempt
   * that counts (the best grade). A student without a grade reads the first attempt that places
   * them, else the original.
   */
  summary?: { resits: readonly Exam[]; best: ReadonlyMap<string, Exam> };
}

const klasOrder = (a: string, b: string) =>
  a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b, 'nl', { numeric: true });

export function buildPoModel(input: PoModelInput): PoModel {
  const { exam, rubric, students, records, summary } = input;
  const categories = rubric?.categories ?? [];
  // The maxima are the grade rules' (rubric totals, step 38: no sums in the UI).
  const totals = rubric ? checkRubric(rubric).totals : { normal: 0, bonus: 0 };
  const attempts = [exam, ...(summary?.resits ?? [])];
  // Per attempt, the projectgroep of each student. A resit's groups are named after the attempt,
  // so "Valtoren" of the original and of the herkansing stay apart.
  const groupIn = new Map<string, Map<string, PoGroupRef>>();
  const refs = attempts.flatMap((a) => {
    const byStudent = new Map<string, PoGroupRef>();
    groupIn.set(a.id, byStudent);
    const tag = a === exam ? null : resitLabel(a);
    return (a.projectgroepen ?? []).map((g, i) => {
      const ref = {
        id: a === exam ? g.id : `${a.id}/${g.id}`,
        name: tag ? `${groupName(g, i)} · ${tag}` : groupName(g, i),
      };
      for (const s of g.student_ids) if (!byStudent.has(String(s))) byStudent.set(String(s), ref);
      return ref;
    });
  });
  const attemptOf = (id: string): Exam =>
    summary?.best.get(id) ?? attempts.find((a) => groupIn.get(a.id)!.has(id)) ?? exam;
  const placedIds = [...groupIn.values()].flatMap((m) => [...m.keys()]);
  const ids = [...new Set([...records.keys(), ...placedIds])].sort((a, b) =>
    compareStudents(students.get(a), students.get(b)),
  );
  const rows: PoRow[] = ids.map((id) => {
    const rec = records.get(id);
    const attempt = attemptOf(id);
    const group = groupIn.get(attempt.id)?.get(id) ?? null;
    const grading = gradingOf(rec, attempt.id);
    const res = group ? input.results(rec, attempt) : null;
    const scored = group && Object.keys(grading.scores).length > 0;
    return {
      id,
      name: input.name(id),
      attempt: attempt === exam ? null : attempt,
      klas: input.classTag(id),
      group,
      grading,
      groupLines: group ? grading.groupLines : [],
      ownLines: group ? ownLinesOf(rec, attempt.id) : [],
      points: scored && res ? res.scored : null,
      grade: res?.grade ?? null,
      rubricGrade: scored && res ? (res.rubricGrade ?? null) : null,
    };
  });
  const placed = rows.filter((r) => r.group);
  const groups = refs
    .map((ref) => {
      const members = placed.filter((r) => r.group === ref);
      const source = members.find((m) => m.rubricGrade !== null) ?? members[0];
      return {
        ...ref,
        members,
        rubricGrade: source?.rubricGrade ?? null,
        groupLines: source?.groupLines ?? [],
      };
    })
    .filter((g) => g.members.length);
  return {
    exam,
    isSummary: !!summary,
    rubric,
    categories,
    max: totals.normal,
    bonusMax: totals.bonus,
    rows,
    placed,
    groups,
    klassen: [...new Set(rows.map((r) => r.klas))].sort(klasOrder),
  };
}

/** The group's and the student's lines together, and their sum. */
export function linesOfRow(r: PoRow): { lines: PoLine[]; sum: number } {
  const lines = [...r.groupLines, ...r.ownLines].filter((l) => l.value !== null);
  return { lines, sum: poLinesSum([...r.groupLines, ...r.ownLines]) };
}

/** Grades of the rows that have one. */
export const gradesOf = (rows: readonly PoRow[]): number[] =>
  rows.map((r) => r.grade).filter((g): g is number => g !== null);

/** A category's scores of the rows that have one. */
export const catScores = (rows: readonly PoRow[], catId: string): number[] =>
  rows.map((r) => r.grading.scores[catId]).filter((v): v is number => typeof v === 'number');

/** The levels a score falls in (overlapping levels: more than one). */
export function levelsOf(c: RubricCategory, score: number): number[] {
  return c.niveaus
    .map((n, i) => ({ i, min: n.min ?? 0, max: n.max ?? 0 }))
    .filter((l) => l.min <= score && score <= l.max)
    .map((l) => l.i);
}

/** "4–7 Goed": a level's range and title. */
export function levelText(c: RubricCategory, i: number): string {
  const n = c.niveaus[i]!;
  const [min, max] = [n.min ?? 0, n.max ?? 0];
  return `${min === max ? min : `${min}–${max}`}${n.titel ? ` ${n.titel}` : ''}`;
}

/** Per level of a category: the placed students whose score falls in it. */
export function levelCounts(c: RubricCategory, rows: readonly PoRow[]): number[] {
  const counts = c.niveaus.map(() => 0);
  for (const v of catScores(rows, c.id)) for (const i of levelsOf(c, v)) counts[i]!++;
  return counts;
}

export interface ObsSection {
  /** A category, or null for "Algemene observaties". */
  category: RubricCategory | null;
  rows: { obs: Observatie; n: number; groups: string[] }[];
}

/**
 * The Observaties tab: a section per category with observaties (its linked ones and any given),
 * then the general ones (the rubric's, the PO's own and any given). Every placed member counts.
 */
export function obsSections(m: PoModel, allObs: readonly Observatie[]): ObsSection[] {
  const byId = new Map(allObs.map((o) => [o.id, o]));
  const has = (r: PoRow, id: string, cat: string | null) =>
    cat === null ? r.grading.observations.includes(id) : !!r.grading.categoryObs[cat]?.includes(id);
  const section = (category: RubricCategory | null, linked: readonly string[]): ObsSection => {
    const cat = category?.id ?? null;
    const given = m.placed.flatMap((r) =>
      cat === null ? r.grading.observations : (r.grading.categoryObs[cat] ?? []),
    );
    const obs = [...new Set([...linked, ...given])]
      .map((id) => byId.get(id))
      .filter((o): o is Observatie => !!o)
      .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'));
    return {
      category,
      rows: obs.map((o) => ({
        obs: o,
        n: m.placed.filter((r) => has(r, o.id, cat)).length,
        groups: m.groups.filter((g) => g.members.some((r) => has(r, o.id, cat))).map((g) => g.name),
      })),
    };
  };
  return [
    ...m.categories.map((c) => section(c, c.obs_ids ?? [])),
    section(null, [...(m.rubric?.obs_ids ?? []), ...(m.exam.obs_ids ?? [])]),
  ].filter((s) => s.rows.length);
}

/** A student's observaties for a tooltip: the general ones, then each category's (prefixed). */
export function rowObs(
  r: PoRow,
  m: PoModel,
  byId: ReadonlyMap<string, Observatie>,
  only?: string,
): { icon?: string; naam?: string }[] {
  const out: { icon?: string; naam?: string }[] = [];
  if (only === undefined)
    for (const id of r.grading.observations) {
      const o = byId.get(id);
      if (o) out.push({ icon: o.icon, naam: o.naam });
    }
  for (const c of m.categories) {
    if (only !== undefined && c.id !== only) continue;
    for (const id of r.grading.categoryObs[c.id] ?? []) {
      const o = byId.get(id);
      if (o) out.push({ icon: o.icon, naam: only === undefined ? `${c.naam}: ${o.naam}` : o.naam });
    }
  }
  return out;
}
