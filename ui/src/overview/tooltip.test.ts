// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { placeTip } from './tooltip';

// A 1280 x 800 window; a 290 px wide tooltip; a grade cell in the right half.
const cell = (top: number) => ({ left: 900, right: 970, top, bottom: top + 30 });

describe('placeTip (step 37: the tooltip stays on screen)', () => {
  it('goes under the cell, right-aligned, when it fits', () => {
    expect(placeTip(cell(100), 290, 200, 1280, 800, true)).toEqual({ left: 680, top: 134 });
  });

  it('goes above the cell when it does not fit under it', () => {
    expect(placeTip(cell(600), 290, 300, 1280, 800, true)).toEqual({ left: 680, top: 296 });
  });

  it('goes beside the cell, inside the window, when it fits neither under nor above', () => {
    // 500 high, cell in the middle: 365 above and 405 under are both too little.
    const p = placeTip(cell(380), 290, 500, 1280, 800, true);
    expect(p.left).toBe(900 - 4 - 290);
    expect(p.top).toBe(395 - 250);
    // Near the top or the bottom of the window: clamped, never off screen (the reported case).
    expect(placeTip(cell(120), 290, 700, 1280, 800, true).top).toBe(8);
    expect(placeTip(cell(700), 290, 700, 1280, 800, true).top).toBe(92);
    expect(placeTip(cell(20), 290, 790, 1280, 800, true).top).toBe(8);
  });

  it('takes the other side when the preferred one has no room', () => {
    const left = { left: 100, right: 200, top: 380, bottom: 410 };
    expect(placeTip(left, 290, 500, 1280, 800, true).left).toBe(204);
    expect(placeTip(left, 290, 500, 1280, 800, false).left).toBe(204);
  });
});
