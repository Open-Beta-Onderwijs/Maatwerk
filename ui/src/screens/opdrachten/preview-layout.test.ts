// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { cardSlots, gridHeight, halfWidth, pageInView } from './preview-layout';

describe('cardSlots', () => {
  it('closed: three columns over 1360 px as board 58', () => {
    const s = cardSlots(4, 1360, false);
    const cw = (1360 - 72) / 3;
    expect(s[0]).toEqual({ x: 0, y: 0, w: cw });
    expect(s[2]!.x).toBeCloseTo(2 * (cw + 36));
    expect(s[3]).toEqual({ x: 0, y: 212, w: cw });
  });

  it('open: two columns in the left half', () => {
    const s = cardSlots(3, 1360, true);
    const cw2 = (1360 / 2 - 18 - 24) / 2;
    expect(halfWidth(1360)).toBe(662);
    expect(s[1]).toEqual({ x: cw2 + 24, y: 0, w: cw2 });
    expect(s[2]).toEqual({ x: 0, y: 212, w: cw2 });
  });
});

describe('gridHeight', () => {
  it('rows of 196 with 16 between', () => {
    expect(gridHeight(0, false)).toBe(0);
    expect(gridHeight(3, false)).toBe(196);
    expect(gridHeight(4, false)).toBe(408);
    expect(gridHeight(4, true)).toBe(408);
    expect(gridHeight(5, true)).toBe(620);
  });
});

describe('pageInView', () => {
  it('the last page whose top passed a third of the view', () => {
    const tops = [0, 800, 1600];
    expect(pageInView(tops, 0, 900)).toBe(0);
    expect(pageInView(tops, 600, 900)).toBe(1);
    expect(pageInView(tops, 1400, 900)).toBe(2);
  });
});
