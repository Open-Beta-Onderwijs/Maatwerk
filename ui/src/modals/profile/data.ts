// SPDX-License-Identifier: AGPL-3.0-or-later

// What the student profile reads (F-25; design spec 4.15): the student's history over every
// school year of the vak, the attempts that count (decision 7: the Cijferverloop and the RTTI
// "Gemiddeld" card) and every graded attempt (the per-year rows and the RTTI cards; B15), the
// observaties per school year, and the comparisons: a test's average and SD, the jaarlaag's
// year average and SD, and the jaarlaag's SE average over the peers of the student's own last
// year (B16, decision 12). R-05: was modals/profiel.js.

import type { HistoryEntry } from '../../domain/attempts';
import type { Results } from '../../domain/grades';
import { seAverage, stats, statsOfAverages, type Stats } from '../../domain/statistics';
import type { Exam, Observatie, ScoreRecord, Student } from '../../domain/types';
import { isPo, rubricOf } from '../../domain/po';
import { poObsIds, poStudentObs } from '../../domain/po-grading';
import type { Rubric } from '../../domain/rubric';
import { Store } from '../../store.js';

/**
 * Per observatie, in how many of the year's tests and PO's the student got it. A test counts the
 * observaties it links (`obs_ids`); a PO also those of its rubric and of every category, given in
 * general or per category (step 37, backlog 29c "Profile observaties"). Pure.
 */
export function obsCounts(
  exams: readonly Exam[],
  rec: ScoreRecord | null | undefined,
  rubricOfExam: (exam: Exam) => Rubric | null,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const exam of exams) {
    const po = isPo(exam);
    const linked = po ? poObsIds(exam, rubricOfExam(exam)) : (exam.obs_ids ?? []);
    const given = po ? poStudentObs(rec, exam.id) : (rec?.observations?.[exam.id] ?? []);
    // A PO's union is counted once per id; a test counts its list as before step 37, a duplicate
    // id included (review 37 m3: no number change outside the approved before/after).
    for (const id of po ? new Set(given) : given)
      if (linked.includes(id)) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export type YearExam = Exam & { academic_year?: string };

export interface ProfileTest extends HistoryEntry {
  exam: YearExam;
  res: Results;
}

export interface ProfileData {
  student: Student;
  /** The attempts that count, with a grade, in history order. */
  counted: ProfileTest[];
  /** Every attempt with a grade (resits too). */
  attempts: ProfileTest[];
  /** The best-attempt history (RTTI "Gemiddeld", decision 7). */
  history: HistoryEntry[];
  years: string[];
  jaarlaagByYear: Record<string, string>;
  /** Per school year: how often each observatie was given (only observaties of that test). */
  obsPerYear: Record<string, Record<string, number>>;
  observaties: Observatie[];
  /** The student's jaarlaag now (from the stamklas). */
  currentJaarlaag: number;
}

const graded = (t: { res: Results }) => t.res.grade !== null;

export async function loadProfile(studentId: string, year: string): Promise<ProfileData | null> {
  const students = (await Store.getStudents(year)) as Student[];
  const student = students.find((s) => s.id === studentId);
  if (!student) return null;
  const raw = (await Store.getStudentHistory(studentId)) as HistoryEntry[];
  const history = Store.resolveBestAttempts(raw) as HistoryEntry[];
  const withRes = (h: HistoryEntry): ProfileTest => ({
    ...h,
    res: Store.calcResults(h.exam, h.questionScores, h.override, h.po) as Results,
  });
  const counted = history.map(withRes).filter(graded);
  const attempts = raw.map(withRes).filter(graded);
  const jaarlaagByYear: Record<string, string> = {};
  for (const { exam } of history)
    if (exam.academic_year && !jaarlaagByYear[exam.academic_year])
      jaarlaagByYear[exam.academic_year] = String(exam.jaarlaag ?? '');
  const years = [...new Set(history.map((h) => (h.exam as YearExam).academic_year ?? ''))].sort();
  const obsPerYear: Record<string, Record<string, number>> = {};
  for (const yr of years) {
    const exams = Store.getExamsSync(yr) as Exam[];
    const rec = (await Store.getStudentScores(studentId, yr)) as ScoreRecord | null;
    obsPerYear[yr] = obsCounts(exams, rec, (e) => (rubricOf(e) as Rubric | undefined) ?? null);
  }
  return {
    student,
    counted,
    attempts,
    history,
    years,
    jaarlaagByYear,
    obsPerYear,
    observaties: Store.getObservatiesSync() as Observatie[],
    currentJaarlaag: parseInt(Store.jaarlaagFromStamklas(student.stamklas ?? '') || '0', 10),
  };
}

/** Mean and SD of a test's grades over the students of its school year. */
export async function examStats(year: string, exam: Exam): Promise<Stats | null> {
  const grades: number[] = [];
  for (const s of Store.getStudentsSync(year) as Student[]) {
    const rec = (await Store.getStudentScores(s.id, year)) as ScoreRecord | null;
    const res = Store.examResults(rec, exam) as Results | null;
    if (res && res.grade !== null) grades.push(res.grade);
  }
  return grades.length ? stats(grades) : null;
}

export interface YearComparison {
  /** A school year, or `se` for the examendossier. */
  key: string;
  student: number | null;
  peers: Stats | null;
}

/**
 * The student's year average against the jaarlaag's (mean and SD of the students' averages,
 * decision 21) per school year, then the SE average against the jaarlaag's, the peers taken from
 * the student's own last year (B16, decision 12).
 */
export async function yearComparisons(d: ProfileData): Promise<YearComparison[]> {
  const id = d.student.id;
  const own: Record<string, number | null> = {};
  for (const yr of d.years) {
    const rec = (await Store.getStudentScores(id, yr)) as ScoreRecord | null;
    own[yr] = Store.studentYearAverage(rec, yr) as number | null;
  }
  const out: YearComparison[] = [];
  for (const yr of d.years) {
    const jl = d.jaarlaagByYear[yr];
    const avgs: number[] = [];
    if (jl) {
      for (const s of Store.getStudentsSync(yr) as Student[]) {
        if (Store.jaarlaagFromStamklas(s.stamklas ?? '') !== jl) continue;
        const avg =
          s.id === id
            ? own[yr]
            : (Store.studentYearAverage(
                (await Store.getStudentScores(s.id, yr)) as ScoreRecord | null,
                yr,
              ) as number | null);
        if (avg !== null && avg !== undefined) avgs.push(avg);
      }
    }
    out.push({
      key: yr,
      student: own[yr] ?? null,
      peers: avgs.length ? statsOfAverages(avgs) : null,
    });
  }
  const allExams = Store.getAllExamsSync() as Exam[];
  const studentSe = seAverage(d.history, allExams);
  const last = d.years[d.years.length - 1];
  if (studentSe !== null && last) {
    const jl = d.jaarlaagByYear[last] ?? String(d.currentJaarlaag);
    const avgs = [studentSe];
    for (const s of Store.getStudentsSync(last) as Student[]) {
      if (s.id === id || Store.jaarlaagFromStamklas(s.stamklas ?? '') !== jl) continue;
      const avg = seAverage((await Store.getStudentHistory(s.id)) as HistoryEntry[], allExams);
      if (avg !== null) avgs.push(avg);
    }
    out.push({ key: 'se', student: studentSe, peers: statsOfAverages(avgs) });
  }
  return out;
}
