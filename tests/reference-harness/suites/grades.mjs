// SPDX-License-Identifier: AGPL-3.0-or-later
// Grade calculation: Store.calcGrade, calcResults, examResults
// (docs/reference/business-rules.md sections 3-4, golden candidates 1-15, 17, 20, 22-23, 48).

import { Suite, capture } from '../golden.mjs';
import { extractFunction, refOf } from '../extract.mjs';
import { openReference } from '../session.mjs';

const STORE = 'renderer/store.js';

/** questions: [max_points, rtti, kind?][] */
export function makeExam(questions, { n = 1, id = 'nat-golden-2025-2026' } = {}) {
  return {
    id,
    n_term: n,
    questions: questions.map(([max, rtti, kind], i) => ({
      id: `q${i + 1}`,
      section: 'I',
      number: i + 1,
      max_points: max,
      rtti,
      ...(kind ? { kind } : {}),
    })),
  };
}
const normal = (count, max, tags = ['R', 'T1', 'T2', 'I']) =>
  Array.from({ length: count }, (_, i) => [max, tags[i % tags.length]]);
/** Spreads `total` points greedily over `count` questions of `max` points. */
function spread(total, count, max) {
  const v = [];
  let left = total;
  for (let i = 0; i < count; i++) {
    const x = Math.round(Math.min(max, left) * 100) / 100;
    v.push(x);
    left -= x;
  }
  return scoresOf(v);
}
const scoresOf = (values) =>
  Object.fromEntries(values.map((v, i) => [`q${i + 1}`, v]).filter(([, v]) => v !== undefined));

export default async function grades() {
  const suite = new Suite('grades', 'Grade and RTTI calculation from question scores.');
  suite.ref(['calcGrade', 'calcResults', 'examResults', 'qKind'].map((n) => refOf(extractFunction(STORE, n))));
  const s = await openReference({ fixture: null, subject: 'nat' });
  try {
    const { Store } = s;
    const calc = (exam, scores, override) => capture(() => Store.calcResults(exam, scores, override));
    const add = async (id, rule, exam, scores, override) =>
      suite.add(id, rule, { exam, scores, override }, await calc(exam, scores, override));

    // calcGrade sweep: every branch for several maxima and n-terms.
    const sweep = [];
    for (const max of [1, 7, 20, 33]) {
      for (const n of [0, 0.5, 1, 1.3, 2, 2.5, 3, 3.5]) {
        for (let scored = 0; scored <= max; scored += 0.5) sweep.push([scored, max, n, Store.calcGrade(scored, max, n)]);
      }
    }
    suite.add('calcGrade-sweep', 'BR 3.2', { columns: ['scored', 'max', 'nTerm', 'grade'] }, sweep);

    const twenty = makeExam(normal(10, 2));
    const fill = (total) => spread(total, 10, 2);
    for (const S of [0, 10, 20, 13.5]) await add(`linear-n1-S${S}`, 'BR 11.1', twenty, fill(S));
    await add('nterm-lo1', 'BR 11.2', makeExam(normal(10, 2), { n: 3 }), fill(1));
    await add('nterm-hi1', 'BR 11.3', makeExam(normal(10, 2), { n: 3 }), fill(18));
    await add('nterm-lo2', 'BR 11.4', makeExam(normal(10, 2), { n: 0 }), fill(1));
    await add('nterm-hi2', 'BR 11.4', makeExam(normal(10, 2), { n: 0 }), fill(18));
    for (const S of [7, 13.5, 19.5]) await add(`nterm-1.3-S${S}`, 'BR 11.5', makeExam(normal(10, 2), { n: 1.3 }), fill(S));

    const withBonus = makeExam([...normal(10, 2), [5, 'T2', 'bonus']]);
    await add('bonus-full-marks', 'BR 11.6', withBonus, { ...fill(18), q11: 3 });
    await add('bonus-partial', 'BR 11.7', withBonus, { ...fill(15), q11: 2 });
    await add('empty-entries', 'BR 11.8', twenty, {});
    await add('all-N', 'BR 11.9', twenty, scoresOf(Array(10).fill(null)));
    await add('all-N-string', 'BR 11.9', twenty, scoresOf(Array(10).fill('n')));
    await add('only-bonus-N', 'BR 11.10', withBonus, { q11: null });
    const withDiag = makeExam([...normal(4, 2), [3, 'I', 'diag']]);
    await add('only-diag', 'BR 11.11', withDiag, { q5: 3 });
    await add('diag-and-normal', 'BR 3.1', withDiag, { q1: 2, q5: 1 });
    await add('only-invalid', 'BR 11.12', makeExam([[10, 'R'], [2, 'T1']]), { q1: 12, q2: 'abc' });
    await add('invalid-plus-valid', 'BR 11.12', makeExam([[10, 'R'], [2, 'T1']]), { q1: 'abc', q2: 2 });
    await add('negative-score', 'BR 3.1', makeExam([[2, 'R'], [2, 'R']]), { q1: -1, q2: 1 });
    await add('partial-entry', 'BR 11.13', twenty, { q1: 2, q2: 2, q3: 2 });
    await add('only-bonus-diag-exam', 'BR 11.14', makeExam([[3, 'R', 'bonus'], [2, 'I', 'diag']]), { q1: 3 });
    await add('only-bonus-diag-exam-override', 'BR 11.14', makeExam([[3, 'R', 'bonus'], [2, 'I', 'diag']]), { q1: 3 }, { cijfer: 7, berekend: null });
    await add('max-points-0-zero', 'BR 11.15', makeExam([[0, 'R'], [2, 'T1']]), { q1: 0, q2: 1 });
    await add('max-points-0-half', 'BR 11.15', makeExam([[0, 'R'], [2, 'T1']]), { q1: 0.5, q2: 1 });
    await add('float-accumulation', 'BR 11.17', makeExam(normal(3, 0.3)), { q1: 0.1, q2: 0.2, q3: 0.3 });
    await add('float-accumulation-full', 'BR 11.17', makeExam([[0.1, 'R'], [0.2, 'R']]), { q1: 0.1, q2: 0.2 });
    await add('rtti-thirds', 'BR 11.20', makeExam([[3, 'R'], [3, 'T1'], [8, 'T2']]), { q1: 1, q2: 2, q3: 1 });
    await add('rtti-half-percent', 'BR 11.20', makeExam([[8, 'R'], [8, 'T1'], [200, 'T2']]), { q1: 1, q2: 3, q3: 1 });
    await add('string-numbers', 'BR 3.1', makeExam(normal(4, 2)), { q1: '1.5', q2: '1,5', q3: ' 2 ', q4: '' });
    await add('unknown-rtti-tag', 'BR 11.48', makeExam([[2, undefined], [2, 'R']]), { q1: 1, q2: 1 });
    await add('unknown-rtti-tag-unscored', 'BR 11.48', makeExam([[2, undefined], [2, 'R']]), { q2: 1 });

    // Overrides (BR 3.3, 11.22-23).
    const ov = makeExam(normal(10, 10), { n: 1 });
    const scoreFor = (total) => spread(total, 10, 10);
    await add('override-basic', 'BR 3.3', ov, scoreFor(50), { cijfer: 6.3, berekend: 5.5 });
    await add('override-not-stale', 'BR 11.22', ov, scoreFor(49.4), { cijfer: 6, berekend: 5.4 });
    await add('override-stale', 'BR 11.22', ov, scoreFor(50.1), { cijfer: 6, berekend: 5.4 });
    await add('override-berekend-null', 'BR 3.3', ov, scoreFor(50), { cijfer: 6, berekend: null });
    await add('override-non-number', 'BR 3.3', ov, scoreFor(50), { cijfer: '6', berekend: 5.5 });

    const er = async (id, rule, exam, rec) =>
      suite.add(id, rule, { exam, rec }, await capture(() => Store.examResults(rec, exam)));
    await er('examResults-override-only', 'BR 11.23', ov, { student_id: 1, scores: {}, overrides: { [ov.id]: { cijfer: 7.5, berekend: 6 } } });
    await er('examResults-nothing', 'BR 3.1', ov, { student_id: 1, scores: {} });
    await er('examResults-null-record', 'BR 3.1', ov, null);
    await er('examResults-unknown-question-ids', 'BR 3.1', ov, { student_id: 1, scores: { [ov.id]: { q99: 5 } } });
    await er('examResults-scores', 'BR 3.1', ov, { student_id: 1, scores: { [ov.id]: { q1: 7, q2: null, q3: 'x' } } });
  } finally {
    s.dispose();
  }
  return suite;
}
