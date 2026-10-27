// SPDX-License-Identifier: AGPL-3.0-or-later

// Grade and RTTI calculation from question scores (business-rules.md sections
// 3-4). Ported from store.js (calcResults, examResults, calcGrade, qKind);
// pinned by tests/golden/logic/grades.json.

import type { Exam, Override, Question, QuestionKind, QuestionScores, ScoreRecord } from './types';

/** The kind of a question; absence means 'normal'. */
export function qKind(q: Pick<Question, 'kind'>): QuestionKind {
  return q.kind ?? 'normal';
}

/** RTTI percentage per category, or 'NVT' when the category has no points. */
export type RttiPct = number | 'NVT';

export interface Results {
  scored: number;
  normalMax: number;
  bonusMax: number;
  examMaxTotal: number;
  hasBonus: boolean;
  /** The grade that counts (the override if there is one); null when nothing gradeable. */
  grade: number | null;
  calculatedGrade: number | null;
  overridden: boolean;
  /** The calculated grade changed since the override was set. */
  overrideStale: boolean;
  R: RttiPct;
  T1: RttiPct;
  T2: RttiPct;
  I: RttiPct;
}

/** Grade from points with the n-term and its four bounds (BR 3.2). */
export function calcGrade(scored: number, max: number, nTerm: number): number {
  const raw = (scored / max) * 9 + nTerm;
  const lo1 = 1 + (2 * scored * 9) / max;
  const hi1 = 10 - (0.5 * (max - scored) * 9) / max;
  const lo2 = 1 + (0.5 * scored * 9) / max;
  const hi2 = 10 - (2 * (max - scored) * 9) / max;
  if (raw > lo1) return Math.min(lo1, 10);
  if (raw > hi1) return Math.min(hi1, 10);
  if (raw < lo2) return Math.max(lo2, 1);
  if (raw < hi2) return Math.max(hi2, 1);
  return Math.min(Math.max(raw, 1), 10);
}

/**
 * Grade, points and RTTI percentages of one attempt. `override` ({ cijfer,
 * berekend }) replaces the grade; the RTTI percentages and points still come
 * from the scores. An unknown `rtti` tag on an entered normal question throws
 * (quirk B28), as in the reference.
 */
export function calcResults(
  exam: Pick<Exam, 'n_term' | 'questions'>,
  questionScores: QuestionScores,
  override?: Override | null,
): Results {
  const n = exam.n_term ?? 1;
  const normalMax = exam.questions
    .filter((q) => qKind(q) === 'normal')
    .reduce((s, q) => s + q.max_points, 0);
  const bonusMax = exam.questions
    .filter((q) => qKind(q) === 'bonus')
    .reduce((s, q) => s + q.max_points, 0);
  const examMaxTotal = normalMax + bonusMax;

  let scored = 0;
  const cats: Record<string, [number, number]> = { R: [0, 0], T1: [0, 0], T2: [0, 0], I: [0, 0] };
  let anyGradeableEntered = false;

  for (const q of exam.questions) {
    const raw = questionScores[q.id];
    if (raw === undefined) continue;
    const kind = qKind(q);
    const isN = raw === null || String(raw).toUpperCase() === 'N';
    if (!isN) {
      const num = Number(raw);
      if (isNaN(num) || num < 0 || num > q.max_points) {
        if (kind === 'normal') cats[q.rtti]![1] += q.max_points;
        continue;
      }
      if (kind === 'diag') continue; // diag scores don't affect grade or RTTI
      anyGradeableEntered = true;
      scored += num; // normal and bonus both count towards scored
      if (kind === 'normal') {
        cats[q.rtti]![0] += num;
        cats[q.rtti]![1] += q.max_points;
      }
    } else {
      if (kind === 'normal') cats[q.rtti]![1] += q.max_points;
      if (kind !== 'diag') anyGradeableEntered = true;
    }
  }

  let grade: number | null = null;
  if (anyGradeableEntered && normalMax > 0) {
    grade = scored >= normalMax ? 10 : calcGrade(scored, normalMax, n);
  }

  const calculatedGrade = grade;
  const overridden = typeof override?.cijfer === 'number';
  if (overridden) grade = override!.cijfer;
  const round1 = (g: number | null | undefined) =>
    g === null || g === undefined ? null : Math.round(g * 10) / 10;

  const pct = (cat: string): RttiPct =>
    cats[cat]![1] > 0 ? Math.round((cats[cat]![0] / cats[cat]![1]) * 100) : 'NVT';
  return {
    scored,
    normalMax,
    bonusMax,
    examMaxTotal,
    hasBonus: bonusMax > 0,
    grade,
    calculatedGrade,
    overridden,
    overrideStale: overridden && round1(override!.berekend) !== round1(calculatedGrade),
    R: pct('R'),
    T1: pct('T1'),
    T2: pct('T2'),
    I: pct('I'),
  };
}

/**
 * Results of one student (score record `rec`) for `exam`, override included;
 * null when the student has neither scores nor an overwritten grade for it.
 * Scores of questions that are no longer in the exam are ignored.
 */
export function examResults(
  rec: ScoreRecord | null | undefined,
  exam: Pick<Exam, 'id' | 'n_term' | 'questions'>,
): Results | null {
  const examScores = rec?.scores?.[exam.id] ?? {};
  const qs: QuestionScores = {};
  exam.questions.forEach((q) => {
    const v = examScores[q.id];
    if (v !== undefined) qs[q.id] = v;
  });
  const override = rec?.overrides?.[exam.id];
  if (!Object.keys(qs).length && !override) return null;
  return calcResults(exam, qs, override);
}
