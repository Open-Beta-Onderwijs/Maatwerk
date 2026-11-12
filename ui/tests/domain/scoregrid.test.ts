// SPDX-License-Identifier: AGPL-3.0-or-later

// Score grid logic against the scoregrid.json golden (spec G10-G16, G20).
// Not consumed here: nterm-spinner (utils/spinners.js) and og-cijfer-onder
// (opdrachten-genereren.js), which are not score grid code.

import { describe, expect, it } from 'vitest';
import {
  computeRowStatus,
  groupStatus,
  normalizeScore,
  parseGradeInput,
  parseScoreNum,
  recomputeRow,
  recomputeSummaryRow,
  sameOverride,
  type GridData,
} from '../../src/domain/scoregrid';
import type { Exam, Override } from '../../src/domain/types';
import { goldenCase, inputOf, loadGolden, run } from '../golden';

const golden = loadGolden('scoregrid');
const expectCase = async (id: string, fn: () => unknown) =>
  expect(await run(fn)).toEqual(goldenCase(golden, id).output);

describe('score grid decisions', () => {
  const exam: Exam = {
    id: 'e',
    n_term: 1,
    questions: [
      { id: 'q1', max_points: 10, rtti: 'R' },
      { id: 'q2', max_points: 10, rtti: 'T1' },
      { id: 'b', max_points: 5, rtti: 'R', kind: 'bonus' },
      { id: 'd', max_points: 5, rtti: 'R', kind: 'diag' },
    ],
  };

  it('the approved Totaal example: real half points and the normal max (B4, B5)', () => {
    const width = 14;
    const row = (id: string, a: string, b: string): GridData[number] => {
      const r: GridData[number] = Array(width).fill('');
      r[0] = id;
      r[2] = a;
      r[3] = b;
      return r;
    };
    const grid = [
      row('1', '6,5', '6'),
      row('2', '7', '7'),
      Array(width).fill(''),
      Array(width).fill(''),
    ] as GridData;
    recomputeRow(grid, exam, 0);
    recomputeRow(grid, exam, 1);
    recomputeSummaryRow(grid, 2, 3, exam);
    const totaal = 7; // N + 3 with N = 4 questions
    expect(grid[0]![totaal]).toBe('12,5 / 20');
    expect(grid[2]![totaal]).toBe('13,3 / 20');
  });
});

describe('score grid decision 26', () => {
  it('the average Totaal counts only rows with a grade', () => {
    const exam: Exam = {
      id: 'e',
      n_term: 1,
      questions: [
        { id: 'q1', max_points: 40, rtti: 'R' },
        { id: 'd', max_points: 5, rtti: 'R', kind: 'diag' },
      ],
    };
    const width = 12;
    const row = (a: string, d: string): GridData[number] => {
      const r: GridData[number] = Array(width).fill('');
      r[0] = 'x';
      r[2] = a;
      r[3] = d;
      return r;
    };
    const grid = [
      row('20', ''),
      row('', '3'), // only a diagnostic score: Totaal 0 / 40, no grade
      Array(width).fill(''),
      Array(width).fill(''),
    ] as GridData;
    recomputeRow(grid, exam, 0);
    recomputeRow(grid, exam, 1);
    recomputeSummaryRow(grid, 2, 3, exam);
    const totaal = 5; // N + 3 with N = 2 questions
    expect(grid[1]![totaal]).toBe('0 / 40');
    expect(grid[2]![totaal]).toBe('20,0 / 40');
  });
});

// The average row with the cells decision 29 fills taken from `actual`.
function withAverages(
  expected: GridData[number],
  actual: GridData[number],
  N: number,
  O: number,
): GridData[number] {
  const TOFF = O > 0 ? O + 1 : 0;
  const filled = new Set<number>();
  for (let qi = 0; qi < N; qi++) filled.add(2 + qi);
  for (let i = 0; i < O; i++) filled.add(N + 3 + i);
  for (let k = 0; k < 4; k++) filled.add(N + 6 + TOFF + k);
  return expected.map((c, i) => (filled.has(i) ? actual[i] : c));
}

describe('score grid decision 29', () => {
  // 2 questions (R 4p, T1 6p), a diagnostic question, 1 observatie; 3 students and one empty.
  const exam: Exam = {
    id: 'e',
    n_term: 1,
    questions: [
      { id: 'q1', max_points: 4, rtti: 'R' },
      { id: 'q2', max_points: 6, rtti: 'T1' },
      { id: 'd', max_points: 2, rtti: 'I', kind: 'diag' },
    ],
  };
  const O = 1;
  const N = exam.questions.length;
  const width = N + 10 + O + 1;
  const row = (cells: string[], obs: boolean): GridData[number] => {
    const r: GridData[number] = Array(width).fill('');
    r[0] = 'x';
    cells.forEach((v, i) => (r[2 + i] = v));
    r[N + 3] = obs;
    return r;
  };

  it('question averages as the rapport, ticked counts, mean RTTI percentages', () => {
    const grid = [
      row(['4', '3', ''], true), // R 100%, T1 50%
      row(['N', '6', ''], false), // R 0% (N counts 0), T1 100%
      row(['2', '', '1'], true), // R 50%, T1 NVT (nothing entered)
      row(['', '', ''], false), // nothing entered: no grade
      Array(width).fill(''),
      Array(width).fill(''),
    ] as GridData;
    for (let r = 0; r < 4; r++) recomputeRow(grid, exam, r, O);
    recomputeSummaryRow(grid, 4, 5, exam, O);
    const avg = grid[4]!;
    // q1: (4 + 0 + 2) / 3 = 2,0 (N counts 0); q2: (3 + 6) / 2 = 4,5 (empty left out);
    // d: 1 / 1 = 1,0.
    expect(avg.slice(2, 2 + N)).toEqual(['2,0', '4,5', '1,0']);
    expect(avg[N + 3]).toBe('2');
    const rtti = avg.slice(N + 6 + O + 1, N + 10 + O + 1);
    // R (100 + 0 + 50) / 3 = 50%; T1 (50 + 100) / 2 = 75% (NVT left out); T2 none: NVT.
    expect(rtti[0]).toBe('50%');
    expect(rtti[1]).toBe('75%');
    expect(rtti[2]).toBe('NVT');
  });

  it('without observaties; an invalid score counts 0 in the question average', () => {
    const w = N + 10;
    const r = (cells: string[]): GridData[number] => {
      const x: GridData[number] = Array(w).fill('');
      x[0] = 'x';
      cells.forEach((v, i) => (x[2 + i] = v));
      return x;
    };
    const grid = [
      r(['4', '6', '']),
      r(['abc', '6', '']),
      Array(w).fill(''),
      Array(w).fill(''),
    ] as GridData;
    recomputeRow(grid, exam, 0);
    recomputeRow(grid, exam, 1);
    recomputeSummaryRow(grid, 2, 3, exam);
    expect(grid[2]!.slice(2, 2 + N)).toEqual(['2,0', '6,0', '']);
    expect(grid[2]![N + 2]).toBe(''); // spacer
  });

  it('a question nobody has entered stays empty', () => {
    const grid = [
      row(['4', '', ''], false),
      Array(width).fill(''),
      Array(width).fill(''),
    ] as GridData;
    recomputeRow(grid, exam, 0, O);
    recomputeSummaryRow(grid, 1, 2, exam, O);
    expect(grid[1]!.slice(2, 2 + N)).toEqual(['4,0', '', '']);
    expect(grid[1]![N + 3]).toBe('0');
  });
});

describe('group status line (board 13)', () => {
  const exam = {
    questions: [
      { id: 'a', max_points: 2, rtti: 'R' as const },
      { id: 'b', max_points: 2, rtti: 'R' as const },
    ],
  };
  const r = (a: string, b: string): GridData[number] => ['x', 'X', a, b];
  it('reads every case', () => {
    expect(groupStatus([r('1', '2'), r('N', '0')], exam)).toEqual({
      text: 'alle scores ingevuld',
      level: 'ok',
    });
    expect(groupStatus([r('', ''), r('', '')], exam).text).toBe('nog geen scores');
    expect(groupStatus([r('1', ''), r('', '')], exam).text).toBe('2 nog niet compleet');
    expect(groupStatus([r('9', '1'), r('1', '')], exam)).toEqual({
      text: '1 met een ongeldige score, 1 nog niet compleet',
      level: 'bad',
    });
  });
});

describe('scoregrid golden', () => {
  it('normalizeScore', async () => {
    const { inputs } = inputOf<{ inputs: unknown[] }>(goldenCase(golden, 'normalizeScore'));
    await expectCase('normalizeScore', () =>
      inputs.map((i) => ({
        parseScoreNum: parseScoreNum(i),
        normalizeScore: normalizeScore(i, { max_points: 2 }),
      })),
    );
  });

  it('normalizeScore-max-0', async () => {
    const { inputs } = inputOf<{ inputs: unknown[] }>(goldenCase(golden, 'normalizeScore-max-0'));
    await expectCase('normalizeScore-max-0', () =>
      inputs.map((i) => normalizeScore(i, { max_points: 0 })),
    );
  });

  it('parseGradeInput', async () => {
    const { inputs } = inputOf<{ inputs: unknown[] }>(goldenCase(golden, 'parseGradeInput'));
    await expectCase('parseGradeInput', () => inputs.map(parseGradeInput));
  });

  it('sameOverride', async () => {
    const { pairs } = inputOf<{ pairs: [Override, Override][] }>(
      goldenCase(golden, 'sameOverride'),
    );
    await expectCase('sameOverride', () => pairs.map(([a, b]) => sameOverride(a, b)));
  });

  it('computeRowStatus', async () => {
    const { exam, rows } = inputOf<{ exam: Exam; rows: GridData }>(
      goldenCase(golden, 'computeRowStatus'),
    );
    await expectCase('computeRowStatus', () =>
      rows.map((row) => computeRowStatus(row, exam)).concat([computeRowStatus(rows[99], exam)]),
    );
  });

  for (const O of [0, 2]) {
    it(`grid-O${O}`, async () => {
      const id = `grid-O${O}`;
      const { exam, cells, overrides } = inputOf<{
        exam: Exam;
        cells: string[][];
        overrides: GridData['overrides'];
      }>(goldenCase(golden, id));
      // Built as the harness did (tests/reference-harness/suites/scoregrid.mjs).
      const N = exam.questions.length;
      const width = N + 10 + (O > 0 ? O + 1 : 0);
      const grid = cells.map((c, i) => {
        const row: GridData[number] = Array(width).fill('');
        row[0] = String(900 + i);
        row[1] = `Leerling ${i}`;
        c.forEach((v, qi) => (row[2 + qi] = v));
        return row;
      }) as GridData;
      grid.push(Array(width).fill(''), Array(width).fill(''));
      grid.overrides = overrides;
      grid.gradeInfo = {};
      const summaryIdx = cells.length;
      const actual = await run(() => {
        for (let r = 0; r < summaryIdx; r++) recomputeRow(grid, exam, r, O);
        recomputeSummaryRow(grid, summaryIdx, summaryIdx + 1, exam, O);
        return { rows: [...grid], gradeInfo: grid.gradeInfo };
      });
      // Totals in a summary row divide by the normal questions' max, not by all (B4, decision 12).
      const decided = JSON.parse(
        JSON.stringify(goldenCase(golden, id).output).replaceAll(' / 13"', ' / 10"'),
      ) as { rows: GridData };
      // Decision 29 (step 25) fills the average row's question, observatie and RTTI cells;
      // they are checked in "score grid decision 29".
      decided.rows[summaryIdx] = withAverages(
        decided.rows[summaryIdx]!,
        (actual as { rows: GridData }).rows[summaryIdx]!,
        N,
        O,
      );
      expect(actual).toEqual(decided);
    });
  }

  it('grid-one-row', async () => {
    const { exam } = inputOf<{ exam: Exam }>(goldenCase(golden, 'grid-one-row'));
    const grid: GridData = [
      ['1', 'A', '7', '', '', '', '', '', '', '', ''],
      Array(11).fill('x'),
      Array(11).fill('x'),
    ];
    recomputeRow(grid, exam, 0);
    recomputeSummaryRow(grid, 1, 2, exam);
    const sdRow = grid[2]!;
    // Decision 11: one student has SD 0,0 here too (the reference left it empty).
    expect(sdRow.filter((c) => c === '0,0')).toHaveLength(2);
    const output = goldenCase(golden, 'grid-one-row').output as { withStd: GridData };
    const expected = output.withStd.map((row, r) =>
      r === 2 ? row.map((c, i) => (sdRow[i] === '0,0' ? '0,0' : c)) : row,
    );
    expected[1] = withAverages(expected[1]!, grid[1]!, exam.questions.length, 0);
    expect(grid[1]![2]).toBe('7,0'); // decision 29: the question's average
    expect(grid).toEqual(expected);
  });
});
