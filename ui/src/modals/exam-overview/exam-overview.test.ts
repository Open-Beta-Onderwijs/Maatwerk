// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

// The Store is only needed by data.ts's loader; these tests use the pure parts.
vi.mock('../../store.js', () => ({ Store: {} }));

import type { Exam, ScoreRecord, Student } from '../../domain/types';
import { groupColor } from './charts';
import { verloopPoints } from './rtti-obs';

const exam = (fields: Partial<Exam>): Exam => ({
  id: 'x',
  subject: 'nat',
  jaarlaag: '3',
  n_term: 1,
  questions: [
    { id: 'q1', max_points: 10, rtti: 'R' },
    { id: 'q2', max_points: 10, rtti: 'T1' },
  ],
  ...fields,
});

describe('RTTI-verloop of the exam overview (decisions 32, 36)', () => {
  it('takes the originals of the jaarlaag by volgnummer, without PO’s', async () => {
    const exams = [
      exam({ id: 'b', volgnummer: 302 }),
      exam({ id: 'a', volgnummer: 301 }),
      exam({ id: 'a-h', volgnummer: 301, parent_id: 'a', description: 'HERKANSING' }),
      exam({ id: 'p', volgnummer: 309, kind: 'po', questions: [] }),
      exam({ id: 'c', volgnummer: 401, jaarlaag: '4' }),
      exam({ id: 'e', volgnummer: 303 }),
    ];
    const recs: Record<string, ScoreRecord> = {
      '1': { scores: { a: { q1: 5, q2: 10 }, b: { q1: 10 }, 'a-h': { q1: 10 } } },
      '2': { scores: { a: { q1: 10, q2: 0 } } },
    };
    const students: Student[] = [{ id: '1' }, { id: '2' }];
    const points = await verloopPoints(exams, '3', students, async (s) => recs[s.id] ?? null);
    // 303 has no scores: left out.
    expect(points.map((p) => p.exam.id)).toEqual(['a', 'b']);
    expect(points[0]!.pcts).toEqual([75, 50, null, null]);
    expect(points[1]!.pcts).toEqual([100, null, null, null]);
  });
});

describe('group colours', () => {
  it('is the accent for the first group, lighter for each next one', () => {
    expect(groupColor(0, 1)).toBe('color-mix(in srgb, var(--accent) 100%, var(--surface))');
    expect(groupColor(0, 3)).toContain('100%');
    expect(groupColor(2, 3)).toContain('45%');
  });
});
