// SPDX-License-Identifier: AGPL-3.0-or-later

// Score grid logic against the scoregrid.json golden (spec G10-G16, G20).
// Not consumed here: nterm-spinner (utils/spinners.js) and og-cijfer-onder
// (opdrachten-genereren.js), which are not score grid code.

import { describe, expect, it } from 'vitest';
import {
  computeRowStatus,
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
      ) as unknown;
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
    expect(grid).toEqual(expected);
  });
});
