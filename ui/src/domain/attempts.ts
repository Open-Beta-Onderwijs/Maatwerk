// SPDX-License-Identifier: AGPL-3.0-or-later

// Resits and the attempt that counts. The rules are in Rust (crates/maatwerk-grades, ADR-0011,
// decision 8); this file gives them types and joins the answers back to the UI's objects.

import { coreCall } from './core';
import { recordFor } from './grades';
import type { Exam, Override, QuestionScores, ScoreRecord } from './types';

/** One attempt in a student's history (getStudentHistory). */
export interface HistoryEntry {
  exam: Exam & { academic_year?: string };
  questionScores: QuestionScores;
  override?: Override;
}

/** The best attempt of one student for a parent exam and its resits. */
export interface BestEntry {
  examId: string;
  exam: Exam;
  questionScores: QuestionScores;
  override?: Override;
  grade: number;
}

/** Resits of `parentId` among `exams`, by attempt number. */
export function resitsOf<E extends Exam>(exams: E[], parentId: string): E[] {
  return exams
    .filter((e) => e.parent_id === parentId)
    .sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
}

/**
 * The attempt with the highest grade (override included) among `attempts` (the parent first, then
 * its resits); the earliest wins a tie. Null when no attempt has a grade.
 */
export function bestAttempt(
  rec: ScoreRecord | null | undefined,
  attempts: Exam[],
): BestEntry | null {
  const best = coreCall<{ examId: string; grade: number } | null>(
    'bestAttempt',
    recordFor(rec, attempts),
    attempts,
  );
  const exam = best && attempts.find((e) => e.id === best.examId);
  if (!best || !exam) return null;
  const questionScores: QuestionScores = {};
  for (const q of exam.questions) {
    const v = rec?.scores?.[exam.id]?.[q.id];
    if (v !== undefined) questionScores[q.id] = v;
  }
  return { ...best, exam, questionScores, override: rec?.overrides?.[exam.id] };
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
  return coreCall<number[]>('resolveBestAttempts', history).map((i) => history[i]!);
}
