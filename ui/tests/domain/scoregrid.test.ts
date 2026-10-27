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
      await expectCase(id, () => {
        for (let r = 0; r < summaryIdx; r++) recomputeRow(grid, exam, r, O);
        recomputeSummaryRow(grid, summaryIdx, summaryIdx + 1, exam, O);
        return { rows: [...grid], gradeInfo: grid.gradeInfo };
      });
    });
  }

  it('grid-one-row', async () => {
    const { exam } = inputOf<{ exam: Exam }>(goldenCase(golden, 'grid-one-row'));
    await expectCase('grid-one-row', () => {
      const grid: GridData = [
        ['1', 'A', '7', '', '', '', '', '', '', '', ''],
        Array(11).fill('x'),
        Array(11).fill('x'),
      ];
      recomputeRow(grid, exam, 0);
      recomputeSummaryRow(grid, 1, 2, exam);
      const noStd = structuredClone(grid);
      recomputeSummaryRow(noStd, 1, null, exam);
      return { withStd: grid, withoutStd: noStd };
    });
  });
});
