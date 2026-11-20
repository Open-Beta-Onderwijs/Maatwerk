// SPDX-License-Identifier: AGPL-3.0-or-later

// Resits and the attempt that counts. The rules are in Rust (crates/maatwerk-grades, ADR-0011,
// decision 8); this file gives them types and joins the answers back to the UI's objects.

import { coreCall } from './core';
import { hasGradeData, recordFor } from './grades';
import { forGrading, isPo, rubricOf } from './po';
import type { Exam, Override, PoGrading, QuestionScores, ScoreRecord } from './types';

/** One attempt in a student's history (getStudentHistory). */
export interface HistoryEntry {
  exam: Exam & { academic_year?: string };
  questionScores: QuestionScores;
  override?: Override;
  /** A PO's `po[examId]`: its bonus/malus lines count (decision 28). */
  po?: PoGrading;
}

/** The best attempt of one student for a parent exam and its resits. */
export interface BestEntry {
  examId: string;
  exam: Exam;
  questionScores: QuestionScores;
  override?: Override;
  po?: PoGrading;
  grade: number;
}

/** Resits of `parentId` among `exams`, by attempt number. */
export function resitsOf<E extends Exam>(exams: E[], parentId: string): E[] {
  return exams
    .filter((e) => e.parent_id === parentId)
    .sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
}

/** The attempt that counts, of one student in a batch (bestAttemptMany). */
export interface BestGrade {
  exam: Exam;
  grade: number;
}

/**
 * bestAttempt's attempt and grade for many students in one call into the rules (perf hotfix
 * 0.24.1); records without data for any attempt are not sent.
 */
export function bestAttemptMany(
  recs: readonly (ScoreRecord | null | undefined)[],
  attempts: Exam[],
): (BestGrade | null)[] {
  const out: (BestGrade | null)[] = recs.map(() => null);
  const send: number[] = [];
  recs.forEach((rec, i) => {
    if (attempts.some((e) => hasGradeData(rec, e.id))) send.push(i);
  });
  if (!send.length) return out;
  const answers = coreCall<({ examId: string; grade: number } | null)[]>(
    'bestAttemptMany',
    send.map((i) => recordFor(recs[i], attempts)),
    attempts.map(forGrading),
  );
  const byId = new Map(attempts.map((e) => [e.id, e]));
  send.forEach((i, k) => {
    const best = answers[k];
    const exam = best && byId.get(best.examId);
    if (best && exam) out[i] = { exam, grade: best.grade };
  });
  return out;
}

/**
 * The attempt with the highest grade (override included) among `attempts` (the parent first, then
 * its resits); the earliest wins a tie. Null when no attempt has a grade.
 */
export function bestAttempt(
  rec: ScoreRecord | null | undefined,
  attempts: Exam[],
): BestEntry | null {
  // Without scores or an override no attempt has a grade: no trip into the rules.
  if (!attempts.some((e) => hasGradeData(rec, e.id))) return null;
  const best = coreCall<{ examId: string; grade: number } | null>(
    'bestAttempt',
    recordFor(rec, attempts),
    attempts.map(forGrading),
  );
  const exam = best && attempts.find((e) => e.id === best.examId);
  if (!best || !exam) return null;
  const questionScores: QuestionScores = {};
  // A PO's scores are per rubric category (step 22), a test's per question.
  const ids = isPo(exam)
    ? (rubricOf(exam)?.categories ?? []).map((c) => c.id)
    : exam.questions.map((q) => q.id);
  for (const id of ids) {
    const v = rec?.scores?.[exam.id]?.[id];
    if (v !== undefined) questionScores[id] = v;
  }
  return {
    ...best,
    exam,
    questionScores,
    override: rec?.overrides?.[exam.id],
    po: rec?.po?.[exam.id],
  };
}

/** History order: school year, then volgnummer. */
export function compareHistory(a: HistoryEntry, b: HistoryEntry): number {
  const ycmp = (a.exam.academic_year ?? '').localeCompare(b.exam.academic_year ?? '');
  return ycmp !== 0 ? ycmp : (a.exam.volgnummer ?? 0) - (b.exam.volgnummer ?? 0);
}

/**
 * The attempt that counts per test, in history order. A test in which nothing has a grade keeps
 * its earliest attempt, so it stays in the student's list.
 */
export function resolveBestAttempts<H extends HistoryEntry>(history: H[]): H[] {
  const graded = history.map((h) => ({ ...h, exam: forGrading(h.exam) }));
  return coreCall<number[]>('resolveBestAttempts', graded).map((i) => history[i]!);
}
