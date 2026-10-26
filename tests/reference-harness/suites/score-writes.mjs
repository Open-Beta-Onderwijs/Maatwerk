// SPDX-License-Identifier: AGPL-3.0-or-later
// Score file writes through the Store: setScore, setGradeOverride,
// setObservation, removeObsFromExamScores. Records the exact file text on disk
// after every step (key order, 2-space JSON), since the port must write the
// same format until the data-format change in Step 7.

import fs from 'node:fs';
import { Suite, capture } from '../golden.mjs';
import { extractFunction, refOf } from '../extract.mjs';
import { dataPath, openReference } from '../session.mjs';
import { YEAR, buildData, exam, student } from '../scenario.mjs';

const STORE = 'renderer/store.js';
const E1 = 'nat-sw-1-2025-2026';
const E2 = 'nat-sw-2-2025-2026';

export default async function scoreWrites() {
  const suite = new Suite('score-writes', 'Score file contents after Store write operations.');
  suite.ref(
    [
      'setScore',
      'setGradeOverride',
      'setObservation',
      'removeObsFromExamScores',
      'updateStudentScores',
      'update',
    ].map((n) => refOf(extractFunction(STORE, n))),
  );
  const s = await openReference({
    fixture: (dir) =>
      buildData(dir, {
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
      }),
    subject: 'nat',
  });
  try {
    const { Store } = s;
    const file = (id) => dataPath(s, `${YEAR}/scores/nat/${id}.json`);
    const text = (id) => (fs.existsSync(file(id)) ? fs.readFileSync(file(id), 'utf8') : null);
    const steps = [
      ['setScore 1 E1 q1 = 1.5', () => Store.setScore(1, E1, 'q1', 1.5, YEAR), 1],
      ['setScore 1 E1 q2 = null (N)', () => Store.setScore(1, E1, 'q2', null, YEAR), 1],
      [
        'setScore 1 E1 q2 = "abc" (invalid kept)',
        () => Store.setScore(1, E1, 'q2', 'abc', YEAR),
        1,
      ],
      [
        'setScore 1 E1 q1 = undefined (cleared)',
        () => Store.setScore(1, E1, 'q1', undefined, YEAR),
        1,
      ],
      ['setGradeOverride 1 E1 6.3 / 5.4', () => Store.setGradeOverride(1, E1, 6.3, 5.4, YEAR), 1],
      [
        'setGradeOverride 1 E2 7 / undefined',
        () => Store.setGradeOverride(1, E2, 7, undefined, YEAR),
        1,
      ],
      [
        'setGradeOverride 1 E1 null (removed)',
        () => Store.setGradeOverride(1, E1, null, null, YEAR),
        1,
      ],
      [
        'setGradeOverride 1 E2 null (last one removed)',
        () => Store.setGradeOverride(1, E2, null, null, YEAR),
        1,
      ],
      ['setObservation 1 E1 obs-b on', () => Store.setObservation(1, E1, 'obs-b', true, YEAR), 1],
      [
        'setObservation 1 E1 obs-b on again',
        () => Store.setObservation(1, E1, 'obs-b', true, YEAR),
        1,
      ],
      ['setObservation 1 E1 obs-b off', () => Store.setObservation(1, E1, 'obs-b', false, YEAR), 1],
      [
        'removeObsFromExamScores obs-a E1',
        () => Store.removeObsFromExamScores('obs-a', E1, YEAR),
        2,
      ],
    ];
    const out = [];
    for (const [label, op, id] of steps) {
      const r = await capture(op);
      out.push({ step: label, result: r, file: text(id) });
    }
    suite.add(
      'sequence',
      'BR 2, 3.3, DF scores',
      { initial: { 2: { scores: { [E1]: { q1: 1 } } } } },
      out,
    );
  } finally {
    s.dispose();
  }
  return suite;
}
