// SPDX-License-Identifier: AGPL-3.0-or-later

// The numbers of the group overview (design spec 4.5, board 45; PLAN-2 decisions 27-34), pure:
// the Store loads, this decides. One column per original test of the group's jaarlaag (with a
// volgnummer), holding the attempt that counts; the JAAR columns are the weighted year average
// (decision 12, as the card and the rapport) and the SE average (decisions 10, 28).

import { bestAttempt, type HistoryEntry } from '../../domain/attempts';
import { isUpperSchool } from '../../domain/cards';
import { groupName, isPo, rubricOf } from '../../domain/po';
import { poObsIds, poStudentObs } from '../../domain/po-grading';
import { RTTI_CATS } from '../../domain/rtti-names';
import {
  pooledRtti,
  rttiPercents,
  trend,
  yearAverage,
  type TrendLevel,
} from '../../domain/statistics';
import { testKind, type TestKind } from '../../domain/test-type';
import type { Exam, Group, Observatie, ScoreRecord, Student } from '../../domain/types';
import { resitInfo, type ResitInfo } from '../../overview/resit-dot';

export interface Column {
  original: Exam;
  /** The original first, then its resits by attempt number. */
  attempts: Exam[];
  kind: TestKind;
  po: boolean;
  diagnostic: boolean;
  /** The observaties linked to any attempt (a PO: the rubric's and every category's too). */
  obsIds: string[];
  periode: string;
}

export interface Cell {
  grade: number | null;
  /** The attempt that counts (null without a grade). */
  attempt: Exam | null;
  resit: ResitInfo | null;
  /** The original's own grade, when a resit counts. */
  originalGrade: number | null;
  /** The observatie ids of the attempt that counts; without a grade those of every attempt. */
  obs: string[];
  /** A PO: the student's projectgroep name, or null when not placed (decision 28: "—"). */
  projectgroep: string | null;
  unplaced: boolean;
  /** RTTI points of the attempt that counts, for the RTTI-verloop. */
  entry: HistoryEntry | null;
}

export interface Row {
  student: Student;
  cells: Cell[];
  yearAvg: number | null;
  seAvg: number | null;
  trend: TrendLevel | null;
}

export interface GroupModel {
  group: Group;
  columns: Column[];
  rows: Row[];
  /** Periodes in order, with the number of columns of each. */
  periodes: { label: string; span: number }[];
  /** The SE column: for groups whose tests count for an examendossier. */
  showSe: boolean;
}

export interface ModelInput {
  group: Group;
  /** The group's students in display order. */
  students: Student[];
  /** Every test of the vak and school year (the year average takes them all, decision 25). */
  yearExams: Exam[];
  records: Map<string, ScoreRecord | null>;
  /** SE averages per student id (null: none, or not computed). */
  seAverages?: Map<string, number | null>;
}

function periodeOf(e: Exam): string {
  return e.periode == null || e.periode === '' ? '—' : String(e.periode);
}

/** The columns: originals of the jaarlaag with a volgnummer, by volgnummer, resits attached. */
export function columnsOf(group: Group, yearExams: Exam[]): Column[] {
  const exams = yearExams
    .filter((e) => String(e.jaarlaag) === String(group.jaarlaag ?? '') && e.volgnummer)
    .sort((a, b) => (a.volgnummer ?? 0) - (b.volgnummer ?? 0));
  const originals = exams.filter((e) => !e.parent_id);
  const cols = originals.map((original) => {
    const resits = exams
      .filter((e) => e.parent_id === original.id)
      .sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
    const attempts = [original, ...resits];
    const po = isPo(original);
    const obsIds = [
      ...new Set(attempts.flatMap((e) => (po ? poObsIds(e, rubricOf(e)) : (e.obs_ids ?? [])))),
    ];
    return {
      original,
      attempts,
      kind: testKind(original),
      po,
      diagnostic: !!original.diagnostic,
      obsIds,
      periode: periodeOf(original),
    };
  });
  // By periode (as the header groups them), volgnummer within a periode.
  const order = [...new Set(cols.map((c) => c.periode))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  return order.flatMap((p) => cols.filter((c) => c.periode === p));
}

function obsOf(rec: ScoreRecord | null | undefined, e: Exam): string[] {
  return isPo(e) ? poStudentObs(rec, e.id) : [...(rec?.observations?.[e.id] ?? [])];
}

function projectgroepOf(e: Exam, studentId: string): string | null {
  const list = e.projectgroepen ?? [];
  const i = list.findIndex((g) => g.student_ids.some((id) => String(id) === studentId));
  return i < 0 ? null : groupName(list[i]!, i);
}

export function cellOf(col: Column, student: Student, rec: ScoreRecord | null | undefined): Cell {
  const sid = String(student.id);
  const best = bestAttempt(rec, col.attempts);
  const attempt = best?.exam ?? null;
  const placedIn = col.po ? projectgroepOf(attempt ?? col.original, sid) : null;
  const unplaced = col.po && placedIn === null && !col.attempts.some((e) => projectgroepOf(e, sid));
  const resit = resitInfo(attempt);
  const originalGrade = resit ? (bestAttempt(rec, [col.original])?.grade ?? null) : null;
  const obs = attempt
    ? obsOf(rec, attempt)
    : [...new Set(col.attempts.flatMap((e) => obsOf(rec, e)))];
  return {
    grade: unplaced ? null : (best?.grade ?? null),
    attempt: unplaced ? null : attempt,
    resit: unplaced ? null : resit,
    originalGrade,
    obs: unplaced ? [] : obs,
    projectgroep: placedIn,
    unplaced,
    entry:
      best && !unplaced
        ? {
            exam: best.exam,
            questionScores: best.questionScores,
            override: best.override,
            po: best.po,
          }
        : null,
  };
}

export function buildGroupModel({
  group,
  students,
  yearExams,
  records,
  seAverages,
}: ModelInput): GroupModel {
  const columns = columnsOf(group, yearExams);
  const rows = students.map((student) => {
    const rec = records.get(String(student.id)) ?? null;
    return {
      student,
      cells: columns.map((c) => cellOf(c, student, rec)),
      yearAvg: yearAverage(yearExams, rec),
      seAvg: seAverages?.get(String(student.id)) ?? null,
      trend: trend(yearExams, rec)?.level ?? null,
    };
  });
  const periodes: { label: string; span: number }[] = [];
  for (const c of columns) {
    const label = c.periode === '—' ? 'GEEN PERIODE' : `PERIODE ${c.periode}`;
    const last = periodes[periodes.length - 1];
    if (last?.label === label) last.span++;
    else periodes.push({ label, span: 1 });
  }
  const showSe = isUpperSchool(group.jaarlaag) || columns.some((c) => c.original.type === 'pta');
  return { group, columns, rows, periodes, showSe };
}

/** The grades of one column (diagnostic ones too: their mean is shown grey). */
export function columnGrades(m: GroupModel, j: number): number[] {
  return m.rows.map((r) => r.cells[j]!.grade).filter((g): g is number => g !== null);
}

/** RTTI per test column (PO's left out, decision 32): pooled over the attempts that count. */
export function rttiColumns(m: GroupModel): { col: Column; pcts: (number | null)[] }[] {
  return m.columns
    .map((col, j) => ({ col, j }))
    .filter(({ col }) => !col.po)
    .map(({ col, j }) => {
      const entries = m.rows
        .map((r) => r.cells[j]!.entry)
        .filter((e): e is HistoryEntry => e !== null);
      return { col, pcts: rttiPercents(pooledRtti(entries), [...RTTI_CATS]) };
    })
    .filter((x) => x.pcts.some((p) => p !== null));
}

/** Whether an observatie can be given on a column's test (decision 23: its toetstypes). */
export function obsFits(o: Observatie, col: Column): boolean {
  return (o.toetstypes?.length ? o.toetstypes : ['toets']).includes(col.po ? 'po' : 'toets');
}

export interface ObsRow {
  obs: Observatie;
  /** Per column: null when the observatie does not fit the test, else the number of students. */
  counts: (number | null)[];
  /** Times given this year (the sum of the counts). */
  total: number;
}

/**
 * The Observaties table (decision 34): the observaties linked to a column or given in one,
 * alphabetically; per column the students with it (a PO counts every member, as each member's
 * file has the projectgroep's observaties, decision 19).
 */
export function obsRows(m: GroupModel, observaties: Observatie[]): ObsRow[] {
  const ids = new Set([
    ...m.columns.flatMap((c) => c.obsIds),
    ...m.rows.flatMap((r) => r.cells.flatMap((c) => c.obs)),
  ]);
  return observaties
    .filter((o) => ids.has(o.id))
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'))
    .map((obs) => {
      const counts = m.columns.map((col, j) =>
        obsFits(obs, col) || m.rows.some((r) => r.cells[j]!.obs.includes(obs.id))
          ? m.rows.filter((r) => r.cells[j]!.obs.includes(obs.id)).length
          : null,
      );
      return { obs, counts, total: counts.reduce<number>((s, n) => s + (n ?? 0), 0) };
    });
}
