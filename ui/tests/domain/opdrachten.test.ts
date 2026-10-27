// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeAll, describe, expect, it } from 'vitest';
import { cijferCardReason, opdrachtMatchesExam } from '../../src/domain/opdrachten';
import type { CijferCard, Exam, Opdracht } from '../../src/domain/types';
import { goldenCase, inputOf, loadGolden, run } from '../golden';
import { openStore, type LegacyStore } from '../store-session';

const golden = loadGolden('opdrachten');
const YEAR = '2025-2026';

interface Assignments {
  students: {
    student: { id: unknown };
    group: { id: string } | null;
    items: { opdracht: { id: string }; obs: { id?: string; naam?: string }[] }[];
  }[];
  obsStudents: unknown;
  cijferStudents: unknown;
}
// Same projection as tests/reference-harness/suites/opdrachten.mjs.
const slimAssignments = (res: Assignments) => ({
  students: res.students.map((x) => ({
    studentId: x.student.id,
    group: x.group?.id ?? null,
    items: x.items.map((it) => ({
      opdracht: it.opdracht.id,
      reasons: it.obs.map((r) => r.id ?? r.naam),
    })),
  })),
  obsStudents: res.obsStudents,
  cijferStudents: res.cijferStudents,
});

describe('opdrachten golden (domain)', () => {
  it('opdrachtMatchesExam-matrix (the Store passes the active subject, nat)', () => {
    const rows = goldenCase(golden, 'opdrachtMatchesExam-matrix').output as [
      Opdracht,
      Exam,
      boolean,
    ][];
    for (const [o, e, fits] of rows) {
      expect(opdrachtMatchesExam(o, e, 'nat'), JSON.stringify([o, e])).toBe(fits);
    }
  });

  it('cijferCardReason', async () => {
    const c = goldenCase(golden, 'cijferCardReason');
    const { onder } = inputOf<{ onder: number[] }>(c);
    expect(await run(() => onder.map((x) => cijferCardReason({ onder: x })))).toEqual(c.output);
  });
});

describe('opdrachten golden (Store)', () => {
  let Store: LegacyStore;
  const examById = async (id: string) =>
    ((await Store.getExams!(YEAR, 'nat')) as Exam[]).find((e) => e.id === id)!;

  beforeAll(async () => {
    const { files } = inputOf<{ files: Record<string, string> }>(goldenCase(golden, 'data'));
    ({ Store } = await openStore({ files, subject: 'nat' }));
    await Store.getOpdrachten!();
  });

  for (const id of ['getOpdrachtCoupling', 'getOpdrachtCijferCards']) {
    it(id, async () => {
      const c = goldenCase(golden, id);
      const exam = await examById(inputOf<{ exam: string }>(c).exam);
      expect(await run(() => Store[id]!(exam))).toEqual(c.output);
    });
  }

  it('getOpdrachtAssignments', async () => {
    const c = goldenCase(golden, 'getOpdrachtAssignments');
    const exam = await examById(inputOf<{ exam: string }>(c).exam);
    const coupling = Store.getOpdrachtCoupling!(exam);
    const cards = Store.getOpdrachtCijferCards!(exam);
    const res = await Store.getOpdrachtAssignments!(exam, YEAR, coupling, cards);
    expect(await run(() => slimAssignments(res))).toEqual(c.output);
  });

  it('getOpdrachtAssignments-exact-boundary', async () => {
    const c = goldenCase(golden, 'getOpdrachtAssignments-exact-boundary');
    const { exam: examId, cards } = inputOf<{ exam: string; cards: CijferCard[] }>(c);
    const exam = await examById(examId);
    const res = await Store.getOpdrachtAssignments!(exam, YEAR, {}, cards);
    expect(await run(() => slimAssignments(res))).toEqual(c.output);
  });

  it('getOpdrachtAssignments-no-cards', async () => {
    const c = goldenCase(golden, 'getOpdrachtAssignments-no-cards');
    const exam = await examById(inputOf<{ exam: string }>(c).exam);
    const res = await Store.getOpdrachtAssignments!(exam, YEAR, Store.getOpdrachtCoupling!(exam));
    expect(await run(() => slimAssignments(res))).toEqual(c.output);
  });
});

describe('C8: student ids compare as strings', () => {
  it('finds the group when student_ids holds the id as a string', async () => {
    const { assignOpdrachten } = await import('../../src/domain/opdrachten');
    const exam = { id: 'e', questions: [], obs_ids: ['o1'], jaarlaag: '3' } as Exam;
    const res = assignOpdrachten({
      exam,
      students: [{ id: 123, achternaam: 'A' }],
      recordOf: () => ({ observations: { e: ['o1'] } }),
      observaties: [{ id: 'o1' }],
      opdrachten: [{ id: 'op' }],
      groups: [{ id: 'g', name: '3a', jaarlaag: '3', student_ids: ['123'] }],
      coupling: { o1: ['op'] },
    });
    // The reference used includes(123) and found no group here.
    expect(res.students[0]!.group?.id).toBe('g');
  });
});
