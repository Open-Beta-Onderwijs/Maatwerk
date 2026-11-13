// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { groupCardNumbers, isUpperSchool, studentCardNumbers } from './cards';
import type { Exam, ScoreRecord } from './types';

function exam(id: string, nr: number, fields: Partial<Exam> = {}): Exam {
  return {
    id,
    title: `Toets ${nr}`,
    volgnummer: nr,
    weging: 1,
    n_term: 1,
    questions: [{ id: 'q1', max_points: 10, rtti: 'T1' }],
    ...fields,
  } as Exam;
}

/** Grades as overrides (cijfer), the simplest record. */
function rec(grades: Record<string, number>): ScoreRecord {
  return {
    overrides: Object.fromEntries(Object.entries(grades).map(([id, g]) => [id, { cijfer: g }])),
  } as ScoreRecord;
}

describe('student card numbers (F-07, F-08)', () => {
  // The approved example of decision 13: 6,0 (w1), 7,0 (w1), 8,0 (w2).
  const EXAMS = [exam('a', 1), exam('b', 2), exam('c', 3, { weging: 2 })];

  it('bars in volgnummer order, the year average, last grade and trend', () => {
    const n = studentCardNumbers([EXAMS[2]!, EXAMS[0]!, EXAMS[1]!], rec({ a: 6, b: 7, c: 8 }));
    expect(n.bars.map((b) => b.grade)).toEqual([6, 7, 8]);
    expect(n.bars[0]?.title).toBe('1 · Toets 1: 6,0');
    expect(n.average).toBe(7.3);
    expect(n.last).toBe(8);
    expect(n.trend?.level).toBe('slightUp');
    expect(n.se).toBeNull();
  });

  it('one bar per test: the best attempt of a test and its resit', () => {
    const resit = exam('a2', 1, { parent_id: 'a', attempt: 2 });
    const n = studentCardNumbers([EXAMS[0]!, resit], rec({ a: 4, a2: 6.5 }));
    expect(n.bars.map((b) => b.grade)).toEqual([6.5]);
    expect(n.average).toBe(6.5);
  });

  it('a diagnostic test is a grey bar and counts for nothing', () => {
    const diag = exam('d', 4, { diagnostic: true, weging: 0 });
    const n = studentCardNumbers([EXAMS[0]!, diag], rec({ a: 6, d: 9 }));
    expect(n.bars.map((b) => [b.grade, b.diagnostic])).toEqual([
      [6, false],
      [9, true],
    ]);
    expect(n.average).toBe(6);
    expect(n.last).toBe(6);
  });

  it('no grades: no bars, no numbers', () => {
    const n = studentCardNumbers(EXAMS, rec({}));
    expect(n).toEqual({ bars: [], average: null, last: null, trend: null, se: null });
  });

  it('the SE average over all years (upper school)', () => {
    const pta = exam('p', 1, {
      type: 'pta',
      weging: 2,
      academic_year: '2025-2026',
    } as Partial<Exam>);
    const n = studentCardNumbers([pta], rec({ p: 6.84 }), {
      history: [{ exam: pta, questionScores: {}, override: { cijfer: 6.84 } }],
      allExams: [pta],
    });
    expect(n.se).toBe(6.8);
  });
});

describe('group card numbers (F-09)', () => {
  it('mean, SD and % onvoldoende of the year averages; SE only upstairs', () => {
    const members = [
      { year: 5.0, se: 6.0 },
      { year: 7.0, se: 7.0 },
      { year: null, se: null },
    ];
    const lower = groupCardNumbers(members, false);
    expect(lower.year).toMatchObject({ n: 2, mean: 6, fails: 50 });
    expect(lower.se).toBeNull();
    expect(groupCardNumbers(members, true).se).toMatchObject({ n: 2, mean: 6.5, fails: 0 });
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
