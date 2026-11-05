// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  GRADE_BAR,
  gradeBarColor,
  gradeCellColor,
  gradeTextColor,
  isFail,
  mixHex,
  pctBarColor,
  rttiPctCellColor,
  sdCellColor,
} from '../../src/domain/grade-colors';

describe('isFail', () => {
  it('passes from 5,5 after rounding to one decimal', () => {
    expect(isFail(5.44)).toBe(true);
    expect(isFail(5.45)).toBe(false);
    expect(isFail(5.5)).toBe(false);
    expect(isFail(1)).toBe(true);
  });
});

describe('mixHex', () => {
  it('mixes linearly and clamps', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff');
  });
});

describe('grade colours (design spec 2.3)', () => {
  it('bar: fail red, pass yellow to green over 5,5..9,5', () => {
    expect(gradeBarColor(4)).toBe(GRADE_BAR.fail);
    expect(gradeBarColor(5.5)).toBe(GRADE_BAR.passLow);
    expect(gradeBarColor(9.5)).toBe(GRADE_BAR.passHigh);
    expect(gradeBarColor(10)).toBe(GRADE_BAR.passHigh);
    expect(gradeBarColor(7.5)).toBe(mixHex(GRADE_BAR.passLow, GRADE_BAR.passHigh, 0.5));
    expect(gradeBarColor(null)).toBe(GRADE_BAR.none);
  });

  it('text: theme tokens, mixed for passing grades', () => {
    expect(gradeTextColor(5.4)).toBe('var(--grade-fail-text)');
    expect(gradeTextColor(null)).toBe('var(--grade-none-text)');
    expect(gradeTextColor(5.5)).toBe(
      'color-mix(in srgb, var(--grade-pass-hi-text) 0%, var(--grade-pass-lo-text))',
    );
    expect(gradeTextColor(7.5)).toBe(
      'color-mix(in srgb, var(--grade-pass-hi-text) 50%, var(--grade-pass-lo-text))',
    );
    expect(gradeTextColor(9.9)).toContain(' 100%,');
  });

  it('score-grid cell: spec fills', () => {
    expect(gradeCellColor(4)).toBe('#f7cfca');
    expect(gradeCellColor(5.5)).toBe('#fbe7a6');
    expect(gradeCellColor(7.5)).toBe('#e3edb4');
    expect(gradeCellColor(9.5)).toBe('#c6e8cf');
    expect(gradeCellColor(null)).toBeNull();
    expect(gradeCellColor(Number.NaN)).toBeNull();
  });

  it('percentages: red, yellow, green', () => {
    expect(pctBarColor(0)).toBe(GRADE_BAR.fail);
    expect(pctBarColor(50)).toBe(GRADE_BAR.passLow);
    expect(pctBarColor(100)).toBe(GRADE_BAR.passHigh);
    expect(pctBarColor(null)).toBe(GRADE_BAR.none);
  });

  it('score-grid statistics cells keep their pastel scale', () => {
    expect(sdCellColor(0)).toBe('#c3e6cb');
    expect(sdCellColor(1)).toBe('#fff3cd');
    expect(sdCellColor(3)).toBe('#f8d7da');
    expect(rttiPctCellColor(0)).toBe('#f8d7da');
    expect(rttiPctCellColor(100)).toBe('#c3e6cb');
    expect(rttiPctCellColor(null)).toBeNull();
  });
});
