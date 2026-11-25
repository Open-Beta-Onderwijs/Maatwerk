// SPDX-License-Identifier: AGPL-3.0-or-later

// The card model from the Rust numbers (step 38). The numbers themselves are tested in Rust
// (maatwerk_core::numbers) and against the UI path by tools/numbers-parity.mjs.

import { describe, expect, it } from 'vitest';
import { isUpperSchool, studentCard } from './cards';
import type { Formats, Shown, StudentNumbers } from './numbers';
import type { Exam } from './types';

const A1 = { methode: 'afronden', decimalen: 1 } as const;
const K0 = { methode: 'afkappen', decimalen: 0 } as const;
const FORMATS: Formats = { r: K0, se: A1 };

const shown = (raw: number, value: number): Shown => ({ raw, shown: value, fails: value < 5.5 });

const EXAMS = [
  { id: 'a', title: 'Krachten', volgnummer: 1 },
  { id: 'd', title: 'Diagnose', volgnummer: 2 },
] as Exam[];

const NUMBERS: StudentNumbers = {
  upper: false,
  results: { a: 6.4, d: 9.1 },
  bars: [
    { examId: 'a', grade: 6.4, diagnostic: false },
    { examId: 'd', grade: 9.1, diagnostic: true },
  ],
  average: shown(5.9, 5),
  trend: { last: 6.4, average: 5.9, d: 0.5, level: 'slightUp' },
  se: shown(6.84, 6.8),
};

describe('student card from the Rust numbers (F-07, F-08, step 38)', () => {
  it('names the bars after the exams and keeps the shown average with its format', () => {
    const c = studentCard(NUMBERS, EXAMS, FORMATS);
    expect(c.bars).toEqual([
      { grade: 6.4, title: '1 · Krachten: 6,4', diagnostic: false },
      { grade: 9.1, title: '2 · Diagnose: 9,1', diagnostic: true },
    ]);
    expect(c.average).toEqual({ value: 5, fails: true, fmt: K0 });
    expect(c.last).toBe(6.4);
    expect(c.trend?.level).toBe('slightUp');
  });

  it('shows the SE only in years 4-6 (the core also has it for other reasons)', () => {
    expect(studentCard(NUMBERS, EXAMS, FORMATS).se).toBeNull();
    expect(studentCard({ ...NUMBERS, upper: true }, EXAMS, FORMATS).se).toEqual({
      value: 6.8,
      fails: false,
      fmt: A1,
    });
  });

  it('a student without numbers has an empty card', () => {
    expect(studentCard(undefined, EXAMS, FORMATS)).toEqual({
      bars: [],
      average: null,
      last: null,
      trend: null,
      se: null,
    });
  });

  it('years 4 to 6 are upper school', () => {
    expect(['1', '3', '4', '6', 7, null].map(isUpperSchool)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});
