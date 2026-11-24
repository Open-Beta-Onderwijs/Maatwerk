// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from './attempts';
import {
  pooledRtti,
  rttiGemHistory,
  rttiPercents,
  shownAverage,
  statsOfAverages,
  type AverageFormat,
} from './statistics';
import type { Exam } from './types';

const YEAR = '2026-2027';

/** One test of one question, all T1, with `scored` of `max` points. */
function entry(id: string, scored: number, max: number, fields: Partial<Exam> = {}): HistoryEntry {
  return {
    exam: {
      id,
      academic_year: YEAR,
      n_term: 1,
      questions: [{ id: 'q1', max_points: max, rtti: 'T1' }],
      ...fields,
    },
    questionScores: { q1: scored },
  };
}

const NORMAL = entry('normal', 8, 10);
const DIAGNOSTIC = entry('diag', 10, 40, { diagnostic: true, weging: 0 });

const gemT1 = (history: HistoryEntry[]) => rttiPercents(pooledRtti(history), ['T1'])[0];

describe('the RTTI Gem. of a student (decision 27)', () => {
  it('leaves a diagnostic test out of the year: 80% instead of 36%', () => {
    expect(gemT1([NORMAL, DIAGNOSTIC])).toBe(36); // all tests, as before step 20
    expect(gemT1(rttiGemHistory([NORMAL, DIAGNOSTIC], YEAR))).toBe(80);
  });

  it('with only a diagnostic test there is nothing to average', () => {
    expect(rttiGemHistory([DIAGNOSTIC], YEAR)).toEqual([]);
  });

  it('keeps a test with weging 0 that is not diagnostic: unchanged for old data', () => {
    const noWeight = entry('w0', 2, 10, { weging: 0 });
    expect(rttiGemHistory([NORMAL, noWeight], YEAR)).toEqual([NORMAL, noWeight]);
  });

  it('keeps only the chosen school year', () => {
    const other = entry('other', 1, 10, { academic_year: '2025-2026' });
    expect(rttiGemHistory([NORMAL, other], YEAR)).toEqual([NORMAL]);
  });

  it('the examendossier is the PTA tests, as before', () => {
    const pta = entry('pta', 5, 10, { type: 'pta' });
    expect(rttiGemHistory([NORMAL, pta, DIAGNOSTIC], 'se')).toEqual([pta]);
  });
});

describe('shown averages (Cijfergemiddelden, decisions 91-93)', () => {
  const k0: AverageFormat = { methode: 'afkappen', decimalen: 0 };
  const a2: AverageFormat = { methode: 'afronden', decimalen: 2 };

  it('defaults to afronden 1', () => {
    expect(shownAverage(5.45)).toBe(5.5);
    expect(shownAverage(6.75)).toBe(6.8);
  });

  it('follows the format, noise removed first', () => {
    expect(shownAverage(5.9, k0)).toBe(5);
    expect(shownAverage((5.3 + 5.7) / 2, k0)).toBe(5);
    expect(shownAverage(5.999999999999999, k0)).toBe(6);
    expect(shownAverage((8.6 + 8.7) / 2, a2)).toBe(8.65);
  });

  it('group numbers use the shown values', () => {
    expect(statsOfAverages([5.9, 7.2], k0)).toMatchObject({ mean: 6, fails: 50 });
    expect(statsOfAverages([5.45, 7], a2)).toMatchObject({ fails: 50 });
    expect(statsOfAverages([5.45, 7])).toMatchObject({ fails: 0 });
  });
});
