// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  cardPlace,
  outline,
  titleX,
  trayHeight,
  trayStart,
  type GridGeometry,
} from './stack-layout';

// The mock's grid (board 56): 1360 px wide, three columns, gap 36.
const G: GridGeometry = { cols: 3, cardW: (1360 - 72) / 3, cardH: 214, colGap: 36, rowGap: 16 };
const SX = G.cardW + G.colGap;

describe('trayStart', () => {
  it('three attempts use the full width', () => {
    expect([0, 1, 2].map((c) => trayStart(G, c, 3))).toEqual([0, 0, 0]);
  });
  it('two attempts are centred under the stack, kept inside the grid', () => {
    expect([0, 1, 2].map((c) => trayStart(G, c, 2))).toEqual([0, 0.5, 1]);
  });
  it('more attempts than columns start at the left', () => {
    expect(trayStart(G, 2, 4)).toBe(0);
  });
});

describe('cardPlace', () => {
  it('closed: behind the Verzamelkaart, 5 px steps, fading', () => {
    const p = [0, 1, 2].map((k) => cardPlace(G, 1, 3, k, 0, false));
    expect(p.map((x) => x.y)).toEqual([-250 + 5, -250 + 10, -250 + 15]);
    expect(p.map((x) => x.x)).toEqual([1, 2, 3].map((k) => Math.round((SX + 5 * k) * 100) / 100));
    expect(p.map((x) => x.opacity)).toEqual([0.85, 0.6, 0.4]);
  });
  it('closed with the row tray open for another stack: one row gap higher', () => {
    expect(cardPlace(G, 0, 2, 0, 0, true).y).toBe(-250 - 16 + 5);
  });
  it('dropped: under the Verzamelkaart, the first card exactly in its column', () => {
    expect(cardPlace(G, 2, 3, 0, 1, true)).toEqual({
      x: Math.round(2 * SX * 100) / 100,
      y: 0,
      opacity: 0.85,
    });
  });
  it('spread: in the columns from the tray start; a fourth attempt wraps', () => {
    expect([0, 1].map((k) => cardPlace(G, 1, 2, k, 2, true).x)).toEqual([
      Math.round(0.5 * SX * 100) / 100,
      Math.round(1.5 * SX * 100) / 100,
    ]);
    const fourth = cardPlace(G, 0, 4, 3, 2, true);
    expect(fourth).toEqual({ x: 0, y: 214 + 16, opacity: 1 });
  });
});

describe('tray', () => {
  it('is a title strip, a card and a bottom pad high; two rows for four attempts', () => {
    expect(trayHeight(G, 3)).toBe(260);
    expect(trayHeight(G, 4)).toBe(36 + 214 * 2 + 16 + 10);
  });
  it('puts the title above the first spread card', () => {
    expect(titleX(G, 1, 2)).toBe(Math.round((0.5 * SX + 8) * 100) / 100);
  });
});

describe('outline', () => {
  it('matches the mock for a stack in the middle with three attempts', () => {
    const o = outline(G, 1, 3);
    expect(o.top).toBe(238);
    expect(o.height).toBe(238 + 260);
    const sL = Math.round((SX + 1) * 100) / 100;
    const sR = Math.round((SX + G.cardW + 15) * 100) / 100;
    const tR = Math.round((2 * SX + G.cardW + 15) * 100) / 100;
    expect(o.d).toBe(
      `M ${sL} 17 A 16 16 0 0 1 ${sL + 16} 1 H ${sR - 16} A 16 16 0 0 1 ${sR} 17` +
        ` V 222 A 16 16 0 0 0 ${sR + 16} 238 H ${tR - 16} A 16 16 0 0 1 ${tR} 254` +
        ` V 481 A 16 16 0 0 1 ${tR - 16} 497 H 17 A 16 16 0 0 1 1 481` +
        ` V 254 A 16 16 0 0 1 17 238 H ${sL - 16} A 16 16 0 0 0 ${sL} 222 Z`,
    );
  });
  it('has no concave corner on a side where the stack and the tray line up', () => {
    const left = outline(G, 0, 2).d;
    expect(left.match(/A 16 16 0 0 0/g)).toHaveLength(1);
    const right = outline(G, 2, 2).d;
    expect(right.match(/A 16 16 0 0 0/g)).toHaveLength(1);
  });
});
