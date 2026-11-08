// SPDX-License-Identifier: AGPL-3.0-or-later

// Averages and statistics. The rules are in Rust (crates/maatwerk-grades, ADR-0011,
// docs/phase-2/step-19-grade-rules.md); this file only gives them types. Give them grades as
// `Results.grade` has them: rounded to one decimal.

import type { HistoryEntry } from './attempts';
import { coreCall } from './core';
import { recordFor, type Points, type RttiPoints } from './grades';
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

/** Mean, SD and % onvoldoende of students' averages, as shown (decision 21). */
export const statsOfAverages = (averages: number[]): Stats | null =>
  coreCall('statsOfAverages', averages);

/** The mean of students' averages, as shown (decision 21). */
export const meanOfAverages = (averages: number[]): number | null =>
  coreCall('meanOfAverages', averages);

/** The weighted year average over one year's tests, unrounded (decision 9). */
export const yearAverage = (exams: Exam[], rec: ScoreRecord | null | undefined): number | null =>
  coreCall('yearAverage', exams, recordFor(rec, exams));

/** The SE average over a student's history of all years, unrounded (decision 10). */
export const seAverage = (history: HistoryEntry[], exams: Exam[]): number | null =>
  coreCall('seAverage', history, exams);

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

export interface ClassQuestion {
  classAvg: number;
  classPct: number;
}

export const classQuestion = (question: Question, all: QuestionScores[]): ClassQuestion =>
  coreCall('classQuestion', question, all);

export const adviceBracket = (
  scored: number,
  max: number,
  limits?: { laag_midden: number; midden_hoog: number } | null,
): 'laag' | 'midden' | 'hoog' => coreCall('adviceBracket', scored, max, limits);

/** The rapport's ranking line: from 10 grades on, the same students as before (decision 16). */
export const ranking = (grade: number, grades: number[]): 'top10' | 'top20' | null =>
  coreCall('ranking', grade, grades);

/** The id of the student's group for `exam` (decision 17); null when in no group. */
export const studentGroup = (studentId: string, exam: Exam, groups: Group[]): string | null =>
  coreCall('studentGroup', String(studentId), exam, groups);

export type TrendLevel = 'strongUp' | 'slightUp' | 'level' | 'slightDown' | 'strongDown';

export interface Trend {
  last: number;
  average: number;
  d: number;
  level: TrendLevel;
}

/** The trend arrow of one student in one year (decision 13). */
export const trend = (exams: Exam[], rec: ScoreRecord | null | undefined): Trend | null =>
  coreCall('trend', exams, recordFor(rec, exams));
