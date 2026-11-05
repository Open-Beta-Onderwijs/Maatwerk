// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatFixed,
  formatGrade,
  formatNumber,
  parseDecimal,
  parseDecimalLoose,
} from '../../src/domain/format';

describe('formatGrade', () => {
  it('always shows one decimal with a comma', () => {
    expect(formatGrade(7)).toBe('7,0');
    expect(formatGrade(4)).toBe('4,0');
    expect(formatGrade(6.44)).toBe('6,4');
    expect(formatGrade(10)).toBe('10,0');
    expect(formatGrade(1)).toBe('1,0');
  });

  it('rounds the product, as the grade system does (quirk B8)', () => {
    // 5.45 * 10 = 54.5 rounds up to 55; see formatFixed below for 1.15,
    // where the two paths differ.
    expect(formatGrade(5.45)).toBe('5,5');
    expect(formatGrade(5.449)).toBe('5,4');
  });

  it('shows a dash for no grade', () => {
    expect(formatGrade(null)).toBe('—');
    expect(formatGrade(undefined)).toBe('—');
    expect(formatGrade(Number.NaN)).toBe('—');
  });
});

describe('formatFixed', () => {
  it('uses toFixed rounding and a comma', () => {
    expect(formatFixed(6.25)).toBe('6,3');
    expect(formatFixed(1.005, 2)).toBe('1,00'); // binary value below 1.005
    expect(formatFixed(3, 0)).toBe('3');
    expect(formatFixed(0.5, 1)).toBe('0,5');
  });

  it('differs from formatGrade only at binary x.x5 cases (B8, kept until step 19)', () => {
    expect(formatFixed(5.45)).toBe('5,5');
    expect(formatGrade(1.15)).toBe('1,2');
    expect(formatFixed(1.15)).toBe('1,1');
  });
});

describe('formatNumber and formatCompact', () => {
  it('writes stored values as they are, with a comma', () => {
    expect(formatNumber(0.5)).toBe('0,5');
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber('1.25')).toBe('1,25');
  });

  it('formatCompact drops the decimal of whole numbers', () => {
    expect(formatCompact(2)).toBe('2');
    expect(formatCompact(1.5)).toBe('1,5');
    expect(formatCompact(1.25)).toBe('1,3');
  });
});

describe('parseDecimal', () => {
  it('reads a comma or a dot', () => {
    expect(parseDecimal('7,5')).toBe(7.5);
    expect(parseDecimal(' 7.5 ')).toBe(7.5);
    expect(parseDecimal('7,5 p')).toBeNaN();
  });

  it('parseDecimalLoose reads the leading number', () => {
    expect(parseDecimalLoose('7,5 p')).toBe(7.5);
    expect(parseDecimalLoose('67%')).toBe(67);
    expect(parseDecimalLoose('—')).toBeNaN();
  });
});
