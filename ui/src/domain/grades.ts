// SPDX-License-Identifier: AGPL-3.0-or-later

// Grade and RTTI of one attempt. The rules are in Rust (crates/maatwerk-grades, ADR-0011,
// docs/phase-2/step-19-grade-rules.md); this file only gives them types.

import { coreCall } from './core';
import { forGrading } from './po';
import type {
  Exam,
  Override,
  PoGrading,
  PoLine,
  Question,
  QuestionKind,
  QuestionScores,
  ScoreRecord,
} from './types';

/** The kind of a question; absent or unknown means 'normal' (decision 23). */
export function qKind(q: Pick<Question, 'kind'>): QuestionKind {
  return q.kind === 'bonus' || q.kind === 'diag' ? q.kind : 'normal';
}

/** RTTI percentage per category, or 'NVT' when the category has no points. */
export type RttiPct = number | 'NVT';

/** Points scored and possible. */
export interface Points {
  scored: number;
  max: number;
}

export type RttiCategory = 'R' | 'T1' | 'T2' | 'I';
export type RttiPoints = Record<RttiCategory, Points>;

export interface Results {
  scored: number;
  normalMax: number;
  bonusMax: number;
  examMaxTotal: number;
  hasBonus: boolean;
  /** The grade that counts, rounded to one decimal: the override if there is one. */
  grade: number | null;
  calculatedGrade: number | null;
  overridden: boolean;
  /** The calculated grade changed since the override was set. */
  overrideStale: boolean;
  R: RttiPct;
  T1: RttiPct;
  T2: RttiPct;
  I: RttiPct;
  rttiPoints: RttiPoints;
  /** A PO's grade from its rubric alone, before the bonus/malus lines (decision 28). */
  rubricGrade?: number;
}

/** The exact grade from points with the n-term and its bounds (decision 1). */
export function calcGrade(scored: number, max: number, nTerm: number): number {
  return coreCall('calcGrade', scored, max, nTerm);
}

/**
 * Grade, points and RTTI percentages of one attempt. `po` is a PO's `po[examId]` of the score
 * file: its bonus/malus lines count (decision 28); a test ignores it.
 */
export function calcResults(
  exam: Pick<Exam, 'n_term' | 'questions'> & Partial<Pick<Exam, 'kind' | 'subject' | 'rubric_id'>>,
  questionScores: QuestionScores,
  override?: Override | null,
  po?: PoGrading | null,
): Results {
  return coreCall('calcResults', forGrading(exam), questionScores, override ?? null, po ?? null);
}

/**
 * Only what the rules need of a student's record for `exams`: a record holds every test of the
 * year, and this runs for every cell of the overviews.
 */
export function recordFor(
  rec: ScoreRecord | null | undefined,
  exams: readonly Pick<Exam, 'id'>[],
): Pick<ScoreRecord, 'scores' | 'overrides' | 'po'> {
  const scores: NonNullable<ScoreRecord['scores']> = {};
  const overrides: NonNullable<ScoreRecord['overrides']> = {};
  const po: NonNullable<ScoreRecord['po']> = {};
  for (const { id } of exams) {
    const s = rec?.scores?.[id];
    const o = rec?.overrides?.[id];
    const p = rec?.po?.[id];
    if (s) scores[id] = s;
    if (o) overrides[id] = o;
    if (p) po[id] = p;
  }
  return { scores, overrides, po };
}

/** Whether a bonus/malus line value counts: one decimal, −9,0..+9,0, not 0 (decision 28). */
export function poLineValid(value: unknown): boolean {
  return coreCall('poLineValid', value);
}

/** The sum of the lines that count. */
export function poLinesSum(lines: PoLine[] | null | undefined): number {
  return coreCall('poLinesSum', lines ?? null);
}

/** A rubric grade with lines added, held between 1,0 and 10,0 (decision 28). */
export function poWithLines(rubricGrade: number, lines: number): number {
  return coreCall('poWithLines', rubricGrade, lines);
}

/**
 * Results of one student for `exam`, override included; null with neither scores nor an
 * overwritten grade for it. Scores of questions no longer in the exam are ignored.
 */
export function examResults(
  rec: ScoreRecord | null | undefined,
  exam: Pick<Exam, 'id' | 'n_term' | 'questions'> &
    Partial<Pick<Exam, 'kind' | 'subject' | 'rubric_id'>>,
): Results | null {
  if (!hasGradeData(rec, exam.id)) return null;
  return coreCall('examResults', recordFor(rec, [exam]), forGrading(exam));
}

type GradedExam = Pick<Exam, 'id' | 'n_term' | 'questions'> &
  Partial<Pick<Exam, 'kind' | 'subject' | 'rubric_id'>>;

/**
 * examResults for many students and exams in one call into the rules (perf hotfix 0.24.1):
 * `[student][exam]`. Records without data for any of the exams are not sent.
 */
export function examResultsMany(
  recs: readonly (ScoreRecord | null | undefined)[],
  exams: readonly GradedExam[],
): (Results | null)[][] {
  const out = recs.map(() => exams.map((): Results | null => null));
  const send: number[] = [];
  recs.forEach((rec, i) => {
    if (exams.some((e) => hasGradeData(rec, e.id))) send.push(i);
  });
  if (!send.length) return out;
  const answers = coreCall<(Results | null)[][]>(
    'examResultsMany',
    send.map((i) => recordFor(recs[i], exams)),
    exams.map(forGrading),
  );
  send.forEach((i, k) => (out[i] = answers[k] ?? out[i]!));
  return out;
}

/**
 * Whether a record holds scores or an override for an exam. Without either the rules answer "no
 * grade" without computing (grade.rs `exam_results`), so callers skip the trip into WebAssembly.
 */
export function hasGradeData(rec: ScoreRecord | null | undefined, examId: string): boolean {
  if (rec?.overrides?.[examId] !== undefined) return true;
  const scores: unknown = rec?.scores?.[examId];
  if (!scores || typeof scores !== 'object') return false;
  for (const _ in scores) return true;
  return false;
}
