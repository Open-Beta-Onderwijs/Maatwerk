// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { freezeClock, DEFAULT_NOW } from '../../../tests/reference-harness/environment.mjs';
import {
  currentSchoolYear,
  fullName,
  jaarlaagFromStamklas,
  makeExamId,
  makeGroupId,
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
  it('makeExamId (the Store passes the active subject, nat)', () =>
    expectCase('makeExamId', ({ titles, years }: { titles: string[]; years: string[] }) =>
      titles.flatMap((t) =>
        years.flatMap((y) => [makeExamId(t, y, 'nat'), makeExamId(t, y, 'wi')]),
      ),
    ));

  it('makeGroupId', () =>
    expectCase('makeGroupId', ({ names, years }: { names: string[]; years: string[] }) =>
      names.flatMap((n) => years.map((y) => makeGroupId(n, y))),
    ));

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
