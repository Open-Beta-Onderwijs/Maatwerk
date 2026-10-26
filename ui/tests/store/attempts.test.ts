// SPDX-License-Identifier: AGPL-3.0-or-later

// The ported Store against tests/golden/logic/attempts.json (BR 5).

import { beforeAll, describe, expect, it } from 'vitest';
import { goldenCase, inputOf, loadGolden, run } from '../golden';
import { openStore, type LegacyStore } from '../store-session';

const golden = loadGolden('attempts');
const PREV = '2024-2025';
const YEAR = '2025-2026';

interface Entry {
  examId?: string;
  exam?: { id: string; academic_year?: string };
  questionScores: unknown;
  override: unknown;
  grade?: number;
}
// Same projection as tests/reference-harness/suites/attempts.mjs.
const slimEntry = (e: Entry | null) =>
  e && {
    examId: e.exam?.id ?? e.examId,
    academic_year: e.exam?.academic_year,
    questionScores: e.questionScores,
    override: e.override,
    ...(e.grade !== undefined ? { grade: e.grade } : {}),
  };

let Store: LegacyStore;
beforeAll(async () => {
  const { files } = inputOf<{ files: Record<string, string> }>(goldenCase(golden, 'data'));
  ({ Store } = await openStore({ files, subject: 'nat' }));
  await Store.loadYear!(PREV, 'nat');
});

describe('attempts golden (Store)', () => {
  it('getResitsSync', async () => {
    const c = goldenCase(golden, 'getResitsSync');
    const { parentId } = inputOf<{ parentId: string }>(c);
    expect(
      await run(() => Store.getResitsSync!(parentId, YEAR).map((e: { id: string }) => e.id)),
    ).toEqual(c.output);
  });

  for (const id of ['computeBestGradeMap', 'computeBestGradeMap-unknown-parent']) {
    it(id, async () => {
      const c = goldenCase(golden, id);
      const { parentId } = inputOf<{ parentId: string }>(c);
      const map = (await Store.computeBestGradeMap!(parentId, YEAR)) as Record<string, Entry>;
      const actual =
        id === 'computeBestGradeMap'
          ? Object.fromEntries(Object.entries(map).map(([k, v]) => [k, slimEntry(v)]))
          : map;
      expect(await run(() => actual)).toEqual(c.output);
    });
  }

  for (const c of golden.cases.filter((x) => x.id.startsWith('student-'))) {
    it(`${c.id} (${c.rule})`, async () => {
      const { studentId } = inputOf<{ studentId: number }>(c);
      const history = (await Store.getStudentHistory!(studentId)) as Entry[];
      const best = await run(() => Store.resolveBestAttempts!(history));
      const actual = {
        history: history.map(slimEntry),
        resolveBestAttempts: Array.isArray(best) ? best.map(slimEntry) : best,
      };
      expect(await run(() => actual)).toEqual(c.output);
    });
  }
});
