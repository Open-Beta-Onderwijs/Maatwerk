// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { calcGrade, calcResults, examResults } from '../../src/domain/grades';
import type { Exam, Override, QuestionScores, ScoreRecord } from '../../src/domain/types';
import { goldenCase, inputOf, loadGolden, run } from '../golden';

const golden = loadGolden('grades');

describe('grades golden', () => {
  it('calcGrade-sweep', () => {
    const rows = goldenCase(golden, 'calcGrade-sweep').output as number[][];
    for (const [scored, max, n, grade] of rows) {
      expect(calcGrade(scored!, max!, n!), `${scored}/${max} n=${n}`).toBe(grade);
    }
  });

  for (const c of golden.cases.filter((x) => x.id !== 'calcGrade-sweep')) {
    it(`${c.id} (${c.rule})`, async () => {
      if (c.id.startsWith('examResults-')) {
        const { exam, rec } = inputOf<{ exam: Exam; rec: ScoreRecord | null }>(c);
        expect(await run(() => examResults(rec, exam))).toEqual(c.output);
      } else {
        const { exam, scores, override } = inputOf<{
          exam: Exam;
          scores: QuestionScores;
          override?: Override;
        }>(c);
        expect(await run(() => calcResults(exam, scores, override))).toEqual(c.output);
      }
    });
  }
});
