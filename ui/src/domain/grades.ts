// SPDX-License-Identifier: AGPL-3.0-or-later

// Grade and RTTI of one attempt. The rules are in Rust (crates/maatwerk-grades, ADR-0011,
// docs/phase-2/step-19-grade-rules.md); this file only gives them types.

import { coreCall } from './core';
import { forGrading } from './po';
import type { Exam, Override, Question, QuestionKind, QuestionScores, ScoreRecord } from './types';

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
}

/** The exact grade from points with the n-term and its bounds (decision 1). */
export function calcGrade(scored: number, max: number, nTerm: number): number {
  return coreCall('calcGrade', scored, max, nTerm);
}

/** Grade, points and RTTI percentages of one attempt. */
export function calcResults(
  exam: Pick<Exam, 'n_term' | 'questions'> & Partial<Pick<Exam, 'kind' | 'subject' | 'rubric_id'>>,
  questionScores: QuestionScores,
  override?: Override | null,
): Results {
  return coreCall('calcResults', forGrading(exam), questionScores, override);
}

/**
 * Only what the rules need of a student's record for `exams`: a record holds every test of the
 * year, and this runs for every cell of the overviews.
 */
export function recordFor(
  rec: ScoreRecord | null | undefined,
  exams: Pick<Exam, 'id'>[],
): Pick<ScoreRecord, 'scores' | 'overrides'> {
  const scores: NonNullable<ScoreRecord['scores']> = {};
  const overrides: NonNullable<ScoreRecord['overrides']> = {};
  for (const { id } of exams) {
    const s = rec?.scores?.[id];
    const o = rec?.overrides?.[id];
    if (s) scores[id] = s;
    if (o) overrides[id] = o;
  }
  return { scores, overrides };
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
  return coreCall('examResults', recordFor(rec, [exam]), forGrading(exam));
}
