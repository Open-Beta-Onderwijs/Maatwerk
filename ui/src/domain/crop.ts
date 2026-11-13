// SPDX-License-Identifier: AGPL-3.0-or-later

// The square photo crop (F-19, design spec 4.9, board 12): a square over any
// image, moved by dragging or the arrow keys, resized by scrolling or + / -.
// Pure geometry in image pixels; components/photo-crop.ts draws it.

export interface Size {
  width: number;
  height: number;
}

/** The square, in image pixels: top-left corner and side. */
export interface Square {
  x: number;
  y: number;
  size: number;
}

/** Side of the saved photo at most (px); smaller crops are saved at their own size. */
export const OUTPUT_MAX = 512;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The smallest square allowed: a tenth of the short side, at least 1 px. */
export function minSide(img: Size): number {
  return Math.max(1, Math.min(img.width, img.height) / 10);
}

/** Keeps the square inside the image and within the allowed sizes. */
export function clampSquare(sq: Square, img: Size): Square {
  const max = Math.min(img.width, img.height);
  const size = clamp(sq.size, Math.min(minSide(img), max), max);
  return {
    size,
    x: clamp(sq.x, 0, img.width - size),
    y: clamp(sq.y, 0, img.height - size),
  };
}

/**
 * The square to start with: the whole short side for a photo that is square
 * already (an existing one stays as it is), else 80% of it, centred.
 */
export function initialSquare(img: Size): Square {
  const short = Math.min(img.width, img.height);
  const size = img.width === img.height ? short : short * 0.8;
  return clampSquare({ x: (img.width - size) / 2, y: (img.height - size) / 2, size }, img);
}

/** Moves the square by (dx, dy) image pixels, staying inside the image. */
export function moveSquare(sq: Square, dx: number, dy: number, img: Size): Square {
  return clampSquare({ ...sq, x: sq.x + dx, y: sq.y + dy }, img);
}

/** Scales the square by `factor` around its centre (< 1 zooms in: a smaller square). */
export function zoomSquare(sq: Square, factor: number, img: Size): Square {
  const cx = sq.x + sq.size / 2;
  const cy = sq.y + sq.size / 2;
  const max = Math.min(img.width, img.height);
  const size = clamp(sq.size * factor, Math.min(minSide(img), max), max);
  return clampSquare({ x: cx - size / 2, y: cy - size / 2, size }, img);
}

/** The scale that fits the image inside a box (never enlarged beyond the box). */
export function fitScale(img: Size, box: Size): number {
  if (!img.width || !img.height) return 1;
  return Math.min(box.width / img.width, box.height / img.height);
}

/** Side of the saved photo for a square. */
export function outputSide(sq: Square): number {
  return Math.max(1, Math.min(OUTPUT_MAX, Math.round(sq.size)));
}

/**
 * The square's change for a key, or null for other keys. Arrows move by 2%
 * of the short side (Shift: 10%); + and - zoom by 10%.
 */
export function keyStep(sq: Square, key: string, shift: boolean, img: Size): Square | null {
  const step = (Math.min(img.width, img.height) * (shift ? 10 : 2)) / 100;
  switch (key) {
    case 'ArrowLeft':
      return moveSquare(sq, -step, 0, img);
    case 'ArrowRight':
      return moveSquare(sq, step, 0, img);
    case 'ArrowUp':
      return moveSquare(sq, 0, -step, img);
    case 'ArrowDown':
      return moveSquare(sq, 0, step, img);
    case '+':
    case '=':
      return zoomSquare(sq, 0.9, img);
    case '-':
    case '_':
      return zoomSquare(sq, 1 / 0.9, img);
    default:
      return null;
  }
}
