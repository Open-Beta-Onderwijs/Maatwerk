// SPDX-License-Identifier: AGPL-3.0-or-later

// The score lock as the core has it (`maatwerk-core/src/rights/tests.rs`, same cases).

import { describe, expect, it } from 'vitest';
import {
  bestuurOf,
  changedExams,
  ownStudentIds,
  scoreFile,
  teacherMayWrite,
  type ExamLike,
  type ScoreWriteContext,
} from './rights';

const exams: Record<string, ExamLike> = {
  t1: { kind: 'toets', obs_ids: ['o1', 'o2'] },
  p1: {
    kind: 'po',
    projectgroepen: [
      { id: 'g1', student_ids: ['1', '3'] },
      { id: 'g2', student_ids: ['4'] },
    ],
  },
  p2: { kind: 'po', projectgroepen: [{ id: 'h1', student_ids: ['3', '4'] }] },
};

function ctx(records: Record<string, Record<string, unknown>> = {}): ScoreWriteContext {
  return {
    own: new Set(['1', '2']),
    exam: (id) => exams[id] ?? null,
    record: (id) => records[id] ?? null,
  };
}

describe('rights', () => {
  it('finds the own students of a vak and the bestuur', () => {
    const groups = [
      { subject: 'nat', docenten: ['a'], student_ids: [1, '2'] },
      { subject: 'nat', docenten: ['b'], student_ids: ['3'] },
      { subject: 'bio', docenten: ['a'], student_ids: ['4'] },
    ];
    expect([...ownStudentIds(groups, 'nat', 'a')]).toEqual(['1', '2']);
    expect(bestuurOf({ secties: { nat: { voorzitter: 'v', secretaris: 's' } } }, 'nat')).toEqual([
      'v',
      's',
    ]);
    expect(bestuurOf({}, 'nat')).toEqual([]);
  });

  it('recognises score paths', () => {
    expect(scoreFile('2025-2026/scores/nat/900001.json')).toEqual(['2025-2026', 'nat', '900001']);
    expect(scoreFile('2025-2026/exams/t1.json')).toBeNull();
  });

  it('lists changes per exam, ignoring bookkeeping and key order', () => {
    expect([
      ...changedExams(
        { scores: { t1: { a: 1, b: 2 } } },
        { scores: { t1: { b: 2, a: 1 } }, _meta: {} },
      ),
    ]).toEqual([]);
    expect([...changedExams(null, { scores: { t1: {} }, extra: 1 })].sort()).toEqual(['*', 't1']);
  });

  it('lets a teacher change own students only', () => {
    const next = { scores: { t1: { q1: 3 } } };
    expect(teacherMayWrite('1', null, next, ctx())).toBe(true);
    expect(teacherMayWrite('3', null, next, ctx())).toBe(false);
    expect(teacherMayWrite('3', { a: 1 }, { a: 1 }, ctx())).toBe(true);
  });

  it('allows dropping observaties the exam no longer lists', () => {
    const old = { observations: { t1: ['o1', 'o9'] } };
    expect(teacherMayWrite('3', old, { observations: { t1: ['o1'] } }, ctx())).toBe(true);
    expect(teacherMayWrite('3', old, { observations: { t1: ['o9'] } }, ctx())).toBe(false);
  });

  it('grades a projectgroep with an own student, never foreign own lines', () => {
    const graded = { scores: { p1: { c1: 4 } }, po: { p1: { projectgroep: 'g1' } } };
    expect(teacherMayWrite('3', null, graded, ctx())).toBe(true);
    expect(
      teacherMayWrite(
        '4',
        null,
        { scores: { p1: { c1: 4 } }, po: { p1: { projectgroep: 'g2' } } },
        ctx(),
      ),
    ).toBe(false);
    const lines = { po: { p1: { projectgroep: 'g1', ownLines: [{ label: 'x', value: 1 }] } } };
    expect(teacherMayWrite('3', { po: { p1: { projectgroep: 'g1' } } }, lines, ctx())).toBe(false);
  });

  it('allows a move that copies a staying member’s grading', () => {
    const records = {
      '3': {
        scores: { p2: { c1: 2 } },
        po: { p2: { projectgroep: 'h1', comment: 'ok', categoryObs: {} } },
      },
    };
    const old = { po: { p2: { projectgroep: 'old' } } };
    const moved = { scores: { p2: { c1: 2 } }, po: { p2: { projectgroep: 'h1', comment: 'ok' } } };
    expect(teacherMayWrite('4', old, moved, ctx(records))).toBe(true);
    const other = { scores: { p2: { c1: 5 } }, po: { p2: { projectgroep: 'h1', comment: 'ok' } } };
    expect(teacherMayWrite('4', old, other, ctx(records))).toBe(false);
    expect(teacherMayWrite('4', moved, other, ctx(records))).toBe(false);
  });
});
