// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  clampSquare,
  fitScale,
  initialSquare,
  keyStep,
  moveSquare,
  outputSide,
  zoomSquare,
} from './crop';

const WIDE = { width: 1000, height: 500 };

describe('photo crop (F-19)', () => {
  it('starts with 80% of the short side, centred; a square photo stays whole', () => {
    expect(initialSquare(WIDE)).toEqual({ x: 300, y: 50, size: 400 });
    expect(initialSquare({ width: 300, height: 300 })).toEqual({ x: 0, y: 0, size: 300 });
  });

  it('keeps the square inside the image when moved', () => {
    const sq = initialSquare(WIDE);
    expect(moveSquare(sq, 1000, 1000, WIDE)).toEqual({ x: 600, y: 100, size: 400 });
    expect(moveSquare(sq, -1000, -1000, WIDE)).toEqual({ x: 0, y: 0, size: 400 });
  });

  it('zooms around the centre between a tenth and the whole short side', () => {
    const sq = { x: 300, y: 50, size: 400 };
    expect(zoomSquare(sq, 0.5, WIDE)).toEqual({ x: 400, y: 150, size: 200 });
    expect(zoomSquare(sq, 0.01, WIDE).size).toBe(50);
    // Larger than the short side: the whole height, pushed back inside.
    expect(zoomSquare({ x: 0, y: 0, size: 400 }, 2, WIDE)).toEqual({ x: 0, y: 0, size: 500 });
  });

  it('clamps a square from outside', () => {
    expect(clampSquare({ x: -5, y: 900, size: 9999 }, WIDE)).toEqual({ x: 0, y: 0, size: 500 });
  });

  it('fits the image in the crop area', () => {
    expect(fitScale(WIDE, { width: 300, height: 190 })).toBeCloseTo(0.3);
    expect(fitScale({ width: 100, height: 400 }, { width: 300, height: 190 })).toBeCloseTo(0.475);
  });

  it('saves at most 512 px', () => {
    expect(outputSide({ x: 0, y: 0, size: 2000 })).toBe(512);
    expect(outputSide({ x: 0, y: 0, size: 99.6 })).toBe(100);
  });

  it('moves and zooms with the keyboard', () => {
    const sq = { x: 300, y: 50, size: 400 };
    expect(keyStep(sq, 'ArrowRight', false, WIDE)).toEqual({ x: 310, y: 50, size: 400 });
    expect(keyStep(sq, 'ArrowUp', true, WIDE)).toEqual({ x: 300, y: 0, size: 400 });
    expect(keyStep(sq, '+', false, WIDE)?.size).toBeCloseTo(360);
    expect(keyStep(sq, '-', false, WIDE)?.size).toBeCloseTo(444.44, 1);
    expect(keyStep(sq, 'a', false, WIDE)).toBeNull();
  });
});
