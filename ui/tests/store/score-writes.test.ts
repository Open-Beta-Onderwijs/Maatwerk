// SPDX-License-Identifier: AGPL-3.0-or-later

// The ported Store's score writes on the MockApi against
// tests/golden/logic/score-writes.json. The golden has no `data` case, so the
// same scenario is built here with the harness's scenario helpers.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  YEAR,
  buildData,
  exam,
  readTree,
  student,
} from '../../../tests/reference-harness/scenario.mjs';
import { goldenCase, loadGolden, run } from '../golden';
import { openStore } from '../store-session';

const golden = loadGolden('score-writes');
const E1 = 'nat-sw-1-2025-2026';
const E2 = 'nat-sw-2-2025-2026';

function scenario(): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'maatwerk-sw-'));
  try {
    buildData(root, {
      years: {
        [YEAR]: {
          students: [student(1), student(2)],
          exams: [
            exam(
              E1,
              [
                [2, 'R'],
                [3, 'T1'],
              ],
              { obs_ids: ['obs-a', 'obs-b'] },
            ),
            exam(E2, [[2, 'R']]),
          ],
          scores: {
            nat: {
              2: {
                scores: { [E1]: { q1: 1 } },
                observations: { [E1]: ['obs-a'], [E2]: ['obs-a'] },
              },
            },
          },
        },
      },
    });
    return readTree(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('score-writes golden (Store)', () => {
  it('sequence', async () => {
    const { Store, api } = await openStore({ files: scenario(), subject: 'nat' });
    const text = (id: number) => api.peek(`${YEAR}/scores/nat/${id}.json`);
    const steps: [string, () => unknown, number][] = [
      ['setScore 1 E1 q1 = 1.5', () => Store.setScore!(1, E1, 'q1', 1.5, YEAR), 1],
      ['setScore 1 E1 q2 = null (N)', () => Store.setScore!(1, E1, 'q2', null, YEAR), 1],
      [
        'setScore 1 E1 q2 = "abc" (invalid kept)',
        () => Store.setScore!(1, E1, 'q2', 'abc', YEAR),
        1,
      ],
      [
        'setScore 1 E1 q1 = undefined (cleared)',
        () => Store.setScore!(1, E1, 'q1', undefined, YEAR),
        1,
      ],
      ['setGradeOverride 1 E1 6.3 / 5.4', () => Store.setGradeOverride!(1, E1, 6.3, 5.4, YEAR), 1],
      [
        'setGradeOverride 1 E2 7 / undefined',
        () => Store.setGradeOverride!(1, E2, 7, undefined, YEAR),
        1,
      ],
      [
        'setGradeOverride 1 E1 null (removed)',
        () => Store.setGradeOverride!(1, E1, null, null, YEAR),
        1,
      ],
      [
        'setGradeOverride 1 E2 null (last one removed)',
        () => Store.setGradeOverride!(1, E2, null, null, YEAR),
        1,
      ],
      ['setObservation 1 E1 obs-b on', () => Store.setObservation!(1, E1, 'obs-b', true, YEAR), 1],
      [
        'setObservation 1 E1 obs-b on again',
        () => Store.setObservation!(1, E1, 'obs-b', true, YEAR),
        1,
      ],
      [
        'setObservation 1 E1 obs-b off',
        () => Store.setObservation!(1, E1, 'obs-b', false, YEAR),
        1,
      ],
      [
        'removeObsFromExamScores obs-a E1',
        () => Store.removeObsFromExamScores!('obs-a', E1, YEAR),
        2,
      ],
    ];
    const out = [];
    for (const [step, op, id] of steps) {
      out.push({ step, result: await run(op), file: text(id) });
    }
    expect(out).toEqual(goldenCase(golden, 'sequence').output);
  });
});
