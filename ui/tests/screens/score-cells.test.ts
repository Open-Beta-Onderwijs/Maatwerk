// SPDX-License-Identifier: AGPL-3.0-or-later

// The score grid's pure look helpers (step 25, board 13; review 25 m6).

import { describe, expect, it } from 'vitest';
import { gridLayout, pctTint, scoreTint } from '../../src/screens/scores/cells';
import type { GridData } from '../../src/domain/scoregrid';
import type { Exam } from '../../src/domain/types';

describe('scoreTint', () => {
  const q = { max_points: 4 };
  it('tints by score', () => {
    expect(scoreTint('4', q)).toBe('sc-full');
    expect(scoreTint('2,5', q)).toBe('sc-part');
    expect(scoreTint('0', q)).toBe('sc-zero');
    expect(scoreTint('n', q)).toBe('sc-n');
    expect(scoreTint('5', q)).toBe('sc-bad');
    expect(scoreTint('abc', q)).toBe('sc-bad');
    expect(scoreTint('', q)).toBe('');
  });
});

describe('pctTint', () => {
  it('uses the thresholds 80 and 55', () => {
    expect(pctTint('80%')).toBe('sc-full');
    expect(pctTint('79%')).toBe('sc-part');
    expect(pctTint('55%')).toBe('sc-part');
    expect(pctTint('54%')).toBe('sc-zero');
    expect(pctTint('NVT')).toBe('sc-pct--nvt');
    expect(pctTint('')).toBe('');
  });
});

describe('gridLayout', () => {
  const exam = {
    id: 'e',
    questions: [
      { id: 'a', max_points: 1, rtti: 'R' },
      { id: 'b', max_points: 1, rtti: 'R' },
    ],
  } as Exam;
  const data = (width: number) =>
    [['1'], ['__avg__'], ['__std__']].map((r) => [...r, ...Array(width).fill('')]) as GridData;

  it('without observaties', () => {
    const l = gridLayout(exam, 0, data(12));
    expect([l.firstQCol, l.lastQCol, l.lastObsCol, l.gradeCol]).toEqual([2, 3, -1, 6]);
    expect([l.summaryIdx, l.stdIdx, l.lastDataRow]).toEqual([1, 2, 0]);
  });

  it('with observaties: a spacer after them', () => {
    const l = gridLayout(exam, 3, data(16));
    expect([l.obsStart, l.lastObsCol, l.gradeCol]).toEqual([5, 7, 10]);
  });
});
