// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { StudentCardNumbers } from '../../domain/cards';
import { barHeight, groupGradesHtml, studentGradesHtml, trendArrowHtml } from './card-html';

const BASE: StudentCardNumbers = {
  bars: [
    { grade: 6, title: '1 · Toets 1: 6,0', diagnostic: false },
    { grade: 9, title: '2 · Diagnose: 9,0', diagnostic: true },
  ],
  average: 6.5,
  last: 7.2,
  trend: { last: 7.2, average: 6.5, d: 0.7, level: 'slightUp' },
  se: null,
};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('student card markup (F-07)', () => {
  it('bars, average with the trend, "laatste"', () => {
    const html = studentGradesHtml(BASE);
    expect(html).toContain('aria-label="Cijfers: 6,0, 9,0"');
    expect(html).toContain('data-bg="#9aa1ad"'); // the diagnostic bar is grey
    expect(html).toContain('aria-label="Trend: licht omhoog"');
    expect(html).toContain('trend-arrow--slightUp');
    expect(text(html)).toBe('6,5 laatste 7,2');
    expect(html).not.toContain('s-card__swap');
  });

  it('years 4-6: "laatste" and "SE" alternate, both in the tooltip and the reduced-motion line', () => {
    const html = studentGradesHtml({ ...BASE, se: 6.8 });
    expect(html).toContain('class="s-card__swap" title="Laatste 7,2 · SE 6,8"');
    expect(html).toMatch(/s-card__swap-a">laatste <b[^>]*>7,2<\/b>/);
    expect(html).toMatch(/s-card__swap-b">SE <b[^>]*>6,8<\/b>/);
    expect(html).toMatch(/s-card__swap-both">laatste <b[^>]*>7,2<\/b> · SE <b[^>]*>6,8<\/b>/);
  });

  it('no counted grade: "Nog geen cijfers"', () => {
    const html = studentGradesHtml({ bars: [], average: null, last: null, trend: null, se: null });
    expect(text(html)).toBe('Nog geen cijfers');
  });

  it('no grade this year but an SE from earlier years: the SE only', () => {
    const html = studentGradesHtml({ bars: [], average: null, last: null, trend: null, se: 6.4 });
    expect(text(html)).toBe('SE 6,4');
  });

  it('bar heights in proportion, 28 px for a 10', () => {
    expect([barHeight(10), barHeight(5), barHeight(0.4), barHeight(12)]).toEqual([28, 14, 3, 28]);
  });

  it('every trend level has its label', () => {
    expect(trendArrowHtml('strongDown')).toContain('aria-label="Trend: sterk omlaag"');
  });
});

describe('group card markup (F-09)', () => {
  const year = { n: 20, mean: 6.6, sd: 1.5, fails: 14 };
  const se = { n: 20, mean: 6.2, sd: 1.3, fails: 25 };

  it('lower school: mean ± SD and % onvoldoende', () => {
    const html = groupGradesHtml({ year, se: null });
    expect(text(html)).toBe('6,6 ± 1,5 14% onvoldoende');
    expect(html).not.toContain('g-card__fails--alarm');
  });

  it('upper school (variant B): SE and R on one line; the year line counts the fails', () => {
    const html = groupGradesHtml({ year, se });
    expect(text(html)).toBe('SE 6,2 ± 1,3 · R 6,6 ± 1,5 14% onvoldoende');
  });

  it('% onvoldoende in the danger colour from 20%', () => {
    expect(groupGradesHtml({ year: { ...year, fails: 20 }, se: null })).toContain(
      'g-card__fails--alarm',
    );
  });

  it('nothing to show without averages', () => {
    expect(groupGradesHtml({ year: null, se: null })).toBe('');
  });
});
