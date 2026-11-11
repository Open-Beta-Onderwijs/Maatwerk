// SPDX-License-Identifier: AGPL-3.0-or-later

// What changing projectgroepen does to the PO's grading (step 23; PLAN-2 decision 19). Used by
// the Projectgroepen dialog (po-groepen.ts) after the groups are saved.

import { clearGrading, gradingOf, groupSource, writeGrading } from '../domain/po-grading';
import type { Exam, ScoreRecord } from '../domain/types';
import { Store } from '../store.js';

/**
 * Decision 19: a student who changed projectgroep takes the new group's grading (scores,
 * observaties, comments, group lines), read from a member who stayed; own lines stay. A new group
 * without a grading clears the student's group fields.
 */
export async function takeNewGroupGrading(po: Exam, year: string, moved: string[]): Promise<void> {
  const movedSet = new Set(moved);
  const subject = po.subject ?? Store.getActiveSubject();
  for (const s of moved) {
    const g = (po.projectgroepen ?? []).find((x) => x.student_ids.map(String).includes(s));
    if (!g) continue;
    const stayed = g.student_ids.map(String).filter((m) => !movedSet.has(m));
    const records: ScoreRecord[] = [];
    for (const m of stayed) records.push(await Store.getStudentScores(m, year, subject));
    const source = groupSource(records, po.id, g.id);
    if (!source && !(await Store.studentHasExamData(s, po.id, year, subject))) continue;
    await Store.updateStudentScores(s, year, subject, (r: ScoreRecord) => {
      if (source) writeGrading(r, po.id, g.id, gradingOf(source, po.id));
      else clearGrading(r, po.id, g.id);
    });
  }
}

/**
 * Whether anyone has something for this PO: scores, observaties, comments or lines (the warning
 * before moving students; review 23 m6).
 */
export async function poHasGrading(po: Exam, year: string): Promise<boolean> {
  const subject = po.subject ?? Store.getActiveSubject();
  for (const s of (po.projectgroepen ?? []).flatMap((g) => g.student_ids.map(String)))
    if (await Store.studentHasExamData(s, po.id, year, subject)) return true;
  return false;
}
