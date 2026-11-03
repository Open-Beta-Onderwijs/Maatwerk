// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { freezeClock, DEFAULT_NOW } from '../../../tests/reference-harness/environment.mjs';
import {
  currentSchoolYear,
  fullName,
  jaarlaagFromStamklas,
  makeExamId,
  makeGroupId,
  nextQuestionId,
  parseGroupName,
  sortStudents,
  subjectFromGroupName,
} from '../../src/domain/ids';
import type { Exam, Student } from '../../src/domain/types';
import { goldenCase, inputOf, loadGolden, run } from '../golden';
import { openStore } from '../store-session';

const golden = loadGolden('ids');
const YEAR = '2025-2026';
const expectCase = async (id: string, fn: (input: never) => unknown) => {
  const c = goldenCase(golden, id);
  expect(await run(() => fn(inputOf(c) as never))).toEqual(c.output);
};

describe('ids golden', () => {
  // The golden cases makeExamId/makeGroupId pin the v1 slug ids; new ids are
  // opaque since Step 7a (ADR-0003 C10, quirk B26), so they no longer apply.
  it('makeExamId and makeGroupId give opaque, distinct ids (C10)', () => {
    const exams = new Set(Array.from({ length: 200 }, () => makeExamId()));
    expect(exams.size).toBe(200);
    for (const id of exams) expect(id).toMatch(/^toets-[a-z0-9]+-[a-z0-9]{6}$/);
    expect(makeGroupId()).toMatch(/^groep-[a-z0-9]+-[a-z0-9]{6}$/);
  });

  it('currentSchoolYear', () =>
    expectCase('currentSchoolYear', ({ clocks }: { clocks: string[] }) =>
      clocks.map((c) => {
        const restore = freezeClock(c);
        try {
          return currentSchoolYear();
        } finally {
          restore();
          freezeClock(DEFAULT_NOW);
        }
      }),
    ));

  it('fullName', () =>
    expectCase('fullName', ({ people }: { people: Student[] }) => people.map(fullName)));

  it('jaarlaagFromStamklas', () =>
    expectCase('jaarlaagFromStamklas', ({ klassen }: { klassen: unknown[] }) =>
      klassen.map(jaarlaagFromStamklas),
    ));

  it('sortStudents', () =>
    expectCase('sortStudents', ({ list }: { list: Student[] }) =>
      sortStudents(list).map((x) => x.id),
    ));

  it('group-name-parsing', () =>
    expectCase('group-name-parsing', ({ names }: { names: (string | null)[] }) =>
      names.map((n) => ({
        subject: subjectFromGroupName(n),
        nat: parseGroupName(n, 'nat'),
        wi: parseGroupName(n, 'wi'),
      })),
    ));

  it('upsertExam-volgnummer-meta (Store: nextVolgnummer + stampMeta)', async () => {
    const c = goldenCase(golden, 'upsertExam-volgnummer-meta');
    const { existing, fresh } = inputOf<{ existing: Exam[]; fresh: Exam[] }>(c);
    const files = Object.fromEntries(
      existing.map((e) => [`${YEAR}/exams/${e.id}.json`, JSON.stringify(e, null, 2)]),
    );
    const { Store } = await openStore({ files, subject: 'nat' });
    const out = [];
    for (const e of fresh) {
      const saved = (await run(() => Store.upsertExam!(structuredClone(e), YEAR))) as Record<
        string,
        unknown
      >;
      out.push(
        saved.$throws
          ? saved
          : { id: saved.id, volgnummer: saved.volgnummer, title: saved.title, _meta: saved._meta },
      );
    }
    expect(out).toEqual(c.output);
  });
});

describe('nextQuestionId (quirk B24)', () => {
  const qs = (...ids: string[]) => ids.map((id) => ({ id }));

  it('continues after the highest number', () => {
    expect(nextQuestionId(qs('q1', 'q2', 'q3'))).toBe('q4');
    expect(nextQuestionId([])).toBe('q1');
  });

  it('does not repeat an id after a deletion', () => {
    // q1 deleted from q1..q3: the reference made q3 again.
    expect(nextQuestionId(qs('q2', 'q3'))).toBe('q4');
    expect(nextQuestionId(qs('q1', 'q3'))).toBe('q4');
  });

  it('does not reuse the id of a deleted last question when the opened ids are passed', () => {
    // Review 10 m4: q4 deleted while a colleague may hold scores for it.
    expect(nextQuestionId([...qs('q1', 'q2', 'q3'), ...qs('q1', 'q2', 'q3', 'q4')])).toBe('q5');
  });

  it('skips ids of another shape and existing duplicates', () => {
    expect(nextQuestionId(qs('q2', 'q2', 'extra', 'q10a'))).toBe('q3');
  });
});
