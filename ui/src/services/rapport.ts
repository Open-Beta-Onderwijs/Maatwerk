// SPDX-License-Identifier: AGPL-3.0-or-later

// Loads what the rapport needs through the Store and the bridge, builds the
// report data (src/domain/rapport.ts) and asks the backend to compile it.
// Dependencies are passed in, so tests run it on a MockApi without the DOM.

import type { MaatwerkApi } from '../bridge/api';
import {
  buildRapportData,
  defaultTabData,
  rttiExplFileCandidates,
  type AdviesData,
} from '../domain/rapport';
import type { Exam, Group, Observatie, ScoreRecord, Student, StudentId } from '../domain/types';

/** The part of the legacy Store (src/store.js) the rapport uses. */
export interface RapportStore {
  loadYear(year: string, subject?: string | null): Promise<void>;
  preloadScores(year: string, subject?: string): Promise<void>;
  getObservaties(subject?: string): Promise<Observatie[]>;
  getStudentsSync(year: string): Student[];
  getGroupsSync(year: string, subject?: string | null): Group[];
  getObservatiesSync(subject?: string): Observatie[];
  getStudentScores(studentId: StudentId, year: string, subject?: string): Promise<ScoreRecord>;
}

export interface RapportDeps {
  Store: RapportStore;
  api: Pick<MaatwerkApi, 'readJson' | 'renderRapportPdf'>;
}

/** The first advice file that exists for the exam (B9: both key schemes), else the defaults. */
export async function loadAdviesData(
  exam: Exam,
  api: Pick<MaatwerkApi, 'readJson'>,
): Promise<AdviesData> {
  for (const path of rttiExplFileCandidates(exam)) {
    const data = (await api.readJson(path)) as AdviesData | null;
    if (data) return data;
  }
  return defaultTabData();
}

/** Collects all student data for `exam` in `year` and compiles the Typst rapport. */
export async function compileRapport(exam: Exam, year: string, { Store, api }: RapportDeps) {
  const subject = exam?.subject;

  // Students, groups, scores and observaties of this subject
  await Promise.all([
    Store.loadYear(year, subject),
    Store.preloadScores(year, subject),
    Store.getObservaties(subject),
  ]);

  const students = Store.getStudentsSync(year);
  const records = new Map<Student, ScoreRecord>();
  for (const s of students) records.set(s, await Store.getStudentScores(s.id, year, subject));

  const { studentData, examInfo } = buildRapportData({
    exam,
    students,
    groups: Store.getGroupsSync(year, subject),
    recordOf: (s) => records.get(s),
    observaties: Store.getObservatiesSync(subject),
    adviesData: await loadAdviesData(exam, api),
  });
  return api.renderRapportPdf(exam.id, studentData, examInfo);
}
