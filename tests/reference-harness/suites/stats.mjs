// SPDX-License-Identifier: AGPL-3.0-or-later
// Exam statistics: exam cards (screens/toetsen.js), the overview modal
// accumulation, histogram bins and boxplot quartiles (modals/toets-overzicht.js)
// (business-rules.md section 6, candidates 29, 31-34).

import { Suite, capture } from '../golden.mjs';
import { bindFunctions, extractFunction, extractSnippet } from '../extract.mjs';
import { openReference } from '../session.mjs';
import {
  TEN_BY_TEN,
  YEAR,
  buildData,
  readTree,
  exam,
  pointsFor,
  student,
  tenByTen,
} from '../scenario.mjs';

const TOETSEN = 'renderer/screens/toetsen.js';
const OVERZICHT = 'renderer/modals/toets-overzicht.js';
const COLORS = 'renderer/utils/colors.js';
const GRADES = 'renderer/utils/grades.js';

const parent = exam('nat-stat-2025-2026', TEN_BY_TEN, { obs_ids: ['obs-x', 'obs-y'] });
const resit = exam(
  'nat-stat-herkansing-2025-2026',
  [
    [10, 'R'],
    [10, 'T1'],
  ],
  { parent_id: parent.id, attempt: 2, n_term: 2 },
);
const g = (grade) => tenByTen(pointsFor(grade));

// [id, scores on parent, scores on resit, override on parent, observaties, group]
const ROWS = [
  [1, g(7.2), null, null, ['obs-x'], 'g1'],
  [2, g(5.45), null, null, [], 'g1'],
  [3, g(5.44), { q1: 9, q2: 9 }, null, ['obs-x', 'obs-y'], 'g1'],
  [4, { q1: null, q2: 'N' }, null, null, [], 'g2'],
  [5, { q1: 12, q2: 5 }, null, null, [], 'g2'],
  [6, {}, null, { cijfer: 6.5, berekend: null }, ['obs-y'], 'g2'],
  [7, null, null, null, ['obs-x'], null],
  [8, { q1: 'abc', q2: -1 }, null, null, [], 'g1'],
  [9, null, { q1: 4, q2: 4 }, null, [], 'g2'],
  [10, g(9.99), null, null, [], null],
];

function spec() {
  const scores = {};
  for (const [id, ps, rs, ov, obs] of ROWS) {
    const sc = {};
    if (ps) sc[parent.id] = ps;
    if (rs) sc[resit.id] = rs;
    scores[id] = {
      scores: sc,
      observations: { [parent.id]: obs },
      ...(ov ? { overrides: { [parent.id]: ov } } : {}),
    };
  }
  const group = (gid) => ({
    id: gid,
    name: `${gid} nat`,
    jaarlaag: '3',
    subject: 'nat',
    student_ids: ROWS.filter((r) => r[5] === gid).map((r) => r[0]),
  });
  return {
    observaties: ['obs-x', 'obs-y'].map((id) => ({
      id,
      naam: id,
      icon: '📏',
      subjects: ['nat'],
      jaarlagen: [],
    })),
    years: {
      [YEAR]: {
        students: ROWS.map((r) => student(r[0])),
        exams: [parent, resit],
        groups: [group('g1'), group('g2')],
        scores: { nat: scores },
      },
    },
  };
}

export default async function stats() {
  const suite = new Suite(
    'stats',
    'Exam statistics, overview accumulation, histogram and boxplot.',
  );
  const data = spec();
  let tree;
  const s = await openReference({
    fixture: (dir) => {
      buildData(dir, data);
      tree = readTree(dir);
    },
    subject: 'nat',
  });
  try {
    const { Store, qKind } = s;
    const colorDefs = ['hexToRgb', 'lerpColor', 'isFail'].map((n) => extractFunction(COLORS, n));
    const gradeDefs = ['gradeGroupIdx', 'gradeChartColor'].map((n) => extractFunction(GRADES, n));
    const cards = bindFunctions(
      [
        ...colorDefs,
        ...['computeExamStats', 'computeExamWarnings', 'computeBestGradeStats'].map((n) =>
          extractFunction(TOETSEN, n),
        ),
      ],
      { Store, qKind },
    );
    suite.ref(cards.refs);
    suite.add('data', 'BR 6', { files: tree }, null);
    suite.add(
      'computeExamStats',
      'BR 6.1, 11.31',
      { exam: parent.id },
      await capture(() => cards.fns.computeExamStats(YEAR, parent)),
    );
    suite.add(
      'computeExamStats-resit',
      'BR 6.1',
      { exam: resit.id },
      await capture(() => cards.fns.computeExamStats(YEAR, resit)),
    );
    suite.add(
      'computeExamWarnings',
      'BR 6.1',
      { exam: parent.id },
      await capture(() => cards.fns.computeExamWarnings(YEAR, parent)),
    );
    suite.add(
      'computeBestGradeStats',
      'BR 6.1, 11.29',
      { parent: parent.id },
      await capture(() => cards.fns.computeBestGradeStats(parent.id, YEAR)),
    );

    // Overview accumulation (inline in openExamOverviewModal) and summary.
    const accumulate = extractSnippet(OVERZICHT, {
      start: 39,
      end: 158,
      name: 'accumulate',
      params: ['examId', 'year', 'scoreOverride'],
      contains: ['const rttiAccum', 'stat.totalScored += num;', 'obsAccum[obsId].byGradeGroup'],
      epilogue: `return { grades, qStats: qStats.map((x) => ({ q: x.q.id, totalScored: x.totalScored, totalMax: x.totalMax })),
        rttiAccum, groupStats: [...groupStatsMap.values()].map((e) => ({ group: e.group.id, grades: e.grades,
        qStats: e.qStats.map((x) => [x.q.id, x.totalScored, x.totalMax]) })), obsAccum,
        studentGroup: Object.fromEntries([...studentGroupMap].map(([k, v]) => [k, v.id])) };`,
    });
    accumulate.source = accumulate.source.replace(/^function /, 'async function ');
    const summary = extractSnippet(OVERZICHT, {
      start: 171,
      end: 176,
      name: 'summary',
      params: ['grades'],
      contains: ['const mean =', 'const fails ='],
      epilogue: 'return { mean, sd, fails };',
    });
    const qPcts = extractSnippet(OVERZICHT, {
      start: 800,
      end: 802,
      name: 'qPctsOf',
      params: ['qStats'],
      contains: 'Math.round((s.totalScored / s.totalMax) * 100)',
      epilogue: 'return qPcts;',
    });
    const ov = bindFunctions([...colorDefs, ...gradeDefs, accumulate, summary, qPcts], { Store });
    suite.ref(ov.refs);
    const runOverview = async (id, scoreOverride, label, rule) => {
      const acc = await capture(() => ov.fns.accumulate(id, YEAR, scoreOverride));
      const sum = acc.grades?.length ? ov.fns.summary(acc.grades) : null;
      const pcts = acc.qStats ? ov.fns.qPctsOf(acc.qStats) : null;
      suite.add(
        label,
        rule,
        { exam: id, scoreOverride: scoreOverride ? 'computeBestGradeMap' : null },
        { ...acc, summary: sum, qPcts: pcts },
      );
    };
    await runOverview(parent.id, null, 'overview-exam', 'BR 6.2, 11.34');
    await runOverview(
      parent.id,
      await Store.computeBestGradeMap(parent.id, YEAR),
      'overview-summary',
      'BR 6.2, 11.29',
    );

    // Histogram and boxplot helpers (nested in openExamOverviewModal).
    const hist = bindFunctions([
      ...colorDefs,
      ...gradeDefs,
      extractFunction(OVERZICHT, 'makeHistBins'),
      extractFunction(OVERZICHT, 'boxStats'),
    ]);
    suite.ref(hist.refs);
    const histGrades = [1.0, 1.49, 5.47, 5.5, 9.99, 10.0, 0.5, 5.45, 5.449999, 3.0, 2.99];
    suite.add(
      'makeHistBins',
      'BR 6.2, 11.32',
      { grades: histGrades },
      {
        step05: hist.fns.makeHistBins(0.5, histGrades),
        step1: hist.fns.makeHistBins(1, histGrades),
      },
    );
    const sets = [
      [],
      [7],
      [7, 3],
      [4, 1, 3, 2],
      [5, 1, 4, 2, 3],
      [9.5, 1.2, 5.5, 5.5, 6.1, 7.7, 3.3, 8],
    ];
    suite.add(
      'boxStats',
      'BR 6.2, 11.33',
      { sets },
      sets.map((v) => hist.fns.boxStats(v)),
    );
    suite.add(
      'gradeGroupIdx',
      'BR 6.2',
      { grades: [1, 3.99, 4, 4.99, 5, 5.45, 5.99, 6, 6.99, 7, 7.99, 8, 10] },
      [1, 3.99, 4, 4.99, 5, 5.45, 5.99, 6, 6.99, 7, 7.99, 8, 10].map((x) =>
        ov.fns.gradeGroupIdx(x),
      ),
    );
  } finally {
    s.dispose();
  }
  return suite;
}
