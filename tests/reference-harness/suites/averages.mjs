// SPDX-License-Identifier: AGPL-3.0-or-later
// Weighted averages: year and PTA (SE) averages in the profile modal and the
// group overview (business-rules.md section 6.3, candidates 24-30).

import { Suite } from '../golden.mjs';
import { bindFunctions, extractFunction, extractSnippet } from '../extract.mjs';
import { openReference } from '../session.mjs';
import { TEN_BY_TEN, YEAR, buildData, exam, pointsFor, student, tenByTen } from '../scenario.mjs';

const PROFIEL = 'renderer/modals/profiel.js';
const GL = 'renderer/modals/groep-leerlingen.js';
const PREV = '2024-2025';

const g = (grade) => tenByTen(pointsFor(grade));
const EXAMS = [
  exam('nat-w1-2025-2026', TEN_BY_TEN, { weging: 1, weging_se: 1, type: 'pta', volgnummer: 301 }),
  exam('nat-w2-2025-2026', TEN_BY_TEN, { weging: 2, weging_se: 3, type: 'pta', volgnummer: 302 }),
  exam('nat-w3-2025-2026', TEN_BY_TEN, { weging: 0.5, weging_se: undefined, type: 'pta', volgnummer: 303 }),
  exam('nat-w4-2025-2026', TEN_BY_TEN, { weging: 0, weging_se: 0, type: 'regular', volgnummer: 304 }),
  exam('nat-w5-2025-2026', TEN_BY_TEN, { weging: undefined, weging_se: undefined, type: 'pta', volgnummer: 305 }),
  exam('nat-w1-herkansing-2025-2026', TEN_BY_TEN, { parent_id: 'nat-w1-2025-2026', attempt: 2, weging: 5, type: 'pta', volgnummer: 301 }),
  exam('nat-w6-2025-2026', TEN_BY_TEN, { weging: '2', weging_se: '0', type: 'pta', volgnummer: 306 }),
];
const PREV_EXAM = exam('nat-v1-2024-2025', TEN_BY_TEN, { jaarlaag: '2', weging: 1, weging_se: 2, type: 'pta', volgnummer: 201 });

const STUDENTS = {
  1: { 'nat-w1-2025-2026': g(4), 'nat-w1-herkansing-2025-2026': g(7), 'nat-w2-2025-2026': g(6), 'nat-w3-2025-2026': g(8), 'nat-w4-2025-2026': g(10) },
  2: { 'nat-w5-2025-2026': g(5.5), 'nat-w6-2025-2026': g(9) },
  3: { 'nat-w1-herkansing-2025-2026': g(6) },
  4: {},
  5: { 'nat-w4-2025-2026': g(3) },
};

function spec() {
  const recs = {};
  for (const [id, scores] of Object.entries(STUDENTS)) recs[id] = { scores, observations: {} };
  recs[2].overrides = { 'nat-w5-2025-2026': { cijfer: 7, berekend: 5.5 } };
  return {
    years: {
      [YEAR]: {
        students: Object.keys(STUDENTS).map((id) => student(Number(id))),
        exams: EXAMS.map((e) => JSON.parse(JSON.stringify(e))),
        groups: [{ id: 'g1', name: '3a nat', jaarlaag: '3', subject: 'nat', student_ids: [1, 2, 3, 4, 5] }],
        scores: { nat: recs },
      },
      [PREV]: {
        students: [student(1, { jaarlaag: '2' })],
        exams: [PREV_EXAM],
        scores: { nat: { 1: { scores: { [PREV_EXAM.id]: g(5) }, observations: {} } } },
      },
    },
  };
}

export default async function averages() {
  const suite = new Suite('averages', 'Weighted year and SE (PTA) averages with best attempts.');
  const data = spec();
  const s = await openReference({ fixture: (dir) => buildData(dir, data), subject: 'nat' });
  try {
    const { Store } = s;
    await Store.loadYear(PREV, 'nat');
    const exams = Store.getExamsSync(YEAR);
    const profiel = bindFunctions([extractFunction(PROFIEL, 'yearAvg'), extractFunction(PROFIEL, 'ptaAvg')], { Store });
    const scoreMap = {};
    for (const id of Object.keys(STUDENTS)) scoreMap[id] = await Store.getStudentScores(Number(id), YEAR);
    const dossier = extractSnippet(GL, {
      start: 57,
      end: 71,
      name: 'dossierAverages',
      params: ['students'],
      contains: ['const dossierAvgMap = {};', 'exam.weging_se ?? exam.weging ?? 1'],
      epilogue: 'return dossierAvgMap;',
    });
    dossier.source = dossier.source.replace(/^function /, 'async function ');
    const gl = bindFunctions(
      ['studentGrade', 'bestGradeForFamily', 'calcWeightedAvg'].map((n) => extractFunction(GL, n)).concat([dossier]),
      { Store, scoreMap },
    );
    suite.ref(profiel.refs, gl.refs);
    suite.add('data', 'BR 6.3', data, null);

    const family = {
      original: exams.find((e) => e.id === 'nat-w1-2025-2026'),
      resits: exams.filter((e) => e.parent_id === 'nat-w1-2025-2026'),
    };
    for (const id of Object.keys(STUDENTS)) {
      const sid = Number(id);
      const history = await Store.getStudentHistory(sid);
      const best = Store.resolveBestAttempts(history);
      const st = { id: sid };
      const pairs = exams
        .filter((e) => !e.parent_id)
        .map((e) => ({ grade: gl.fns.studentGrade(st, e), weging: e.weging_se ?? e.weging }));
      const fam = gl.fns.bestGradeForFamily(st, family);
      suite.add(`student-${id}`, 'BR 6.3, 11.30', { studentId: sid }, {
        yearAvg: profiel.fns.yearAvg(exams, scoreMap[id]),
        ptaAvg: profiel.fns.ptaAvg(best),
        ptaAvgRawHistory: profiel.fns.ptaAvg(history),
        bestGradeForFamily: { exam: fam.exam?.id ?? null, grade: fam.grade },
        calcWeightedAvg: gl.fns.calcWeightedAvg(pairs),
      });
    }
    suite.add(
      'calcWeightedAvg-direct',
      'BR 6.3',
      { pairs: [[{ grade: 6, weging: 1 }, { grade: 8, weging: 2 }], [{ grade: null, weging: 1 }], [{ grade: 7, weging: 0 }], [{ grade: 7 }, { grade: 5, weging: '3' }], []] },
      [[{ grade: 6, weging: 1 }, { grade: 8, weging: 2 }], [{ grade: null, weging: 1 }], [{ grade: 7, weging: 0 }], [{ grade: 7 }, { grade: 5, weging: '3' }], []].map((p) => gl.fns.calcWeightedAvg(p)),
    );
    suite.add('dossierAverages', 'BR 6.3', { students: Object.keys(STUDENTS).map(Number) }, await gl.fns.dossierAverages(Object.keys(STUDENTS).map((id) => student(Number(id)))));
  } finally {
    s.dispose();
  }
  return suite;
}
