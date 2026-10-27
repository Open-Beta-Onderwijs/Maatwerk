// SPDX-License-Identifier: AGPL-3.0-or-later

// Resits and the best attempt per student (business-rules.md section 5).
// Ported from store.js (getResitsSync, computeBestGradeMap,
// resolveBestAttempts, getStudentHistory); pinned by
// tests/golden/logic/attempts.json.

import { calcResults, examResults } from './grades';
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
 * The attempt with the highest grade (override included) among `attempts`
 * (the parent first, then its resits); the earliest wins a tie. Null when no
 * attempt has a grade.
 */
export function bestAttempt(rec: ScoreRecord, attempts: Exam[]): BestEntry | null {
  let bestGrade = -Infinity;
  let bestEntry: BestEntry | null = null;
  for (const attempt of attempts) {
    const res = examResults(rec, attempt);
    if (res && res.grade !== null && res.grade > bestGrade) {
      bestGrade = res.grade;
      const qs: QuestionScores = {};
      attempt.questions.forEach((q) => {
        const v = rec.scores?.[attempt.id]?.[q.id];
        if (v !== undefined) qs[q.id] = v;
      });
      bestEntry = {
        examId: attempt.id,
        exam: attempt,
        questionScores: qs,
        override: rec.overrides?.[attempt.id],
        grade: res.grade,
      };
    }
  }
  return bestEntry;
}

/** History order: school year, then volgnummer. */
export function compareHistory(a: HistoryEntry, b: HistoryEntry): number {
  const ycmp = (a.exam.academic_year ?? '').localeCompare(b.exam.academic_year ?? '');
  return ycmp !== 0 ? ycmp : (a.exam.volgnummer ?? 0) - (b.exam.volgnummer ?? 0);
}

const gradeOf = (e: HistoryEntry) => calcResults(e.exam, e.questionScores, e.override).grade ?? -1;

/**
 * Collapses a flat history so that only the attempt with the highest grade
 * appears per resit group. Standalone exams pass through unchanged.
 */
export function resolveBestAttempts<H extends HistoryEntry>(history: H[]): H[] {
  const parentsWithResits = new Set(
    history.filter((h) => h.exam.parent_id).map((h) => h.exam.parent_id),
  );
  const handledParents = new Set<string>();
  const result: H[] = [];

  // Originals (no parent_id) first
  for (const entry of history) {
    if (entry.exam.parent_id) continue;
    const examId = entry.exam.id;
    if (!parentsWithResits.has(examId)) {
      result.push(entry); // standalone: pass through
      continue;
    }
    handledParents.add(examId);
    const candidates = [entry, ...history.filter((h) => h.exam.parent_id === examId)];
    let best = candidates[0]!;
    for (const c of candidates) if (gradeOf(c) > gradeOf(best)) best = c;
    result.push(best);
  }

  // Resits whose parent has no history entry (the student only did the resit)
  for (const entry of history) {
    if (!entry.exam.parent_id) continue;
    const parentId = entry.exam.parent_id;
    if (handledParents.has(parentId)) continue;
    handledParents.add(parentId);
    const resitGroup = history.filter((h) => h.exam.parent_id === parentId);
    let best = resitGroup[0]!;
    for (const c of resitGroup) if (gradeOf(c) > gradeOf(best)) best = c;
    result.push(best);
  }

  result.sort(compareHistory);
  return result;
}
