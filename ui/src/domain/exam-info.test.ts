// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  attemptCode,
  attemptLabel,
  metaLine,
  pointsLine,
  pointTotals,
  questionSummary,
  resitObsIds,
} from './exam-info';
import { formatNTerm } from './format';
import { testBadgeClass, testKind, testKindLabel, testKindToken } from './test-type';
import type { Exam, Question } from './types';

const q = (max_points: number, rtti: string, kind?: string): Question =>
  ({ id: `q${max_points}${rtti}`, max_points, rtti, kind }) as Question;

// The design's example: 41 points, R 3, T1 21, T2 17, I 0.
const QS = [q(3, 'R'), q(21, 'T1'), q(17, 'T2')];

const exam = (fields: Partial<Exam>): Exam => ({ id: 'e', questions: [], ...fields }) as Exam;

describe('test kinds', () => {
  it('tells the five kinds apart', () => {
    expect(testKind({})).toBe('toets');
    expect(testKind({ type: 'regular', kind: 'toets' })).toBe('toets');
    expect(testKind({ type: 'pta' })).toBe('se');
    expect(testKind({ kind: 'po' })).toBe('po');
    expect(testKind({ kind: 'po', type: 'pta' })).toBe('se-po');
    expect(testKind({ diagnostic: true })).toBe('diagnostic');
  });

  it('diagnostic wins over PTA: it counts for nothing, also with old data', () => {
    expect(testKind({ diagnostic: true, type: 'pta' })).toBe('diagnostic');
  });

  it('gives the badge class, the pill text and the chart colour', () => {
    expect(testBadgeClass({ type: 'regular' })).toBe('test-badge');
    expect(testBadgeClass({ diagnostic: true })).toBe('test-badge test-badge--diagnostic');
    expect(testKindLabel('se')).toBe('SE-toets');
    expect(testKindLabel('se-po')).toBe('SE praktische opdracht');
    expect(testKindToken('diagnostic')).toBe('--grade-diagnostic-border');
    expect(testKindToken('se')).toBe('--anti');
  });
});

describe('point totals', () => {
  it('counts only normal questions in the maximum and in RTTI', () => {
    const t = pointTotals([...QS, q(5, 'R', 'bonus'), q(4, 'T1', 'diag')]);
    expect(t.normal).toBe(41);
    expect(t.bonus).toBe(5);
    expect(t.byRtti).toEqual({ R: 3, T1: 21, T2: 17, I: 0 });
  });

  it('the points line leaves out empty categories and uses a decimal comma', () => {
    expect(pointsLine(QS)).toBe('41p · R: 3p · T1: 21p · T2: 17p');
    expect(pointsLine([q(1.5, 'I'), q(2, 'I', 'bonus')])).toBe('1,5p (+2p bonus) · I: 1,5p');
  });

  it('the summary has whole percentages of the normal points (the design example)', () => {
    const qs = Array.from({ length: 9 }, () => q(0, 'T1')).concat(QS);
    expect(questionSummary(qs)).toBe(
      '12 vragen · 41 punten · R: 3 (7%) · T1: 21 (51%) · T2: 17 (41%) · I: 0 (0%)',
    );
  });

  it('the summary handles no points, one question and bonus', () => {
    expect(questionSummary([q(0, 'R')])).toBe(
      '1 vraag · 0 punten · R: 0 (0%) · T1: 0 (0%) · T2: 0 (0%) · I: 0 (0%)',
    );
    expect(questionSummary([q(4, 'R'), q(2, 'R', 'bonus')])).toBe(
      '2 vragen · 4 punten (+2 bonus) · R: 4 (100%) · T1: 0 (0%) · T2: 0 (0%) · I: 0 (0%)',
    );
  });
});

describe('meta line', () => {
  const base = { schoolsoort: ['Gymnasium'], periode: '1', n_term: 1.5, weging: 3 };

  it('a toets shows N-term and weging', () => {
    expect(metaLine(exam(base))).toBe('Gymnasium · Periode 1 · N-term 1,5 · Weging 3');
  });

  it('an SE-toets adds weging SE', () => {
    expect(metaLine(exam({ ...base, type: 'pta', weging_se: 20 }))).toBe(
      'Gymnasium · Periode 1 · N-term 1,5 · Weging 3 · Weging SE 20',
    );
  });

  it('a diagnostic test says it does not count', () => {
    expect(metaLine(exam({ ...base, weging: 0, diagnostic: true }))).toBe(
      'Gymnasium · Periode 1 · telt niet mee voor rapport of SE',
    );
  });

  it('leaves out what is absent', () => {
    expect(metaLine(exam({}))).toBe('N-term 1,0 · Weging 1');
  });
});

describe('attempts', () => {
  it('codes: the number, with the first letter of a resit description', () => {
    expect(attemptCode({ volgnummer: 501 })).toBe('501');
    expect(attemptCode({ volgnummer: 501, parent_id: 'p', description: 'INHAAL' })).toBe('501-I');
    expect(attemptCode({ volgnummer: 501, parent_id: 'p', description: ' extra' })).toBe('501-E');
    expect(attemptCode({ volgnummer: 501, parent_id: 'p' })).toBe('501-?');
  });

  it('labels: the known words read normally, anything else as typed', () => {
    expect(attemptLabel({})).toBe('Origineel');
    expect(attemptLabel({ parent_id: 'p', description: 'INHAAL' })).toBe('Inhaal');
    expect(attemptLabel({ parent_id: 'p', description: 'HERKANSING' })).toBe('Herkansing');
    expect(attemptLabel({ parent_id: 'p', description: 'Tweede kans' })).toBe('Tweede kans');
    expect(attemptLabel({ parent_id: 'p' })).toBe('Poging');
  });
});

describe('observaties of a resit (F-12)', () => {
  it('follows what the original lost and gained', () => {
    expect(resitObsIds(['a', 'b'], ['a', 'b'], ['b', 'c'])).toEqual(['b', 'c']);
  });

  it('keeps an observatie only the resit has (migration: original + own)', () => {
    expect(resitObsIds(['a', 'own'], ['a'], ['c'])).toEqual(['own', 'c']);
  });

  it('adds nothing twice and can be repeated after a failed save', () => {
    const once = resitObsIds(['a'], ['a'], ['a', 'b']);
    expect(once).toEqual(['a', 'b']);
    expect(resitObsIds(once, ['a'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('N-term', () => {
  it('has at least one decimal and never rounds', () => {
    expect(formatNTerm(1)).toBe('1,0');
    expect(formatNTerm(1.5)).toBe('1,5');
    expect(formatNTerm(1.25)).toBe('1,25');
  });
});
