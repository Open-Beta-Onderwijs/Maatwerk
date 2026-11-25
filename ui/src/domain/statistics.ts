// SPDX-License-Identifier: AGPL-3.0-or-later

// Averages and statistics. The rules are in Rust (crates/maatwerk-grades, ADR-0011,
// docs/phase-2/step-19-grade-rules.md); this file only gives them types. Give them grades as
// `Results.grade` has them: rounded to one decimal.

import type { HistoryEntry } from './attempts';
import { coreCall } from './core';
import { recordFor, type Points, type RttiCategory, type RttiPoints } from './grades';
import { forGrading } from './po';
import type { Exam, Group, Question, QuestionScores, ScoreRecord } from './types';

export interface Stats {
  n: number;
  mean: number;
  sd: number;
  /** Whole percent of the grades below 5,5. */
  fails: number;
}

export const stats = (grades: number[]): Stats | null => coreCall('stats', grades);
export const mean = (values: number[]): number | null => coreCall('mean', values);

/**
 * How a student's r or SE average is shown (Cijfergemiddelden, decisions 91-93), as stored in
 * the school settings. Missing means afronden 1.
 */
export interface AverageFormat {
  methode: 'afronden' | 'afkappen';
  decimalen: 0 | 1 | 2;
}

/** A student's average as shown under `fmt` (default afronden 1). */
export const shownAverage = (x: number, fmt?: AverageFormat): number =>
  coreCall('shownAverage', x, fmt ?? null);

/** A shown student average below 5,5 (decision 92; afronden 2 shows 5,45 and that fails). */
export const isFailShown = (shown: number): boolean => coreCall('isFailShown', shown);

/** `part` of `whole` as a whole percent; 0 when `whole` is 0 (step 38 answer A). */
export const pct = (part: number, whole: number): number => coreCall('pct', part, whole);

/**
 * A student's number against an average (profile, step 38 answer B): the difference of the
 * shown values. `own` under `fmt` (a test grade: omit it), `mean` at afronden 1.
 */
export const shownDifference = (
  own: number,
  fmt: AverageFormat | undefined,
  mean: number,
): number => coreCall('shownDifference', own, fmt ?? null, mean);

/**
 * The points of a stored or typed score for a question of `max` points; null for N, empty, text,
 * negative or over the maximum (step 38 answer D).
 */
export const scorePoints = (value: unknown, max: number): number | null =>
  coreCall('scorePoints', value ?? null, max);

/** Mean, SD and % onvoldoende of students' averages, as shown under `fmt` (decisions 21, 92). */
export const statsOfAverages = (averages: number[], fmt?: AverageFormat): Stats | null =>
  coreCall('statsOfAverages', averages, fmt ?? null);

/** The mean of students' averages, as shown under `fmt` (decisions 21, 92). */
export const meanOfAverages = (averages: number[], fmt?: AverageFormat): number | null =>
  coreCall('meanOfAverages', averages, fmt ?? null);

/** The weighted year average over one year's tests, unrounded (decision 9). */
export const yearAverage = (exams: Exam[], rec: ScoreRecord | null | undefined): number | null =>
  coreCall('yearAverage', exams.map(forGrading), recordFor(rec, exams));

/** The SE average over a student's history of all years, unrounded (decision 10). */
export const seAverage = (history: HistoryEntry[], exams: Exam[]): number | null =>
  coreCall(
    'seAverage',
    history.map((h) => ({ ...h, exam: forGrading(h.exam) })),
    exams.map(forGrading),
  );

export interface Histogram {
  bins: number[];
  /** Upper bound of each bin; the last includes it. */
  upper: number[];
  /** The pass line sits before this bin. */
  passBin: number;
}

export const histogram = (grades: number[], step: 0.5 | 1): Histogram =>
  coreCall('histogram', grades, step);

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/** As Excel's QUARTILE.INC (decision 14). */
export const boxStats = (values: number[]): BoxStats | null => coreCall('boxStats', values);

/** One attempt of one student in a statistic, read with its own questions (decision 17). */
export interface StatAttempt {
  exam: Exam;
  questionScores: QuestionScores;
  grade: number | null;
}

export interface QuestionStat {
  question: string;
  points: Points;
}

/** Vraaganalyse: pooled per question; `N` and invalid are 0 of the maximum, empty is left out. */
export const questionStats = (attempts: StatAttempt[]): QuestionStat[] =>
  coreCall('questionStats', attempts);

/** RTTI points per grade group, pooled over normal questions. */
export const rttiByGradeGroup = (attempts: StatAttempt[]): RttiPoints[] =>
  coreCall('rttiByGradeGroup', attempts);

/** RTTI points pooled over a student's attempts (decision 7). */
export const pooledRtti = (history: HistoryEntry[]): RttiPoints => coreCall('pooledRtti', history);

/**
 * The tests in a student's RTTI Gem.: those of a school year without the diagnostic ones (decision
 * 27), or for `'se'` the PTA tests. The bars keep showing every test.
 */
export function rttiGemHistory<H extends HistoryEntry>(history: H[], selected: string): H[] {
  return selected === 'se'
    ? history.filter((h) => h.exam.type === 'pta')
    : history.filter((h) => h.exam.academic_year === selected && !h.exam.diagnostic);
}

export interface ClassQuestion {
  classAvg: number;
  classPct: number;
}

/** The class's result per question, in order: one call for the whole rapport (review M7). */
export const classQuestions = (questions: Question[], all: QuestionScores[]): ClassQuestion[] =>
  coreCall('classQuestions', questions, all);

export interface RapportCategory {
  scored: number;
  max: number;
  pct: number | null;
  share: number | null;
}

/** The rapport's RTTI numbers: an empty question is 0 of its max here (decision 24). */
export const rapportTotals = (
  exam: Pick<Exam, 'id' | 'kind' | 'questions'>,
  scores: QuestionScores,
): Record<RttiCategory, RapportCategory> => coreCall('rapportTotals', exam, scores);

/** The rapport histogram's 12 counts; null below 10 grades. */
export const rapportBins = (grades: number[]): number[] | null => coreCall('rapportBins', grades);
export const rapportBin = (grade: number): number => coreCall('rapportBin', grade);

export const adviceBracket = (
  scored: number,
  max: number,
  limits?: { laag_midden: number; midden_hoog: number } | null,
): 'laag' | 'midden' | 'hoog' => coreCall('adviceBracket', scored, max, limits);

/** The rapport's ranking line: from 10 grades on, the same students as before (decision 16). */
export const ranking = (grade: number, grades: number[]): 'top10' | 'top20' | null =>
  coreCall('ranking', grade, grades);

/** The id of the student's group for `exam` (decision 17); null when in no group. */
export function studentGroup(studentId: string, exam: Exam, groups: Group[]): string | null {
  const id = String(studentId);
  // Only the student's own groups, each with only this student: this runs per student.
  const own = groups
    .filter((g) => g.student_ids.some((s) => String(s) === id))
    .map((g) => ({ ...g, student_ids: [id] }));
  const { id: examId, subject, jaarlaag, schoolsoort } = exam;
  return coreCall('studentGroup', id, { id: examId, subject, jaarlaag, schoolsoort }, own);
}

/** One whole percent per RTTI category; null when the category has nothing to measure. */
export const rttiPercents = (points: RttiPoints, cats: RttiCategory[]): (number | null)[] =>
  cats.map((cat) => {
    const { scored, max } = points[cat];
    return max > 0 ? pct(scored, max) : null;
  });

export type TrendLevel = 'strongUp' | 'slightUp' | 'level' | 'slightDown' | 'strongDown';

export interface Trend {
  last: number;
  average: number;
  d: number;
  level: TrendLevel;
}

/** The trend arrow of one student in one year (decision 13). */
export const trend = (exams: Exam[], rec: ScoreRecord | null | undefined): Trend | null =>
  coreCall('trend', exams.map(forGrading), recordFor(rec, exams));
