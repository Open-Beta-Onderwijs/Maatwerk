// SPDX-License-Identifier: AGPL-3.0-or-later

// What the student profile reads (F-25; design spec 4.15): the student's history over every
// school year of the vak, the attempts that count (decision 7: the Cijferverloop and the RTTI
// "Gemiddeld" card) and every graded attempt (the per-year rows and the RTTI cards; B15), the
// observaties per school year, and the comparisons: a test's average and SD, the jaarlaag's
// year average and SD, and the jaarlaag's SE average over the peers of the student's own last
// year (B16, decision 12). R-05: was modals/profiel.js.

import type { HistoryEntry } from '../../domain/attempts';
import type { Results } from '../../domain/grades';
import type { Shown } from '../../domain/numbers';
import { statsOfAverages, type AverageFormat, type Stats } from '../../domain/statistics';
import type { Exam, Observatie, ScoreRecord, Student } from '../../domain/types';
import { isPo, rubricOf } from '../../domain/po';
import { poObsIds, poStudentObs } from '../../domain/po-grading';
import type { Rubric } from '../../domain/rubric';
import { vakNumbers } from '../../services/vak-numbers';
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

/**
 * Mean and SD of a test's grades over the students of its school year: the core's card numbers
 * of that attempt (step 38; kept per year and data generation, so a school-year toggle does not
 * read every student again, review 29 m5).
 */
export async function examStats(year: string, exam: Exam): Promise<Stats | null> {
  const subject = Store.getActiveSubject() as string | null;
  if (!subject) return null;
  const numbers = await vakNumbers(year, subject, Store.generation() as number);
  return numbers.exams[exam.id]?.stats ?? null;
}

export interface YearComparison {
  /** A school year, or `se` for the examendossier. */
  key: string;
  /** The student's average as shown (the core's, decisions 91-93). */
  student: Shown | null;
  /** The format it is shown under. */
  fmt: AverageFormat;
  /** Mean and SD of the peers' shown averages (decisions 21, 92). */
  peers: Stats | null;
}

/**
 * The student's year average against the jaarlaag's (mean and SD of the students' averages as
 * shown, decisions 21, 92) per school year, then the SE average against the jaarlaag's, the
 * peers taken from the student's own last year (B16, decision 12). Every average is the core's
 * (`vakNumbers`, step 38).
 */
export async function yearComparisons(d: ProfileData): Promise<YearComparison[]> {
  const id = String(d.student.id);
  const subject = Store.getActiveSubject() as string | null;
  if (!subject) return [];
  const generation = Store.generation() as number;
  const numbersOf = (yr: string) => vakNumbers(yr, subject, generation);
  const peersOf = (yr: string, jl: string) =>
    (Store.getStudentsSync(yr) as Student[]).filter(
      (s) => Store.jaarlaagFromStamklas(s.stamklas ?? '') === jl,
    );
  const out: YearComparison[] = [];
  for (const yr of d.years) {
    const n = await numbersOf(yr);
    const jl = d.jaarlaagByYear[yr];
    const raws = jl
      ? peersOf(yr, jl)
          .map((s) => n.students[String(s.id)]?.average?.raw)
          .filter((x): x is number => x !== undefined)
      : [];
    out.push({
      key: yr,
      student: n.students[id]?.average ?? null,
      fmt: n.formats.r,
      peers: raws.length ? statsOfAverages(raws, n.formats.r) : null,
    });
  }
  const last = d.years[d.years.length - 1];
  if (last) {
    const n = await numbersOf(last);
    const studentSe = n.students[id]?.se ?? null;
    if (studentSe) {
      const jl = d.jaarlaagByYear[last] ?? String(d.currentJaarlaag);
      const raws = [
        studentSe.raw,
        ...peersOf(last, jl)
          .filter((s) => String(s.id) !== id)
          .map((s) => n.students[String(s.id)]?.se?.raw)
          .filter((x): x is number => x !== undefined),
      ];
      out.push({
        key: 'se',
        student: studentSe,
        fmt: n.formats.se,
        peers: statsOfAverages(raws, n.formats.se),
      });
    }
  }
  return out;
}
