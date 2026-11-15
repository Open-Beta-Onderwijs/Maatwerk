// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { histogramModel } from './histogram';
import { rttiLineModel, spreadLabels, LABEL_GAP } from './rtti-line';
import { averagesStats, columnStats, sdText } from './sections';
import { resitInfo, resitSubline } from './resit-dot';
import { axisPct, pctOf } from './common';
import type { Exam } from '../domain/types';
import { mean, meanOfAverages } from '../domain/statistics';

describe('histogram (decision 30)', () => {
  it('step 1 has ten bins from 0,5, labelled <1,5 ... ≤10,0', () => {
    const m = histogramModel([5.4, 5.5, 6.0, 9.9, 10], 1, 100);
    expect(m.bars).toHaveLength(10);
    expect(m.bars[0]!.label).toBe('<1,5');
    expect(m.bars[9]!.label).toBe('≤10,0');
    expect(m.bars.map((b) => b.n)).toEqual([0, 0, 0, 0, 1, 2, 0, 0, 0, 2]);
  });

  it('step 0,5 has eighteen bins from 1,0', () => {
    const m = histogramModel([1.0, 5.4, 5.5], 0.5, 160);
    expect(m.bars).toHaveLength(18);
    expect(m.bars[0]!.label).toBe('<1,5');
    expect(m.bars[17]!.label).toBe('≤10,0');
    expect(m.bars[0]!.n).toBe(1);
  });

  it('puts the 5,5 line on the bin boundary', () => {
    expect(histogramModel([], 1, 100).passPct).toBeCloseTo(50);
    expect(histogramModel([], 0.5, 100).passPct).toBeCloseTo((9 / 18) * 100);
  });

  it('draws an empty bin as a 2 px line and keeps room for the count', () => {
    const m = histogramModel([7, 7, 8], 1, 100);
    const empty = m.bars[0]!;
    expect(empty.height).toBe(2);
    expect(empty.color).toBeNull();
    const highest = m.bars.find((b) => b.n === 2)!;
    expect(highest.height).toBe(100 - 26 + 6);
    expect(highest.title).toBe('≥6,5 en <7,5: 2');
  });
});

describe('RTTI-verloop labels (decision 32)', () => {
  it('pushes labels apart to at least 14 px, in the input order', () => {
    const tops = spreadLabels([100, 102, 50, 101], 400);
    const sorted = [...tops].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(LABEL_GAP);
    expect(tops[2]).toBe(43); // 50 - 7: alone, centred on its dot
    expect(tops[0]).toBe(93);
  });

  it('moves the stack up when it would cross the axis', () => {
    const tops = spreadLabels([200, 200, 200, 200], 214);
    expect(Math.max(...tops) + LABEL_GAP).toBeLessThanOrEqual(214);
  });

  it('places one point per test and highlights the current one', () => {
    const exam = (id: string, nr: number) => ({ id, volgnummer: nr, questions: [] }) as Exam;
    const m = rttiLineModel(
      [
        { exam: exam('a', 501), pcts: [80, 70, 60, null] },
        { exam: exam('b', 502), pcts: [90, 80, 70, 60] },
      ],
      1000,
      250,
      'b',
    );
    expect(m.dots).toHaveLength(7);
    expect(m.lines.find((l) => l.cat === 'I')!.points.split(' ')).toHaveLength(1);
    // Inside the axes (x 52-972) with room: the first at 84 px, the last at 928 px.
    expect(m.codes.map((c) => Math.round(c.leftPct))).toEqual([8, 93]);
    expect(m.highlight).not.toBeNull();
    expect(m.dots.filter((d) => d.r === 6)).toHaveLength(4);
    expect(m.grid.map((g) => g.label)).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });
});

describe('section stats', () => {
  it('gives mean and population SD of a column', () => {
    const s = columnStats([4, 6, 8]);
    expect(s.mean).toBeCloseTo(6);
    expect(s.sd).toBeCloseTo(Math.sqrt(8 / 3));
    expect(sdText(s.sd)).toBe('± 1,6');
  });

  it('gives the means the old group overview footer showed (mean, meanOfAverages)', () => {
    const grades = [3.7, 8.2, 5.5, 6.1, 9.9];
    expect(columnStats(grades).mean).toBe(mean(grades));
    const avgs = [5.449, 6.04, 7.15];
    expect(averagesStats(avgs).mean).toBe(meanOfAverages(avgs));
  });

  it('is empty without grades', () => {
    expect(columnStats([])).toEqual({ mean: null, sd: null });
    expect(averagesStats([])).toEqual({ mean: null, sd: null });
    expect(sdText(null)).toBe('—');
  });

  it('takes averages as shown (decision 21)', () => {
    // 5,45 is shown as 5,5 (rounded half away from zero), 6,04 as 6,0.
    expect(averagesStats([5.45, 6.04]).mean).toBeCloseTo(5.75);
  });
});

describe('resit dot', () => {
  it('names inhaal and herkansing with the attempt', () => {
    expect(resitInfo({ parent_id: 'x', description: 'HERKANSING', attempt: 2 })).toEqual({
      letter: 'H',
      title: 'Herkansing (poging 2)',
    });
    expect(resitInfo({ parent_id: 'x', description: 'INHAAL', attempt: 3 })!.title).toBe(
      'Inhaal (poging 3)',
    );
    expect(resitInfo({ description: 'HERKANSING' })).toBeNull();
  });

  it('keeps a resit word of its own', () => {
    expect(resitInfo({ parent_id: 'x', description: 'extra kans' })).toEqual({
      letter: 'E',
      title: 'extra kans (poging 2)',
    });
  });

  it('adds the original grade to the sub line', () => {
    const info = resitInfo({ parent_id: 'x', description: 'HERKANSING', attempt: 2 })!;
    expect(resitSubline(info, 4.9)).toBe('Herkansing (poging 2), origineel 4,9');
    expect(resitSubline(info, null)).toBe('Herkansing (poging 2)');
  });
});

describe('axis and percentages', () => {
  it('maps 1-10 to 0-100 %', () => {
    expect(axisPct(1)).toBe(0);
    expect(axisPct(10)).toBe(100);
    expect(axisPct(5.5)).toBeCloseTo(50);
    expect(axisPct(0.5)).toBe(0);
  });

  it('rounds whole percentages', () => {
    expect(pctOf(1, 3)).toBe(33);
    expect(pctOf(2, 3)).toBe(67);
    expect(pctOf(1, 0)).toBe(0);
  });
});
