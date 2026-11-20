// SPDX-License-Identifier: AGPL-3.0-or-later

// The batch grade calls and the skip of empty records (perf hotfix 0.24.1): the same answers as
// one call per student, with fewer trips into the grade rules.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from './core';
import { bestAttempt, bestAttemptMany } from './attempts';
import { examResults, examResultsMany, hasGradeData, recordFor } from './grades';
import { forGrading, setRubricLookup } from './po';
import { newRubric, type RubricCategory } from './rubric';
import type { Exam, ScoreRecord } from './types';

vi.mock('./core', async (importOriginal) => {
  const real = await importOriginal<typeof import('./core')>();
  return { ...real, coreCall: vi.fn(real.coreCall) };
});
const coreCall = vi.mocked(core.coreCall);

const exam = (id: string, extra: Partial<Exam> = {}): Exam =>
  ({
    id,
    n_term: 1,
    questions: [
      { id: 'q1', max_points: 10, rtti: 'R' },
      { id: 'q2', max_points: 10, rtti: 'T1' },
      { id: 'q3', max_points: 10, rtti: 'I' },
    ],
    ...extra,
  }) as Exam;

const original = exam('e');
const resit = exam('h', { parent_id: 'e', attempt: 2 } as Partial<Exam>);
const records = [
  null,
  undefined,
  { student_id: '1', scores: {} },
  { student_id: '2', scores: { e: {} } },
  { student_id: '3', scores: { e: { q1: 8, q2: null } } },
  { student_id: '4', scores: { e: { gone: 5 } }, overrides: { h: { cijfer: 6.5 } } },
  { student_id: '5', scores: { e: { q1: 2 }, h: { q1: 9, q3: 4 } } },
  { student_id: '6', scores: { other: { q1: 9 } } },
] as unknown as (ScoreRecord | null | undefined)[];

beforeEach(() => {
  coreCall.mockClear();
});

describe('examResults and bestAttempt skip records without data', () => {
  it('answers null without calling the rules', () => {
    for (const rec of [null, undefined, records[2], records[3], records[7]]) {
      expect(examResults(rec, original)).toBeNull();
      expect(bestAttempt(rec, [original, resit])).toBeNull();
    }
    expect(coreCall).not.toHaveBeenCalled();
  });

  it('still asks the rules when there is a score or an override', () => {
    expect(examResults(records[4], original)?.grade).toBeTypeOf('number');
    expect(bestAttempt(records[5], [original, resit])?.exam.id).toBe('h');
    expect(coreCall).toHaveBeenCalledTimes(2);
  });
});

describe('examResultsMany', () => {
  it('answers per record and exam as examResults', () => {
    const many = examResultsMany(records, [original, resit]);
    records.forEach((rec, i) => {
      expect(many[i]).toEqual([examResults(rec, original), examResults(rec, resit)]);
    });
  });

  it('is one call into the rules, with only the records that have data', () => {
    examResultsMany(records, [original, resit]);
    expect(coreCall).toHaveBeenCalledTimes(1);
    const [name, sent] = coreCall.mock.calls[0]!;
    expect(name).toBe('examResultsMany');
    expect(sent).toHaveLength(3);
  });

  it('makes no call when no record has data', () => {
    expect(examResultsMany([null, records[7]], [original])).toEqual([[null], [null]]);
    expect(coreCall).not.toHaveBeenCalled();
  });
});

describe('bestAttemptMany', () => {
  it('answers per record as bestAttempt', () => {
    const many = bestAttemptMany(records, [original, resit]);
    records.forEach((rec, i) => {
      const one = bestAttempt(rec, [original, resit]);
      expect(many[i]).toEqual(one ? { exam: one.exam, grade: one.grade } : null);
    });
  });

  it('is one call into the rules', () => {
    bestAttemptMany(records, [original, resit]);
    expect(coreCall).toHaveBeenCalledTimes(1);
    expect(coreCall.mock.calls[0]![0]).toBe('bestAttemptMany');
  });
});

describe('the skip is safe: the rules answer null for every record JS skips (review 33b m5)', () => {
  const rubric = newRubric('nat', {
    id: 'r1',
    categories: [{ id: 'c1', max: 50, soort: 'normaal' }] as RubricCategory[],
  });
  setRubricLookup((id) => (id === 'r1' ? rubric : undefined));
  const po = {
    id: 'p',
    subject: 'nat',
    kind: 'po',
    rubric_id: 'r1',
    questions: [],
  } as unknown as Exam;
  const lines = { groupLines: [{ label: 'Te laat', value: -0.5 }], ownLines: [] };
  const edge = (id: string): unknown[] => [
    null,
    {},
    { scores: null },
    { scores: { [id]: {} } },
    { scores: { [id]: 'x' } },
    { scores: { [id]: [] } },
    { scores: { [id]: null } },
    { scores: { other: { q1: 5 } } },
    { overrides: {} },
    { overrides: { other: { cijfer: 7 } } },
    { po: { [id]: lines } }, // a PO with only bonus/malus lines
    { observations: { [id]: ['o1'] } },
  ];

  for (const exam of [original, po]) {
    it(`for ${exam.id === 'p' ? 'a PO' : 'a test'}`, () => {
      for (const rec of edge(exam.id) as (ScoreRecord | null)[]) {
        expect(hasGradeData(rec, exam.id)).toBe(false);
        const rules = core.coreCall('examResults', recordFor(rec, [exam]), forGrading(exam));
        expect(rules, JSON.stringify(rec)).toBeNull();
      }
    });
  }

  it('the rules do give a grade once there is a score or an override', () => {
    for (const rec of [
      { scores: { e: { q1: 5 } } },
      { overrides: { e: { cijfer: 6 } } },
    ] as unknown as ScoreRecord[]) {
      expect(hasGradeData(rec, 'e')).toBe(true);
      expect(examResults(rec, original)?.grade).toBeTypeOf('number');
    }
  });
});
