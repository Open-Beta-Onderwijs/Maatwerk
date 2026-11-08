// SPDX-License-Identifier: AGPL-3.0-or-later

// The way to the Rust rules and back (ADR-0011), on the reference's goldens. The rules are tested
// in crates/maatwerk-grades; the differences below are the user's decisions
// (docs/phase-2/step-19-grade-rules.md section 6).

import { describe, expect, it } from 'vitest';
import { clean, round1 } from '../../src/domain/core';
import { calcGrade, calcResults, examResults } from '../../src/domain/grades';
import type { Exam, Override, QuestionScores, ScoreRecord } from '../../src/domain/types';
import { goldenCase, inputOf, loadGolden, run } from '../golden';

const golden = loadGolden('grades');

interface Golden {
  scored: number;
  normalMax: number;
  bonusMax: number;
  examMaxTotal: number;
  grade: number | null;
  calculatedGrade: number | null;
}

/** The reference's result as the decisions make it: rounded grades, clean totals. */
function decided(output: unknown): unknown {
  if (output === null) return null;
  const o = output as Golden;
  const grade = (g: number | null) => (g === null ? null : round1(g));
  return {
    ...o,
    scored: clean(o.scored),
    normalMax: clean(o.normalMax),
    bonusMax: clean(o.bonusMax),
    examMaxTotal: clean(o.examMaxTotal),
    grade: grade(o.grade),
    calculatedGrade: grade(o.calculatedGrade),
  };
}

/** Without the points per category, which the reference did not return. */
function comparable(result: unknown): unknown {
  if (result === null) return null;
  const { rttiPoints: _points, ...rest } = result as { rttiPoints: unknown };
  return rest;
}

describe('grades golden', () => {
  it('calcGrade-sweep', () => {
    const rows = goldenCase(golden, 'calcGrade-sweep').output as number[][];
    for (const [scored, max, n, grade] of rows) {
      expect(calcGrade(scored!, max!, n!), `${scored}/${max} n=${n}`).toBeCloseTo(grade!, 9);
    }
  });

  for (const c of golden.cases.filter((x) => x.id !== 'calcGrade-sweep')) {
    it(`${c.id} (${c.rule})`, async () => {
      const result = await run(() => {
        if (c.id.startsWith('examResults-')) {
          const { exam, rec } = inputOf<{ exam: Exam; rec: ScoreRecord | null }>(c);
          return comparable(examResults(rec, exam));
        }
        const { exam, scores, override } = inputOf<{
          exam: Exam;
          scores: QuestionScores;
          override?: Override;
        }>(c);
        return comparable(calcResults(exam, scores, override));
      });
      if (c.id === 'unknown-rtti-tag') {
        // Decision 18: the reference crashed on this. The question counts in the grade only.
        expect(result).toMatchObject({ scored: 2, normalMax: 4, R: 50, T1: 'NVT' });
      } else {
        expect(result).toEqual(decided(c.output));
      }
    });
  }
});
