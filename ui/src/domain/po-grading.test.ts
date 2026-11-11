// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  clearGrading,
  emptyGrading,
  gradedGroupOf,
  gradingKey,
  gradingOf,
  gradingStatus,
  groupSource,
  isEmptyGrading,
  ownLinesOf,
  parseLineValue,
  signedPoints,
  writeGrading,
  type GroupGrading,
} from './po-grading';
import type { Rubric } from './rubric';
import type { ScoreRecord } from './types';

const rubric = {
  categories: [
    { id: 'a', naam: 'A', max: 4, soort: 'normaal' },
    { id: 'b', naam: 'B', max: 4, soort: 'normaal' },
    { id: 'x', naam: 'X', max: 2, soort: 'bonus' },
    { id: 'd', naam: 'D', max: 2, soort: 'diagnostisch' },
  ],
} as unknown as Rubric;

const graded = (): GroupGrading => ({
  scores: { a: 3, b: 2 },
  observations: ['o1'],
  categoryObs: { a: ['o2'], b: [] },
  categoryComments: { a: 'Goed', b: '  ' },
  comment: 'Netjes',
  groupLines: [{ label: 'Te laat', value: -0.5 }],
});

describe('PO grading in a score file (step 23, decision 19)', () => {
  it('writes the group grading and keeps own lines and other exams', () => {
    const rec: ScoreRecord = {
      scores: { t1: { q1: 2 } },
      po: { p: { projectgroep: 'old', ownLines: [{ label: 'Extra', value: 1 }] } },
    };
    writeGrading(rec, 'p', 'g1', graded());
    expect(rec.scores).toEqual({ t1: { q1: 2 }, p: { a: 3, b: 2 } });
    expect(rec.observations).toEqual({ p: ['o1'] });
    expect(rec.po?.p).toEqual({
      projectgroep: 'g1',
      categoryObs: { a: ['o2'] },
      categoryComments: { a: 'Goed' },
      comment: 'Netjes',
      groupLines: [{ label: 'Te laat', value: -0.5 }],
      ownLines: [{ label: 'Extra', value: 1 }],
    });
    expect(gradingKey(gradingOf(rec, 'p'))).toBe(gradingKey(graded()));
    expect(ownLinesOf(rec, 'p')).toEqual([{ label: 'Extra', value: 1 }]);
    expect(gradedGroupOf(rec, 'p')).toBe('g1');
  });

  it('own lines can be set; an empty grading without own lines removes the entries', () => {
    const rec: ScoreRecord = {};
    writeGrading(rec, 'p', 'g1', graded(), [{ label: 'Hulp', value: -1 }]);
    expect(ownLinesOf(rec, 'p')).toEqual([{ label: 'Hulp', value: -1 }]);
    clearGrading(rec, 'p', 'g2');
    // Moved to an ungraded group: only the own lines stay (decision 19).
    expect(rec.scores?.p).toBeUndefined();
    expect(rec.observations?.p).toBeUndefined();
    expect(rec.po?.p).toEqual({
      projectgroep: 'g2',
      groupLines: [],
      ownLines: [{ label: 'Hulp', value: -1 }],
    });
    writeGrading(rec, 'p', 'g2', emptyGrading(), []);
    expect(rec.po?.p).toBeUndefined();
  });

  it('reads damaged files without throwing', () => {
    const rec = {
      scores: { p: { a: 'N', b: 2 } },
      observations: { p: 'x' },
      po: { p: { categoryObs: { a: 'o' }, groupLines: [3, { value: 'x' }], comment: 4 } },
    } as unknown as ScoreRecord;
    const g = gradingOf(rec, 'p');
    expect(g.scores).toEqual({ b: 2 });
    expect(g.observations).toEqual([]);
    expect(g.categoryObs).toEqual({});
    expect(g.groupLines).toEqual([{ label: '', value: null }]);
    expect(g.comment).toBe('');
    expect(isEmptyGrading(gradingOf(null, 'p'))).toBe(true);
  });

  it('status: none, busy until every normal category is scored, then done', () => {
    expect(gradingStatus(rubric, emptyGrading())).toBe('none');
    expect(gradingStatus(rubric, { ...emptyGrading(), scores: { x: 1 } })).toBe('busy');
    expect(gradingStatus(rubric, { ...emptyGrading(), scores: { a: 0 } })).toBe('busy');
    expect(gradingStatus(rubric, { ...emptyGrading(), scores: { a: 0, b: 4 } })).toBe('done');
    expect(gradingStatus(null, emptyGrading())).toBe('none');
  });

  it('formats and parses lines in grade points', () => {
    expect([signedPoints(0.5), signedPoints(-1), signedPoints(0)]).toEqual(['+0,5', '−1,0', '']);
    expect(['-0,5', '+1', '0.3', '−2', ',5', 'x', '', '1,2,3'].map(parseLineValue)).toEqual([
      -0.5,
      1,
      0.3,
      -2,
      0.5,
      null,
      null,
      null,
    ]);
  });

  it('takes a group grading from a member graded in that group', () => {
    const a: ScoreRecord = { po: { p: { projectgroep: 'g2' } } };
    const b: ScoreRecord = { po: { p: { projectgroep: 'g1' } } };
    expect(groupSource([null, a, b], 'p', 'g1')).toBe(b);
    expect(groupSource([a], 'p', 'g1')).toBeNull();
    // Scores without a stamp (before step 23) count for the member's current group.
    const old: ScoreRecord = { scores: { p: { a: 2 } } };
    expect(groupSource([a, {}, old], 'p', 'g1')).toBe(old);
    expect(groupSource([b, old], 'p', 'g1')).toBe(b);
  });
});
