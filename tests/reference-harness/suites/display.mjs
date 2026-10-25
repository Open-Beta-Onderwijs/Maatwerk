// SPDX-License-Identifier: AGPL-3.0-or-later
// Grade display and colour helpers: formatGrade, utils/colors.js, utils/grades.js
// (business-rules.md section 3.4, candidates 18-19).

import { Suite } from '../golden.mjs';
import { bindFunctions, extractConst, extractFunction } from '../extract.mjs';

const COLORS = 'renderer/utils/colors.js';
const GRADES = 'renderer/utils/grades.js';
const APP = 'renderer/app.js';

export default async function display() {
  const suite = new Suite('display', 'Grade formatting, pass/fail and colour scales.');
  const defs = [
    extractFunction(APP, 'formatGrade'),
    ...['examTypeColor', 'hexToRgb', 'lerpColor', 'stdDevGradeColor', 'isFail', 'gradeColor', 'rttiPctColor'].map((n) =>
      extractFunction(COLORS, n),
    ),
    extractConst(GRADES, 'GRADE_GROUP_LABELS'),
    extractConst(GRADES, 'GRADE_GROUP_MIDPOINTS'),
    ...['gradeGroupIdx', 'gradeChartColor', 'gradeTextColor', 'gradeBorderColor', 'gradeCell', 'gradeStatHtml'].map((n) =>
      extractFunction(GRADES, n),
    ),
  ];
  const { fns, refs } = bindFunctions(defs);
  suite.ref(refs);

  // Values built to land on and around rounding boundaries (x.x5 in binary floating point).
  const grades = [null, undefined, 1, 1.04, 1.05, 5.4, 5.44, 5.449999, 5.45, 5.450001, 5.46, 5.5, 5.55, 5.549999, 6.25, 6.35, 6.45, 7.075, 8.649999999999999, 9.95, 9.99, 10, 0.95, 4.15];
  suite.add(
    'grade-boundaries',
    'BR 3.4, 11.18-19',
    { grades },
    grades.map((g) => ({
      formatGrade: fns.formatGrade(g),
      isFail: g == null ? null : fns.isFail(g),
      toFixed1: g == null ? null : g.toFixed(1),
      gradeGroupIdx: g == null ? null : fns.gradeGroupIdx(g),
      gradeChartColor: g == null ? null : fns.gradeChartColor(g),
      gradeTextColor: fns.gradeTextColor(g),
      gradeBorderColor: fns.gradeBorderColor(g),
      gradeCell: fns.gradeCell(g),
    })),
  );

  const gradeStrs = ['', '—', 'abc', '1,0', '5,4', '5,5', '7,3', '10,0', '11,0', '5.5'];
  suite.add('gradeColor', 'BR 3.4', { gradeStrs }, gradeStrs.map((x) => fns.gradeColor(x)));
  const pcts = ['', 'NVT', 'abc', '0%', '33%', '50', '67%', '100%', '120%', '-5%'];
  suite.add('rttiPctColor', 'BR 4', { pcts }, pcts.map((x) => fns.rttiPctColor(x)));
  const sds = ['', 'abc', '0,0', '0.5', '1,0', '1,5', '2,0', '3,5'];
  suite.add('stdDevGradeColor', 'BR 6.1', { sds }, sds.map((x) => fns.stdDevGradeColor(x)));
  suite.add(
    'examTypeColor',
    'colors.js',
    { types: ['pta', 'po', 'regular', undefined] },
    ['pta', 'po', 'regular', undefined].map((type) => fns.examTypeColor({ type })),
  );
  suite.add(
    'lerpColor',
    'colors.js',
    { cases: [['#000000', '#ffffff', 0.5], ['#e57373', '#66bb6a', 0], ['#e57373', '#66bb6a', 1], ['#e57373', '#66bb6a', 1.5], ['#e57373', '#66bb6a', -0.5]] },
    [['#000000', '#ffffff', 0.5], ['#e57373', '#66bb6a', 0], ['#e57373', '#66bb6a', 1], ['#e57373', '#66bb6a', 1.5], ['#e57373', '#66bb6a', -0.5]].map((a) => fns.lerpColor(...a)),
  );
  const statInputs = [
    { mean: 6.5, sd: 1.2, fails: 20 },
    { mean: 5.45, sd: 0, fails: 100 },
    { mean: 5.449999, sd: 2.25, fails: 50 },
  ];
  suite.add('gradeStatHtml', 'grades.js', { statInputs }, statInputs.map((x) => fns.gradeStatHtml(x)));
  suite.add('grade-groups', 'grades.js', null, { labels: fns.GRADE_GROUP_LABELS, midpoints: fns.GRADE_GROUP_MIDPOINTS });
  return suite;
}
