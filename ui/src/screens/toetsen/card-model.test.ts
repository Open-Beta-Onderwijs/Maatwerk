// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { Exam, Question } from '../../domain/types';
import {
  cardLine1,
  cardRtti,
  cardSummary,
  miniHistogram,
  topObservaties,
  MINI_HIST_H,
} from './card-model';

const q = (id: string, max: number, rtti: string, extra: Partial<Question> = {}): Question =>
  ({ id, max_points: max, rtti, ...extra }) as Question;

const exam = (over: Partial<Exam> = {}): Exam =>
  ({
    id: 'e',
    questions: [q('1', 12, 'R'), q('2', 14, 'T1'), q('3', 13, 'T2'), q('4', 9, 'I')],
    weging: 2,
    ...over,
  }) as Exam;

describe('cardLine1 (spec 4.7)', () => {
  it('points and the rapport weging', () => {
    expect(cardLine1(exam())).toBe('48 punten · weging rapport 2');
  });
  it('an SE test adds its SE weging', () => {
    expect(cardLine1(exam({ type: 'pta', weging_se: 10 }))).toBe(
      '48 punten · weging rapport 2 · SE 10',
    );
  });
  it('a diagnostic test does not count', () => {
    expect(cardLine1(exam({ diagnostic: true, weging: 0 }))).toBe('48 punten · telt niet mee');
  });
  it('bonus points are named apart', () => {
    const e = exam({ questions: [q('1', 10, 'R'), q('b', 2, 'R', { kind: 'bonus' } as never)] });
    expect(cardLine1(e)).toMatch(/^10 punten \+ 2 bonus · /);
  });
});

describe('cardRtti', () => {
  it('lists all four categories with their points; the names in the tooltip', () => {
    const r = cardRtti(exam())!;
    expect(r.parts.map((p) => `${p.cat} ${p.text}`)).toEqual(['R 12p', 'T1 14p', 'T2 13p', 'I 9p']);
    expect(r.title.split('\n')[0]).toBe('R (reproductie): 12 punten');
  });
  it('is absent for a PO', () => {
    expect(cardRtti(exam({ kind: 'po' } as Partial<Exam>))).toBeNull();
  });
});

describe('miniHistogram', () => {
  it('has the ten bins of step 1 and the 5,5 line in the middle', () => {
    const h = miniHistogram([5.4, 6, 6.2, 9.9]);
    expect(h.bars).toHaveLength(10);
    expect(h.passPct).toBeCloseTo(50);
    expect(h.bars[5]!.height).toBe(MINI_HIST_H - 4); // the highest bin
    expect(h.bars[0]!).toMatchObject({ height: 1, color: null, title: '<1,5: 0' });
    expect(h.bars[5]!.title).toBe('≥5,5 en <6,5: 2');
  });
});

describe('topObservaties', () => {
  const obs = [
    { id: 'a', naam: 'Eenheid vergeten', icon: '📏' },
    { id: 'b', naam: 'Rekenfout', icon: '🧮' },
    { id: 'c', naam: 'Afronden', icon: '🎯' },
    { id: 'd', naam: 'Grafiek', icon: '📈' },
  ];
  it('takes the three most given, ties by name; unknown ids are left out', () => {
    const counts = new Map([
      ['a', 6],
      ['b', 2],
      ['c', 2],
      ['d', 1],
      ['x', 9],
    ]);
    expect(topObservaties(counts, obs).map((o) => `${o.icon}${o.count}`)).toEqual([
      '📏6',
      '🎯2',
      '🧮2',
    ]);
    expect(topObservaties(new Map([['d', 1]]), obs)[0]!.title).toBe('Grafiek: 1 leerling');
  });
});

describe('cardSummary', () => {
  it('counts, mean ± SD and % onvoldoende; a Verzamelkaart says "beste poging"', () => {
    const s = cardSummary({ grades: [4, 6, 8], obs: new Map() }, true);
    expect(s.countText).toBe('beste poging · 3 leerlingen');
    expect(s.meanText).toBe('6,0');
    expect(s.failText).toBe('33% onvoldoende');
  });
  it('without grades', () => {
    const s = cardSummary({ grades: [], obs: new Map() }, false);
    expect(s).toMatchObject({
      countText: '0 leerlingen',
      mean: null,
      failText: 'nog geen cijfers',
    });
  });
});
