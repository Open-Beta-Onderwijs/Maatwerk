// SPDX-License-Identifier: AGPL-3.0-or-later

// The numbers of one test's cards on the Toetsen screen (F-27): per attempt its grades and
// observaties, and for a stack the Verzamelkaart's. Built chunk by chunk of students, one call
// into the grade rules per chunk (perf hotfix 0.24.1); the result is the same as one student at a
// time (block-numbers.test.ts).

import { bestAttemptMany } from '../../domain/attempts';
import { examResultsMany } from '../../domain/grades';
import { isPo } from '../../domain/po';
import { poStudentObs } from '../../domain/po-grading';
import type { Exam, ScoreRecord } from '../../domain/types';
import type { CardNumbers } from './card-model';

export interface BlockNumbers {
  /** Per attempt id (the original and its resits). */
  per: Map<string, CardNumbers>;
  /** The Verzamelkaart: only filled for a stack (an original with resits). */
  summary: CardNumbers;
}

/** A student's observaties of one attempt: a test's list, or a PO's general and category ones. */
export function obsOf(rec: ScoreRecord | null | undefined, exam: Exam): string[] {
  return isPo(exam) ? poStudentObs(rec ?? null, exam.id) : (rec?.observations?.[exam.id] ?? []);
}

const emptyNumbers = (): CardNumbers => ({ grades: [], obs: new Map() });

/** Counts each observatie once per student. */
export function countObs(numbers: CardNumbers, ids: readonly string[]): void {
  for (const id of new Set(ids)) numbers.obs.set(id, (numbers.obs.get(id) ?? 0) + 1);
}

/** Empty numbers for an original and its resits. */
export function newBlock(attempts: readonly Exam[]): BlockNumbers {
  return { per: new Map(attempts.map((a) => [a.id, emptyNumbers()])), summary: emptyNumbers() };
}

/**
 * Adds a chunk of students' records. The Verzamelkaart takes the best attempt per student; its
 * observaties are those of the attempt that counts, without a grade those of all attempts (as
 * the verzameloverzicht).
 */
export function addRecords(
  block: BlockNumbers,
  recs: readonly (ScoreRecord | null | undefined)[],
  original: Exam,
  resits: readonly Exam[],
): void {
  const attempts = [original, ...resits];
  const results = examResultsMany(recs, attempts);
  const bests = resits.length ? bestAttemptMany(recs, attempts) : null;
  recs.forEach((rec, k) => {
    attempts.forEach((a, j) => {
      const nums = block.per.get(a.id)!;
      const res = results[k]?.[j];
      if (res && res.grade !== null) nums.grades.push(res.grade);
      countObs(nums, obsOf(rec, a));
    });
    if (!bests) return;
    const best = bests[k];
    if (best) block.summary.grades.push(best.grade);
    countObs(block.summary, best ? obsOf(rec, best.exam) : attempts.flatMap((a) => obsOf(rec, a)));
  });
}
