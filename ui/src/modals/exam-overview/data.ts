// SPDX-License-Identifier: AGPL-3.0-or-later

// The numbers of the exam overview (F-11; design spec 4.6, board 46; PLAN-2 decisions 35, 36).
// Ported from modals/toets-overzicht.js (R-05) with the same rules: every student's attempt is
// read with its own questions (decision 17, B14); in the verzameloverzicht the attempt that
// counts comes from the caller and its observaties are that attempt's (B-05). Charts per group
// put each student in one group (`studentGroup`); the Resultaten sections are the exam's groups
// as in the score modal.

import { calcResults, type Results } from '../../domain/grades';
import { questionStats, studentGroup, type StatAttempt } from '../../domain/statistics';
import type {
  Exam,
  Group,
  Observatie,
  Override,
  QuestionScores,
  ScoreRecord,
  Student,
} from '../../domain/types';
import { Store } from '../../store.js';
import { gradeGroupIdx } from '../../utils/grades';

/** The attempt that counts per student in the verzameloverzicht (computeBestGradeMap). */
export interface BestEntry {
  exam?: Exam;
  questionScores?: QuestionScores;
  grade?: number | null;
  override?: Override;
}

export interface StudentData {
  /** The attempt read (the original, or in the verzameloverzicht the one that counts). */
  exam: Exam;
  questionScores: QuestionScores;
  override: Override | undefined;
  results: Results | null;
  grade: number | null;
  /** True when a resit counts (verzameloverzicht). */
  attempt: Exam | null;
  obs: string[];
}

export interface ObsCount {
  count: number;
  byGroup: Record<string, number>;
  byGradeGroup: number[];
}

export interface Graded {
  id: string;
  grade: number;
}

export interface GroupStats {
  group: Group;
  grades: number[];
  attempts: StatAttempt[];
  /** The students with a grade, for the boxplot dots. */
  graded: Graded[];
}

export interface ExamOverviewData {
  exam: Exam;
  year: string;
  isSummary: boolean;
  students: Student[];
  /** Per student id; absent when the student has neither scores nor observaties. */
  byStudent: Map<string, StudentData>;
  grades: number[];
  graded: Graded[];
  attempts: StatAttempt[];
  /** Per group (one group per student), by name. */
  groups: GroupStats[];
  /** The exam's observaties (in the summary also those only a resit has), by name. */
  observaties: Observatie[];
  obs: Record<string, ObsCount>;
}

/** Any points to show per question for these attempts. */
export function hasPoints(list: StatAttempt[]): boolean {
  return questionStats(list).some((s) => s.points.max > 0);
}

export async function loadExamOverview(
  exam: Exam,
  year: string,
  scoreOverride: Record<string, BestEntry> | null,
  isSummary: boolean,
): Promise<ExamOverviewData> {
  const students = Store.getStudentsSync(year) as Student[];
  const allGroups = Store.getGroupsSync(year) as Group[];
  const groupsById = new Map(allGroups.map((g) => [g.id, g]));
  const groupOf = (s: Student) => groupsById.get(studentGroup(s.id, exam, allGroups) ?? '');

  const allObs = Store.getObservatiesSync() as Observatie[];
  // The summary also lists what only an attempt has (migrated resits: original's + own).
  const allAttempts: Exam[] = isSummary
    ? [exam, ...(Store.getResitsSync(exam.id, year) as Exam[])]
    : [exam];
  const obsIds = [...new Set(allAttempts.flatMap((e) => e.obs_ids ?? []))];
  const observaties = obsIds
    .map((id) => allObs.find((o) => o.id === id))
    .filter((o): o is Observatie => !!o)
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'));
  const obs: Record<string, ObsCount> = {};
  for (const o of observaties)
    obs[o.id] = { count: 0, byGroup: {}, byGradeGroup: Array(6).fill(0) };

  const byStudent = new Map<string, StudentData>();
  const grades: number[] = [];
  const graded: Graded[] = [];
  const attempts: StatAttempt[] = [];
  const groupStats = new Map<string, GroupStats>();

  for (const s of students) {
    const rec = (await Store.getStudentScores(s.id, year)) as ScoreRecord | null;
    const best = scoreOverride ? (scoreOverride[s.id] ?? null) : null;
    const scores = best ? (best.questionScores ?? {}) : rec?.scores?.[exam.id];
    const override = best ? best.override : rec?.overrides?.[exam.id];
    // In the summary: the observaties of the attempt that counts, like the grade (B-05); without
    // a grade no attempt counts, so those of all of them.
    const studentObs = best?.exam
      ? (rec?.observations?.[best.exam.id] ?? [])
      : [...new Set(allAttempts.flatMap((e) => rec?.observations?.[e.id] ?? []))];
    const grp = groupOf(s);
    const countObs = (grade: number | null) => {
      for (const id of studentObs) {
        const acc = obs[id];
        if (!acc) continue;
        acc.count++;
        if (grp) acc.byGroup[grp.id] = (acc.byGroup[grp.id] ?? 0) + 1;
        if (grade !== null) acc.byGradeGroup[gradeGroupIdx(grade)]!++;
      }
    };
    // The attempt that counts is read with its own questions, not the original's (B14).
    const evalExam = best?.exam ?? exam;
    const qs: QuestionScores = {};
    for (const q of evalExam.questions) {
      const v = scores?.[q.id];
      if (v !== undefined) qs[q.id] = v;
    }
    const hasScores = Object.keys(qs).length > 0;
    if ((!scores || !Object.keys(scores).length) && !override) {
      if (studentObs.length) {
        byStudent.set(String(s.id), {
          exam: evalExam,
          questionScores: {},
          override,
          results: null,
          grade: null,
          attempt: best?.exam ?? null,
          obs: studentObs,
        });
      }
      // Not counted in the Observaties tab: its percentages are of the students with a score
      // (user 2026-11-15, review 29 m1). The Resultaten row still shows the icons.
      continue;
    }
    const results = hasScores || override ? calcResults(evalExam, qs, override) : null;
    const grade = best?.grade ?? results?.grade ?? null;
    if (grade !== null) {
      grades.push(grade);
      graded.push({ id: String(s.id), grade });
    }
    const attempt: StatAttempt = { exam: evalExam, questionScores: qs, grade };
    attempts.push(attempt);
    byStudent.set(String(s.id), {
      exam: evalExam,
      questionScores: qs,
      override,
      results,
      grade,
      attempt: best?.exam ?? null,
      obs: studentObs,
    });
    if (grp) {
      if (!groupStats.has(grp.id))
        groupStats.set(grp.id, { group: grp, grades: [], attempts: [], graded: [] });
      const g = groupStats.get(grp.id)!;
      if (grade !== null) {
        g.grades.push(grade);
        g.graded.push({ id: String(s.id), grade });
      }
      g.attempts.push(attempt);
    }
    countObs(grade);
  }

  return {
    exam,
    year,
    isSummary,
    students,
    byStudent,
    grades,
    graded,
    attempts,
    groups: [...groupStats.values()].sort((a, b) => a.group.name.localeCompare(b.group.name)),
    observaties,
    obs,
  };
}
