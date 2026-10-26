// SPDX-License-Identifier: AGPL-3.0-or-later
// Score entry in the grid (screens/scores.js): input parsing, grade override
// input, row status, row and summary recomputation, n-term spinner and the
// "Cijfer onder" threshold input (business-rules.md section 2, candidates 16, 21, 31, 36).

import { Suite, capture } from '../golden.mjs';
import { bindFunctions, extractConst, extractFunction, extractSnippet } from '../extract.mjs';
import { openReference } from '../session.mjs';
import { makeExam } from './grades.mjs';

const SCORES = 'renderer/screens/scores.js';
const APP = 'renderer/app.js';
const SPIN = 'renderer/utils/spinners.js';
const OG = 'renderer/modals/opdrachten-genereren.js';

export default async function scoregrid() {
  const suite = new Suite('scoregrid', 'Score grid input parsing and row/summary computation.');
  const s = await openReference({ fixture: null, subject: 'nat' });
  try {
    const { Store } = s;
    const defs = [
      extractFunction(SCORES, 'parseScoreNum'),
      extractFunction(SCORES, 'scoreCellText'),
      extractFunction(SCORES, 'parseGradeInput'),
      extractFunction(SCORES, 'normalizeScore'),
      extractFunction(SCORES, 'sameOverride'),
      extractFunction(SCORES, 'recomputeRow'),
      extractFunction(SCORES, 'recomputeSummaryRow'),
      extractFunction(APP, 'formatGrade'),
    ];
    const { fns, refs } = bindFunctions(defs, { Store });
    suite.ref(refs);

    const inputs = [
      '',
      '  ',
      'n',
      'N',
      ' n ',
      '1,5',
      '1.5',
      ' 2 ',
      '1,5,0',
      '0x1',
      '1e0',
      '-0',
      '-1',
      '2',
      '2.0',
      '2,25',
      '3',
      'abc',
      '½',
      '0',
      null,
      undefined,
      1.5,
      0.1,
    ];
    suite.add(
      'normalizeScore',
      'BR 2.1, 11.16 (q.max_points = 2)',
      { inputs },
      inputs.map((i) => ({
        parseScoreNum: fns.parseScoreNum(i),
        normalizeScore: fns.normalizeScore(i, { max_points: 2 }),
      })),
    );
    const zeroMax = ['0', '0,5', 'N', ''];
    suite.add(
      'normalizeScore-max-0',
      'BR 11.15',
      { inputs: zeroMax },
      zeroMax.map((i) => fns.normalizeScore(i, { max_points: 0 })),
    );

    const grades = [
      '6,25',
      '6,24',
      '10,04',
      '10',
      '1',
      '0,9',
      '10,1',
      '1,04',
      '5.45',
      '',
      'abc',
      ' 7 ',
      '6,35',
    ];
    suite.add(
      'parseGradeInput',
      'BR 3.3, 11.21',
      { inputs: grades },
      grades.map((g) => fns.parseGradeInput(g)),
    );
    const pairs = [
      [undefined, undefined],
      [
        { cijfer: 6, berekend: 5.4 },
        { cijfer: 6, berekend: 5.4 },
      ],
      [{ cijfer: 6 }, { cijfer: 6, berekend: null }],
      [
        { cijfer: 6, berekend: 5.4 },
        { cijfer: 6, berekend: 5.5 },
      ],
      [null, { cijfer: null, berekend: null }],
    ];
    suite.add(
      'sameOverride',
      'BR 3.3',
      { pairs },
      pairs.map(([a, b]) => fns.sameOverride(a, b)),
    );

    // computeRowStatus is nested in createGroupHOT; gridData and exam are its free variables.
    const statusExam = makeExam([
      [2, 'R'],
      [3, 'T1'],
      [1, 'I', 'bonus'],
    ]);
    const rows = [
      ['1', 'A', '', '', ''],
      ['2', 'B', '2', '3', '1'],
      ['3', 'C', '2', '', ''],
      ['4', 'D', 'N', 'n', 'N'],
      ['5', 'E', '4', '', ''],
      ['6', 'F', 'abc', '1', '1'],
      ['7', 'G', null, undefined, '0'],
      ['__avg__', '', 'x', '', ''],
      ['8', 'H', '-1', '1', '1'],
      ['9', 'I', '1,5', '2,5', '0,5'],
    ];
    const status = bindFunctions([extractFunction(SCORES, 'computeRowStatus'), defs[0]], {
      gridData: rows,
      exam: statusExam,
    });
    suite.ref(status.refs);
    suite.add(
      'computeRowStatus',
      'BR 2.3',
      { exam: statusExam, rows },
      rows.map((_, i) => status.fns.computeRowStatus(i)).concat([status.fns.computeRowStatus(99)]),
    );

    // recomputeRow / recomputeSummaryRow on a small grid (O = 0 and O = 2 observatie columns).
    for (const O of [0, 2]) {
      const exam = makeExam(
        [
          [2, 'R'],
          [3, 'T1'],
          [2, 'T2'],
          [3, 'I'],
          [2, 'R', 'bonus'],
          [1, 'T1', 'diag'],
        ],
        { n: 1 },
      );
      const N = exam.questions.length;
      const TOFF = O > 0 ? O + 1 : 0;
      const width = N + 10 + TOFF;
      const cells = [
        ['2', '3', '2', '3', '2', '1'],
        ['1,5', '2', '0,5', '1', '', ''],
        ['N', 'N', 'N', 'N', '', ''],
        ['', '', '', '', '', ''],
        ['abc', '1', '', '', '', ''],
        ['2', '3', '2', '3', '2,5', ''],
        ['0,5', '0,5', '0,5', '0,5', '', '1'],
      ];
      const grid = cells.map((c, i) => {
        const row = Array(width).fill('');
        row[0] = String(900 + i);
        row[1] = `Leerling ${i}`;
        c.forEach((v, qi) => (row[2 + qi] = v));
        return row;
      });
      grid.push(Array(width).fill(''), Array(width).fill(''));
      grid.overrides = { 3: { cijfer: 7.5, berekend: null }, 6: { cijfer: 6, berekend: 2.4 } };
      grid.gradeInfo = {};
      const summaryIdx = cells.length;
      for (let r = 0; r < summaryIdx; r++) fns.recomputeRow(grid, exam, r, O);
      fns.recomputeSummaryRow(grid, summaryIdx, summaryIdx + 1, exam, O);
      suite.add(
        `grid-O${O}`,
        'BR 2, 11.31',
        { exam, cells, overrides: grid.overrides, O },
        { rows: [...grid], gradeInfo: grid.gradeInfo },
      );
    }
    // One graded row: SD row behaviour for n = 1, and no stdIdx.
    {
      const exam = makeExam([[10, 'R']]);
      const grid = [
        ['1', 'A', '7', '', '', '', '', '', '', '', ''],
        Array(11).fill('x'),
        Array(11).fill('x'),
      ];
      fns.recomputeRow(grid, exam, 0);
      fns.recomputeSummaryRow(grid, 1, 2, exam);
      const noStd = structuredClone(grid);
      fns.recomputeSummaryRow(noStd, 1, null, exam);
      suite.add('grid-one-row', 'BR 11.31', { exam }, { withStd: grid, withoutStd: noStd });
    }

    // n-term spinner set() (nested in wireSpinners; step/min/max/dec/sp/inp are its free variables).
    const values = [1.3, 1.25, 1.35, 0.05, -1, 3.04, 3.06, 2.95, 0.1 + 0.2, 1 / 3, NaN];
    const spin = values.map((v) => {
      // A DOM dataset stores strings.
      const dataset = new Proxy({}, { set: (o, k, v) => ((o[k] = String(v)), true) });
      const sp = { dataset };
      const inp = { value: '' };
      const { fns: f } = bindFunctions([extractFunction(SPIN, 'set')], {
        step: 0.1,
        min: 0,
        max: 3,
        dec: 1,
        sp,
        inp,
      });
      f.set(v);
      return { val: sp.dataset.val, shown: inp.value };
    });
    suite.ref(
      `${SPIN}:${extractFunction(SPIN, 'set').start}-${extractFunction(SPIN, 'set').end} set`,
    );
    suite.add('nterm-spinner', 'BR 2.4, 11.5 (step 0.1, min 0, max 3)', { values }, spin);

    // "Cijfer onder" threshold input (inline in a change listener).
    const og = extractSnippet(OG, {
      start: 443,
      end: 454,
      name: 'cijferOnder',
      breakable: true,
      params: ['state', 't'],
      contains: ['n <= 1 || n > 10', 'card.onder = Math.round(n * 10) / 10;'],
      prologue: 'const toasts = [];',
      epilogue: 'return { onder: state.cijfer[0].onder, shown: t.value, toasts };',
    });
    const fmtOnder = extractConst(OG, 'fmtOnder');
    const typed = ['1', '1,0', '1,05', '10', '10,04', '10,05', '', 'abc', '5,45', ' 6 ', '0', '-3'];
    const out = [];
    for (const v of typed) {
      const toastCalls = [];
      const { fns: f } = bindFunctions([fmtOnder, og], {
        toast: (...a) => toastCalls.push(a),
        recompute: () => {},
        el: null,
        year: null,
      });
      const state = { cijfer: [{ id: 'c1', onder: 5.5, opdrachten: [] }] };
      const r = await capture(() =>
        f.cijferOnder(state, { value: v, dataset: { card: 'c1' }, blur() {} }),
      );
      out.push({ ...r, toasts: toastCalls });
    }
    suite.ref(
      `${OG}:${og.start}-${og.end} case og-cijfer-onder`,
      `${OG}:${fmtOnder.start}-${fmtOnder.end} fmtOnder`,
    );
    suite.add('cijfer-onder-input', 'BR 7.4, 11.36', { typed, startOnder: 5.5 }, out);
  } finally {
    s.dispose();
  }
  return suite;
}
