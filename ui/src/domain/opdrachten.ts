// SPDX-License-Identifier: AGPL-3.0-or-later

// Coupling observaties and grade cards of an exam to remedial opdrachten, and
// who gets which opdracht (business-rules.md section 7). Ported from store.js
// (opdrachtMatchesExam, getOpdrachtCoupling, getOpdrachtCijferCards,
// cijferCardReason, getOpdrachtAssignments); pinned by
// tests/golden/logic/opdrachten.json.
//
// exam.opdrachten = { [obsId]: [opdrachtId, …] } is the saved coupling.
// Observaties without a saved coupling fall back to the matching opdrachten
// that list the observatie in their observaties[].

import { examResults } from './grades';
import { fullName } from './ids';
import {
  sameId,
  type CijferCard,
  type Exam,
  type Group,
  type Observatie,
  type Opdracht,
  type ScoreRecord,
  type Student,
  type StudentId,
} from './types';

/** Wiskunde sub-variants: wisob = onderbouw (jaarlaag 1-3), wisa/b/c/d = bovenbouw. */
export const WI_VARIANTS = new Set(['wisob', 'wisa', 'wisb', 'wisc', 'wisd']);

/**
 * The opdracht fits the exam's vak, jaarlaag and schoolsoort (empty lists
 * always fit). `activeSubject` stands in for an exam without `subject`.
 */
export function opdrachtMatchesExam(
  opdracht: Opdracht,
  exam: Pick<Exam, 'subject' | 'jaarlaag' | 'schoolsoort'>,
  activeSubject?: string | null,
): boolean {
  const subject = exam.subject ?? activeSubject;
  const vakken = opdracht.vakken ?? [];
  const vakOk =
    !vakken.length || vakken.some((v) => (subject === 'wi' ? WI_VARIANTS.has(v) : v === subject));
  const jl = opdracht.jaarlagen ?? [];
  const jlOk = !jl.length || !exam.jaarlaag || jl.map(String).includes(String(exam.jaarlaag));
  const ss = opdracht.schoolsoort ?? [];
  const examSS = exam.schoolsoort ?? [];
  const ssOk = !ss.length || !examSS.length || ss.some((s) => examSS.includes(s));
  return vakOk && jlOk && ssOk;
}

/** The coupling to use for every observatie of the exam (saved, else the default). */
export function opdrachtCoupling(
  exam: Exam,
  opdrachten: Opdracht[],
  activeSubject?: string | null,
): Record<string, string[]> {
  const exists = new Set(opdrachten.map((o) => o.id));
  const coupling: Record<string, string[]> = {};
  for (const obsId of exam.obs_ids ?? []) {
    const saved = exam.opdrachten?.[obsId];
    coupling[obsId] = saved
      ? saved.filter((id) => exists.has(id))
      : opdrachten
          .filter(
            (o) =>
              (o.observaties ?? []).includes(obsId) && opdrachtMatchesExam(o, exam, activeSubject),
          )
          .map((o) => o.id);
  }
  return coupling;
}

/**
 * Grade cards of the exam (exam.opdrachtenCijfer), without deleted opdrachten.
 * Students whose grade (override included, rounded to one decimal) is below
 * `onder` get the card's opdrachten.
 */
export function opdrachtCijferCards(exam: Exam, opdrachten: Opdracht[]): CijferCard[] {
  const exists = new Set(opdrachten.map((o) => o.id));
  return (exam.opdrachtenCijfer ?? []).map((c) => ({
    ...c,
    opdrachten: (c.opdrachten ?? []).filter((id) => exists.has(id)),
  }));
}

/** The reason shown for a grade card (chip in the modal, header of the opdracht). */
export function cijferCardReason(card: Pick<CijferCard, 'onder'>): { icon: string; naam: string } {
  return {
    icon: '5️⃣',
    naam: `Cijfer onder ${Number(card.onder).toFixed(1).replace('.', ',')}`,
  };
}

/** A reason for an opdracht: an observatie or a grade card. */
export type Reason = Observatie | { icon: string; naam: string };

export interface Assignment {
  student: Student;
  group: Group | null;
  items: { opdracht: Opdracht; obs: Reason[] }[];
}

export interface Assignments {
  /** Only students that receive something, sorted by group then name. */
  students: Assignment[];
  /** Every student with that observatie. */
  obsStudents: Record<string, StudentId[]>;
  /** Every student below that grade card. */
  cijferStudents: Record<string, StudentId[]>;
}

/**
 * Who gets which opdracht for `exam`, given `coupling` ({ obsId: [opdrachtId] })
 * and the grade cards. An opdracht coupled to several reasons of one student
 * is listed once. `recordOf` returns the student's score record.
 * Group membership compares student ids as strings (ADR-0003 C8).
 */
export function assignOpdrachten({
  exam,
  students,
  recordOf,
  observaties,
  opdrachten,
  groups,
  coupling,
  cijferCards = [],
}: {
  exam: Exam;
  students: Student[];
  recordOf: (studentId: StudentId) => ScoreRecord | null | undefined;
  observaties: Observatie[];
  opdrachten: Opdracht[];
  groups: Group[];
  coupling: Record<string, string[] | undefined>;
  cijferCards?: CijferCard[];
}): Assignments {
  const obsById = Object.fromEntries(observaties.map((o) => [o.id, o]));
  const opById = Object.fromEntries(opdrachten.map((o) => [o.id, o]));
  const examObs = exam.obs_ids ?? [];

  const obsStudents: Record<string, StudentId[]> = Object.fromEntries(
    examObs.map((id) => [id, []]),
  );
  const cijferStudents: Record<string, StudentId[]> = Object.fromEntries(
    cijferCards.map((c) => [c.id, []]),
  );
  const result: Assignment[] = [];
  for (const s of students) {
    const rec = recordOf(s.id);
    const own = new Set(rec?.observations?.[exam.id] ?? []);
    const items = new Map<string, { opdracht: Opdracht; obs: Reason[] }>();
    const give = (opIds: string[] | undefined, reason: Reason) => {
      for (const opId of opIds ?? []) {
        if (!opById[opId]) continue;
        if (!items.has(opId)) items.set(opId, { opdracht: opById[opId]!, obs: [] });
        items.get(opId)!.obs.push(reason);
      }
    };
    for (const obsId of examObs) {
      if (!own.has(obsId)) continue;
      obsStudents[obsId]!.push(s.id);
      if (obsById[obsId]) give(coupling[obsId], obsById[obsId]!);
    }
    const grade = cijferCards.length ? examResults(rec, exam)?.grade : null;
    if (grade !== null && grade !== undefined) {
      const rounded = Math.round(grade * 10) / 10;
      for (const card of cijferCards) {
        if (!(rounded < card.onder)) continue;
        cijferStudents[card.id]!.push(s.id);
        give(card.opdrachten, cijferCardReason(card));
      }
    }
    if (!items.size) continue;
    const ownGroups = groups.filter((g) => g.student_ids.some((id) => sameId(id, s.id)));
    const group =
      ownGroups.find((g) => String(g.jaarlaag) === String(exam.jaarlaag)) ?? ownGroups[0] ?? null;
    result.push({ student: s, group, items: [...items.values()] });
  }

  const cmp = (a: string | undefined, b: string | undefined) =>
    (a ?? '').localeCompare(b ?? '', 'nl', { numeric: true });
  result.sort(
    (a, b) =>
      Number(!a.group) - Number(!b.group) ||
      cmp(a.group?.name, b.group?.name) ||
      cmp(a.student.achternaam, b.student.achternaam) ||
      cmp(a.student.voornaam, b.student.voornaam) ||
      cmp(fullName(a.student), fullName(b.student)),
  );
  return { students: result, obsStudents, cijferStudents };
}
