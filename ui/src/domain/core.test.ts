// SPDX-License-Identifier: AGPL-3.0-or-later

// The WebAssembly build gives the same answers as the rules' own tests in Rust (ADR-0011). The
// rules themselves are tested in crates/maatwerk-grades; this checks the way there and back.

import { describe, expect, it } from 'vitest';
import { clean, coreCall, isFail, round0, round1 } from './core';

const exam = {
  id: 'e',
  n_term: 1,
  questions: [
    { id: 'q1', max_points: 10, rtti: 'R' },
    { id: 'q2', max_points: 10, rtti: 'T1' },
    { id: 'q3', max_points: 10, rtti: 'T2' },
    { id: 'q4', max_points: 10, rtti: 'I' },
  ],
};

describe('rounding', () => {
  it('rounds exact halves up, also when the double is just below', () => {
    expect(round1(8.649999999999999)).toBe(8.7);
    expect(round1(6.35)).toBe(6.4);
    expect(round1(5.45)).toBe(5.5);
    expect(round0(78.5)).toBe(79);
  });

  it('removes noise from totals', () => {
    expect(clean(0.1 + 0.2)).toBe(0.3);
  });

  it('fails below 5,5 after rounding', () => {
    expect(isFail(5.44)).toBe(true);
    expect(isFail(5.45)).toBe(false);
  });
});

describe('coreCall', () => {
  it('calculates results with an undefined override', () => {
    const res = coreCall<Record<string, unknown>>(
      'calcResults',
      exam,
      { q1: 8, q2: 6, q3: 'N' },
      undefined,
    );
    expect(res).toMatchObject({
      scored: 14,
      normalMax: 40,
      grade: 4.2,
      R: 80,
      T1: 60,
      T2: 0,
      I: 'NVT',
      overridden: false,
    });
  });

  it('answers the approved best-attempt question', () => {
    const resit = { ...exam, id: 'h', parent_id: 'e', attempt: 2 };
    const rec = { overrides: { e: { cijfer: 4.8 }, h: { cijfer: 6.2 } } };
    expect(coreCall('bestAttempt', rec, [exam, resit])).toEqual({ examId: 'h', grade: 6.2 });
  });

  it('passes the unicode label through', () => {
    expect(coreCall<string[]>('gradeGroupLabels')[5]).toBe('≥8');
  });

  it('survives many calls and big arguments', () => {
    const big = { ...exam, note: 'x'.repeat(200_000) };
    for (let i = 0; i < 200; i++) {
      expect(coreCall<{ grade: number }>('calcResults', big, { q1: 8 }, null).grade).toBe(2.8);
    }
  });

  it('throws on an unknown function and on bad arguments', () => {
    expect(() => coreCall('nope')).toThrow(/unknown function/);
    expect(() => coreCall('calcGrade', 1)).toThrow(/bad arguments/);
  });
});
