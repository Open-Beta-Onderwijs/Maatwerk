// SPDX-License-Identifier: AGPL-3.0-or-later

// The Toetsen card numbers built in chunks with the batch calls equal the old path: one
// examResults and one bestAttempt per student (review 33b m5).

import { describe, expect, it } from 'vitest';
import { bestAttempt } from '../../domain/attempts';
import { examResults } from '../../domain/grades';
import { setRubricLookup } from '../../domain/po';
import { newRubric, type RubricCategory } from '../../domain/rubric';
import type { Exam, ScoreRecord } from '../../domain/types';
import { addRecords, countObs, newBlock, obsOf, type BlockNumbers } from './block-numbers';

const questions = [
  { id: 'q1', max_points: 10, rtti: 'R' },
  { id: 'q2', max_points: 10, rtti: 'T1' },
  { id: 'q3', max_points: 10, rtti: 'I' },
];
const test = (id: string, extra: Partial<Exam> = {}) =>
  ({ id, subject: 'nat', n_term: 1, questions, ...extra }) as Exam;
const original = test('e');
const herkansing = test('h', { parent_id: 'e', attempt: 2, n_term: 1.5 } as Partial<Exam>);
const inhaal = test('i', { parent_id: 'e', attempt: 3 } as Partial<Exam>);

const rubric = newRubric('nat', {
  id: 'r1',
  categories: [
    { id: 'c1', max: 50, soort: 'normaal' },
    { id: 'c2', max: 20, soort: 'normaal' },
  ] as RubricCategory[],
});
setRubricLookup((id) => (id === 'r1' ? rubric : undefined));
const po = {
  id: 'p',
  subject: 'nat',
  kind: 'po',
  rubric_id: 'r1',
  questions: [],
} as unknown as Exam;
const poResit = { ...po, id: 'p2', parent_id: 'p', attempt: 2 } as unknown as Exam;

/** Synthetic students: every mix of nothing, scores, 'N', overrides, damage, observaties. */
function records(): (ScoreRecord | null)[] {
  const out: (ScoreRecord | null)[] = [null];
  for (let i = 0; i < 130; i++) {
    // Loose on purpose: damaged values are part of the mix.
    const r: {
      student_id: string;
      scores: Record<string, unknown>;
      observations: Record<string, string[]>;
      overrides?: Record<string, unknown>;
      po?: Record<string, unknown>;
    } = { student_id: String(900000 + i), scores: {}, observations: {} };
    if (i % 5 !== 0) r.scores.e = { q1: i % 11, q2: i % 3 === 0 ? null : (i * 7) % 11, q3: 4 };
    if (i % 4 === 1) r.scores.h = { q1: (i * 3) % 11, q3: 9 };
    if (i % 9 === 2) r.scores.i = { q2: 8 };
    if (i % 13 === 3)
      r.overrides = { e: { cijfer: 6.3 }, ...(i % 2 ? { h: { cijfer: 7.1 } } : {}) };
    if (i % 17 === 4) r.scores.e = { gone: 5 };
    if (i % 3 === 0) r.observations.e = ['o1', i % 2 ? 'o2' : 'o1'];
    if (i % 7 === 0) r.observations.h = ['o3'];
    if (i % 6 !== 5) r.scores.p = { c1: (i * 5) % 51, c2: i % 21 };
    if (i % 8 === 6) r.scores.p2 = { c1: 45, c2: 18 };
    if (i % 10 === 7)
      r.po = {
        p: {
          groupLines: [{ label: 'Te laat', value: -0.5 }],
          ownLines: [],
          categoryObs: { c1: ['o5'] },
        },
      };
    if (i % 10 === 7) r.observations.p = ['o4'];
    out.push(r as unknown as ScoreRecord);
  }
  return out;
}

/** The numbers as before 0.24.1: one student at a time, single calls. */
function oneByOne(recs: (ScoreRecord | null)[], orig: Exam, resits: Exam[]): BlockNumbers {
  const attempts = [orig, ...resits];
  const block = newBlock(attempts);
  for (const rec of recs) {
    for (const a of attempts) {
      const nums = block.per.get(a.id)!;
      const res = examResults(rec, a);
      if (res && res.grade !== null) nums.grades.push(res.grade);
      countObs(nums, obsOf(rec, a));
    }
    if (!resits.length) continue;
    const best = bestAttempt(rec, attempts);
    if (best) block.summary.grades.push(best.grade);
    countObs(block.summary, best ? obsOf(rec, best.exam) : attempts.flatMap((a) => obsOf(rec, a)));
  }
  return block;
}

function inChunks(recs: (ScoreRecord | null)[], orig: Exam, resits: Exam[], size: number) {
  const block = newBlock([orig, ...resits]);
  for (let i = 0; i < recs.length; i += size)
    addRecords(block, recs.slice(i, i + size), orig, resits);
  return block;
}

describe('Toetsen card numbers in chunks', () => {
  const recs = records();

  it('equal the old path for a stack (Verzamelkaart included)', () => {
    const want = oneByOne(recs, original, [herkansing, inhaal]);
    expect(want.summary.grades.length).toBeGreaterThan(50); // the fixture exercises something
    for (const size of [1, 7, 60, 500])
      expect(inChunks(recs, original, [herkansing, inhaal], size)).toEqual(want);
  });

  it('equal the old path for a solo test', () => {
    expect(inChunks(recs, original, [], 60)).toEqual(oneByOne(recs, original, []));
  });

  it('equal the old path for a PO and its resit (rubric, po lines, category observaties)', () => {
    const want = oneByOne(recs, po, [poResit]);
    expect(want.per.get('p')!.grades.length).toBeGreaterThan(50);
    expect(inChunks(recs, po, [poResit], 60)).toEqual(want);
  });
});
