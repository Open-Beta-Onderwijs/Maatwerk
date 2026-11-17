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

import { round1 } from './core';
import { formatFixed, formatNumber, parseDecimal } from './format';
import { guessStructureMode, type NumberedQuestion, questionLabel } from './question-structure';
import { examResults } from './grades';
import { fullName } from './ids';
import { isPo, rubricOf } from './po';
import { poObsIds, poStudentObs } from './po-grading';
import { studentGroup } from './statistics';
import {
  type CijferCard,
  type Exam,
  type Group,
  type Observatie,
  type Opdracht,
  type ScoreRecord,
  type ScoreValue,
  type Student,
  type StudentId,
  type VraagCard,
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

/**
 * The observaties of an exam that opdrachten can follow: a test's `obs_ids`; a PO's general and
 * category observaties (step 23).
 */
export function examObsIds(exam: Exam): string[] {
  return isPo(exam) ? poObsIds(exam, rubricOf(exam)) : (exam.obs_ids ?? []);
}

/** The observaties a student has for the exam (a PO: general and category ones). */
function studentObs(rec: ScoreRecord | null | undefined, exam: Exam): string[] {
  return isPo(exam) ? poStudentObs(rec, exam.id) : (rec?.observations?.[exam.id] ?? []);
}

/** The coupling to use for every observatie of the exam (saved, else the default). */
export function opdrachtCoupling(
  exam: Exam,
  opdrachten: Opdracht[],
  activeSubject?: string | null,
): Record<string, string[]> {
  const exists = new Set(opdrachten.map((o) => o.id));
  const coupling: Record<string, string[]> = {};
  for (const obsId of examObsIds(exam)) {
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
    naam: `Cijfer onder ${formatFixed(Number(card.onder))}`,
  };
}

/**
 * Question cards of the exam (exam.opdrachtenVraag, F-14), without deleted opdrachten and without
 * cards whose question is gone. A PO has none (it has no questions).
 */
export function opdrachtVraagCards(exam: Exam, opdrachten: Opdracht[]): VraagCard[] {
  if (isPo(exam)) return [];
  const exists = new Set(opdrachten.map((o) => o.id));
  const questions = new Set((exam.questions ?? []).map((q) => q.id));
  return (exam.opdrachtenVraag ?? [])
    .filter((c) => questions.has(c.vraag))
    .map((c) => ({ ...c, opdrachten: (c.opdrachten ?? []).filter((id) => exists.has(id)) }));
}

/**
 * A score on a question card's question matches when it is below `onder` points or `N` (not
 * attempted: `null` or the string `N`). An empty score (not entered) and a score kept as typed
 * that is not a number never match (user 2026-11-07).
 */
export function vraagScoreMatches(value: ScoreValue | undefined, onder: number): boolean {
  if (value === undefined) return false;
  if (value === null) return true;
  if (typeof value === 'number') return value < onder;
  const raw = value.trim();
  if (raw === '') return false;
  if (raw.toUpperCase() === 'N') return true;
  const n = parseDecimal(raw);
  return !isNaN(n) && n < onder;
}

/** The question's label as the exam numbers it (`II3`, `1a`, `7`), else its id. */
export function vraagLabel(exam: Pick<Exam, 'questions' | 'structureMode'>, vraag: string): string {
  const q = (exam.questions ?? []).find((x) => x.id === vraag) as NumberedQuestion | undefined;
  if (!q || q.number === undefined) return vraag;
  const first = (exam.questions?.[0] as NumberedQuestion | undefined)?.section;
  return questionLabel(q, exam.structureMode ?? guessStructureMode(first));
}

/** "1 punt", "1,5 punten". */
export function puntenText(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? 'punt' : 'punten'}`;
}

/** The reason shown for a question card (chip in the modal, header of the opdracht). */
export function vraagCardReason(
  card: Pick<VraagCard, 'vraag' | 'onder'>,
  exam: Pick<Exam, 'questions' | 'structureMode'>,
): { icon: string; naam: string } {
  return {
    icon: '🔢',
    naam: `Vraag ${vraagLabel(exam, card.vraag)} onder ${puntenText(Number(card.onder))}`,
  };
}

/** A reason for an opdracht: an observatie, a grade card or a question card. */
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
  /** Every student below that question card (F-14). */
  vraagStudents: Record<string, StudentId[]>;
}

/**
 * Who gets which opdracht for `exam`, given `coupling` ({ obsId: [opdrachtId] })
 * the grade cards and the question cards. An opdracht coupled to several reasons of one student
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
  vraagCards = [],
}: {
  exam: Exam;
  students: Student[];
  recordOf: (studentId: StudentId) => ScoreRecord | null | undefined;
  observaties: Observatie[];
  opdrachten: Opdracht[];
  groups: Group[];
  coupling: Record<string, string[] | undefined>;
  cijferCards?: CijferCard[];
  vraagCards?: VraagCard[];
}): Assignments {
  const obsById = Object.fromEntries(observaties.map((o) => [o.id, o]));
  const opById = Object.fromEntries(opdrachten.map((o) => [o.id, o]));
  const examObs = examObsIds(exam);

  const obsStudents: Record<string, StudentId[]> = Object.fromEntries(
    examObs.map((id) => [id, []]),
  );
  const cijferStudents: Record<string, StudentId[]> = Object.fromEntries(
    cijferCards.map((c) => [c.id, []]),
  );
  const vraagStudents: Record<string, StudentId[]> = Object.fromEntries(
    vraagCards.map((c) => [c.id, []]),
  );
  const scoresOf = (rec: ScoreRecord | null | undefined) => rec?.scores?.[exam.id] ?? {};
  const result: Assignment[] = [];
  for (const s of students) {
    const rec = recordOf(s.id);
    const own = new Set(studentObs(rec, exam));
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
      const rounded = round1(grade);
      for (const card of cijferCards) {
        if (!(rounded < card.onder)) continue;
        cijferStudents[card.id]!.push(s.id);
        give(card.opdrachten, cijferCardReason(card));
      }
    }
    for (const card of vraagCards) {
      if (!vraagScoreMatches(scoresOf(rec)[card.vraag], card.onder)) continue;
      vraagStudents[card.id]!.push(s.id);
      give(card.opdrachten, vraagCardReason(card, exam));
    }
    if (!items.size) continue;
    // The one rule for the student's group (decision 17).
    const groupId = studentGroup(s.id, exam, groups);
    const group = groups.find((g) => g.id === groupId) ?? null;
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
  return { students: result, obsStudents, cijferStudents, vraagStudents };
}
