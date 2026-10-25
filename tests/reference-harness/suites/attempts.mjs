// SPDX-License-Identifier: AGPL-3.0-or-later
// Resits and best attempt: Store.computeBestGradeMap, getStudentHistory,
// resolveBestAttempts (business-rules.md section 5, golden candidates 24-29).

import { Suite, capture } from '../golden.mjs';
import { extractFunction, refOf } from '../extract.mjs';
import { openReference } from '../session.mjs';
import { TEN_BY_TEN, YEAR, buildData, exam, pointsFor, student, tenByTen } from '../scenario.mjs';

const STORE = 'renderer/store.js';
const PREV = '2024-2025';

const parent = exam('nat-t1-2025-2026', TEN_BY_TEN, { volgnummer: 301 });
const resit = exam('nat-t1-herkansing-2025-2026', TEN_BY_TEN, {
  parent_id: parent.id,
  attempt: 2,
  description: 'HERKANSING',
  volgnummer: 301,
});
const inhaal = exam(
  'nat-t1-inhaal-2025-2026',
  [
    [5, 'R'],
    [5, 'T1'],
  ],
  { parent_id: parent.id, attempt: 3, description: 'INHAAL', n_term: 2, volgnummer: 301 },
);
const other = exam('nat-t2-2025-2026', TEN_BY_TEN, { volgnummer: 302 });
const prevExam = exam('nat-t9-2024-2025', TEN_BY_TEN, { jaarlaag: '2', volgnummer: 209 });

const g = (grade) => tenByTen(pointsFor(grade));

// One student per situation (ids double as case labels).
const STUDENTS = {
  1: { why: 'resit worse than original', scores: { [parent.id]: g(7.2), [resit.id]: g(5) } },
  2: { why: 'tie: earliest attempt wins', scores: { [parent.id]: g(6), [resit.id]: g(6) } },
  3: {
    why: 'override on the original decides',
    scores: { [parent.id]: g(4), [resit.id]: g(5.5) },
    overrides: { [parent.id]: { cijfer: 6, berekend: 4 } },
  },
  4: { why: 'only the resit taken', scores: { [resit.id]: g(6.5) } },
  5: {
    why: 'original has a null grade (only invalid input), resit graded',
    scores: { [parent.id]: { q1: 'abc' }, [resit.id]: g(4.5) },
  },
  6: {
    why: 'third attempt with its own structure and n-term is best',
    scores: { [parent.id]: g(3), [resit.id]: g(4), [inhaal.id]: { q1: 4, q2: 3 } },
  },
  7: { why: 'no attempts at all', scores: {} },
  8: { why: 'only resits, both graded', scores: { [resit.id]: g(5), [inhaal.id]: { q1: 5, q2: 5 } } },
  9: {
    why: 'override only on the resit',
    scores: { [parent.id]: g(5) },
    overrides: { [resit.id]: { cijfer: 5.8, berekend: null } },
  },
  10: { why: 'history across two school years', scores: { [parent.id]: g(6), [other.id]: g(7) } },
};

function spec() {
  const students = Object.keys(STUDENTS).map((id) => student(Number(id)));
  const scores = {};
  for (const [id, s] of Object.entries(STUDENTS)) {
    scores[id] = { scores: s.scores, observations: {}, ...(s.overrides ? { overrides: s.overrides } : {}) };
  }
  return {
    years: {
      [YEAR]: { students, exams: [parent, resit, inhaal, other], scores: { nat: scores } },
      [PREV]: {
        students: [student(10, { jaarlaag: '2', stamklas: '2a' })],
        exams: [prevExam],
        scores: { nat: { 10: { scores: { [prevExam.id]: g(8) }, observations: {} } } },
      },
    },
  };
}

const slimEntry = (e) =>
  e && {
    examId: e.exam?.id ?? e.examId,
    academic_year: e.exam?.academic_year,
    questionScores: e.questionScores,
    override: e.override,
    ...(e.grade !== undefined ? { grade: e.grade } : {}),
  };

export default async function attempts() {
  const suite = new Suite('attempts', 'Resits and the best attempt per student.');
  suite.ref(
    ['computeBestGradeMap', 'resolveBestAttempts', 'getStudentHistory', 'getResitsSync'].map((n) =>
      refOf(extractFunction(STORE, n)),
    ),
  );
  const data = spec();
  const s = await openReference({ fixture: (dir) => buildData(dir, data), subject: 'nat' });
  try {
    const { Store } = s;
    await Store.loadYear(PREV, 'nat');
    suite.add('data', 'BR 5', data, null);

    suite.add(
      'getResitsSync',
      'BR 5.1',
      { parentId: parent.id },
      Store.getResitsSync(parent.id, YEAR).map((e) => e.id),
    );

    const map = await capture(() => Store.computeBestGradeMap(parent.id, YEAR));
    suite.add(
      'computeBestGradeMap',
      'BR 5.2, 11.24-29',
      { parentId: parent.id, year: YEAR },
      Object.fromEntries(Object.entries(map).map(([k, v]) => [k, slimEntry(v)])),
    );
    suite.add(
      'computeBestGradeMap-unknown-parent',
      'BR 5.2',
      { parentId: 'nat-bestaat-niet-2025-2026' },
      await capture(() => Store.computeBestGradeMap('nat-bestaat-niet-2025-2026', YEAR)),
    );

    for (const [id, st] of Object.entries(STUDENTS)) {
      const history = await Store.getStudentHistory(Number(id));
      const best = await capture(() => Store.resolveBestAttempts(history));
      suite.add(
        `student-${id}`,
        `BR 5.2: ${st.why}`,
        { studentId: Number(id) },
        {
          history: history.map(slimEntry),
          resolveBestAttempts: Array.isArray(best) ? best.map(slimEntry) : best,
        },
      );
    }
  } finally {
    s.dispose();
  }
  return suite;
}
