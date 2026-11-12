// SPDX-License-Identifier: AGPL-3.0-or-later

// Grade colours (design spec 2.3, V-01, R-01): one module for every screen.
//
// - Text colours return CSS that follows the theme (token mixes), for DOM
//   only (data-color, element.style).
// - Bar colours are theme-independent hex, also for Chart.js canvases.
// - Cell backgrounds are the score-entry grid's red-yellow-green fills.
//
// Pass is from 5,5 after rounding to one decimal; the pass gradients run
// over 5,5..9,5. The rapport (Typst) keeps its own colours.

import { isFail } from './core';

export const PASS = 5.5;
const TOP = 9.5;

export { isFail };

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Position of a passing grade on the 5,5..9,5 gradient. */
function passT(g: number): number {
  return clamp01((g - PASS) / (TOP - PASS));
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** Linear sRGB mix, `t` = 0 gives `a`; returns `#rrggbb`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ra, ga, ba] = rgb(a);
  const [rb, gb, bb] = rgb(b);
  const k = clamp01(t);
  return `#${hex2(ra + (rb - ra) * k)}${hex2(ga + (gb - ga) * k)}${hex2(ba + (bb - ba) * k)}`;
}

/** Same as mixHex, in CSS, for colours that are tokens. */
function mixVar(a: string, b: string, t: number): string {
  const pct = Math.round(clamp01(t) * 1000) / 10;
  return `color-mix(in srgb, var(${b}) ${pct}%, var(${a}))`;
}

/** Bar, pill-border, histogram and dot colours (same in both themes). */
export const GRADE_BAR = {
  fail: '#e5736b',
  passLow: '#f2c94c',
  passHigh: '#5db97b',
  /** Below 4 in the RTTI-per-grade-group charts. */
  deepFail: '#c62828',
  none: '#c9ced8',
  diagnostic: '#9aa1ad',
} as const;

/** Text colour of a grade (CSS, follows the theme); `null` is muted. */
export function gradeTextColor(g: number | null): string {
  if (g === null) return 'var(--grade-none-text)';
  if (isFail(g)) return 'var(--grade-fail-text)';
  return mixVar('--grade-pass-lo-text', '--grade-pass-hi-text', passT(g));
}

/** Bar / pill-border colour of a grade (hex). */
export function gradeBarColor(g: number | null): string {
  if (g === null) return GRADE_BAR.none;
  if (isFail(g)) return GRADE_BAR.fail;
  return mixHex(GRADE_BAR.passLow, GRADE_BAR.passHigh, passT(g));
}

/** Red, yellow, green over 0-100 %: question and RTTI percentages, slider zones. */
export function pctBarColor(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return GRADE_BAR.none;
  const t = clamp01(pct / 100);
  return t <= 0.5
    ? mixHex(GRADE_BAR.fail, GRADE_BAR.passLow, t * 2)
    : mixHex(GRADE_BAR.passLow, GRADE_BAR.passHigh, (t - 0.5) * 2);
}

/** Score-entry grid cell background of a grade (hex); null for no grade. */
export function gradeCellColor(g: number | null): string | null {
  if (g === null || !Number.isFinite(g)) return null;
  if (isFail(g)) return '#f7cfca';
  if (g < 7.5) return mixHex('#fbe7a6', '#e3edb4', (g - PASS) / 2);
  return mixHex('#e3edb4', '#c6e8cf', (g - 7.5) / 2);
}

// Pastel fills of the score grid's statistics cells (unchanged values).
const PASTEL_RED = '#f8d7da';
const PASTEL_YELLOW = '#fff3cd';
const PASTEL_GREEN = '#c3e6cb';

/** RTTI percentage cell: red (0) via yellow (50) to green (100). */
export function rttiPctCellColor(pct: number | null): string | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const t = clamp01(pct / 100);
  return t <= 0.5
    ? mixHex(PASTEL_RED, PASTEL_YELLOW, t * 2)
    : mixHex(PASTEL_YELLOW, PASTEL_GREEN, (t - 0.5) * 2);
}
