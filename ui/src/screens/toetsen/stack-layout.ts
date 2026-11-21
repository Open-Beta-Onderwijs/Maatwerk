// SPDX-License-Identifier: AGPL-3.0-or-later

// Geometry of an exam stack (design spec 4.7, boards 55-56, PLAN-2 decisions 43-44): where the
// attempt cards are when the stack is closed, dropped under the Verzamelkaart or spread over the
// tray, how tall the tray is, and the one outline around the Verzamelkaart and the tray. Pure, so
// it can be tested; stack.ts applies it to the DOM.
//
// Coordinates: x from the grid's left edge, y from the top of the tray's card area (the tray's top
// plus TITLE_H). The outline is in the tray's SVG box: x from the tray's left edge (MARGIN left of
// the grid), y from the SVG top, which lies `outlineTop` above the tray's top.

/** 0 closed (behind the Verzamelkaart), 1 dropped under it into the tray, 2 spread out. */
export type StackPhase = 0 | 1 | 2;

export interface GridGeometry {
  /** Number of columns (3 on the Toetsen screen). */
  cols: number;
  /** Width of one card (one column), px. */
  cardW: number;
  /** Height of a card, px. */
  cardH: number;
  /** Gap between columns, px. */
  colGap: number;
  /** Gap between rows, px. */
  rowGap: number;
}

/** Title strip at the top of the tray. */
export const TITLE_H = 36;
/** Space under the attempt cards in the tray. */
export const BOTTOM_PAD = 10;
/** The outline lies this far outside the cards. */
export const MARGIN = 8;
/** Corner radius of the outline, convex and concave corners alike. */
export const RADIUS = 16;
/** Each attempt behind the Verzamelkaart lies this much further right and down. */
export const STEP = 5;
/** Opacity of the attempts behind a closed stack (spec: 85%, 60%, 40%). */
const FADE = [0.85, 0.6, 0.4, 0.25];

export interface CardPlace {
  x: number;
  y: number;
  opacity: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Column step: one card plus one gap. */
const stepX = (g: GridGeometry) => g.cardW + g.colGap;

/** Cards per tray row, and the first column of the tray (half columns centre two attempts). */
export function trayStart(g: GridGeometry, col: number, n: number): number {
  const m = Math.min(n, g.cols);
  return Math.max(0, Math.min(col - (m - 1) / 2, g.cols - m));
}

/** Rows of attempt cards in an open tray. */
export function trayRows(g: GridGeometry, n: number): number {
  return Math.max(1, Math.ceil(n / g.cols));
}

/** Height of the open tray. */
export function trayHeight(g: GridGeometry, n: number): number {
  const rows = trayRows(g, n);
  return TITLE_H + rows * g.cardH + (rows - 1) * g.rowGap + BOTTOM_PAD;
}

/**
 * Where attempt `k` (0 = Origineel) of a stack in column `col` with `n` attempts is in `phase`.
 * `trayOpen`: whether the tray of the row is open, which moves its top down by one row gap (a
 * closed tray overlaps the gap); the cards of a closed stack must stay behind their Verzamelkaart.
 */
export function cardPlace(
  g: GridGeometry,
  col: number,
  n: number,
  k: number,
  phase: StackPhase,
  trayOpen: boolean,
): CardPlace {
  const sx = stepX(g);
  const off = (k + 1) * STEP;
  if (phase === 2) {
    const start = trayStart(g, col, n);
    return {
      x: round2((start + (k % g.cols)) * sx),
      y: Math.floor(k / g.cols) * (g.cardH + g.rowGap),
      opacity: 1,
    };
  }
  const fade = FADE[Math.min(k, FADE.length - 1)]!;
  if (phase === 1) return { x: round2(col * sx + off - STEP), y: off - STEP, opacity: fade };
  // Behind the Verzamelkaart: its top is a card and the title strip above the card area.
  const hidden = -(g.cardH + TITLE_H) - (trayOpen ? g.rowGap : 0);
  return { x: round2(col * sx + off), y: hidden + off, opacity: fade };
}

/** Left of the tray title, in tray coordinates: above the first spread card. */
export function titleX(g: GridGeometry, col: number, n: number): number {
  return round2(trayStart(g, col, n) * stepX(g) + MARGIN);
}

export interface Outline {
  /** SVG path data. */
  d: string;
  /** How far the SVG box starts above the tray's top. */
  top: number;
  /** Height of the SVG box. */
  height: number;
}

/**
 * The outline around the Verzamelkaart in column `col` and its open tray: one closed path, 2 px
 * stroke, every corner rounded with RADIUS, the concave corners where the stack meets the tray
 * included. Drawn MARGIN outside the cards; the stroke sits 1 px inside the SVG box.
 */
export function outline(g: GridGeometry, col: number, n: number): Outline {
  const sx = stepX(g);
  const r = RADIUS;
  const start = trayStart(g, col, n);
  const m = Math.min(n, g.cols);
  const outer = g.cardW + 2 * MARGIN - 1;
  // The junction: the tray's top, a row gap and the margin below the Verzamelkaart.
  const j = g.rowGap + MARGIN + g.cardH;
  const b = j + trayHeight(g, n) - 1;
  const sL = round2(col * sx + 1);
  const sR = round2(col * sx + outer);
  const tL = round2(start * sx + 1);
  const tR = round2((start + m - 1) * sx + outer);
  const arc = (sweep: 0 | 1, x: number, y: number) => `A ${r} ${r} 0 0 ${sweep} ${x} ${y}`;
  const parts = [`M ${sL} ${1 + r}`, arc(1, sL + r, 1), `H ${sR - r}`, arc(1, sR, 1 + r)];
  if (sR < tR) parts.push(`V ${j - r}`, arc(0, sR + r, j), `H ${tR - r}`, arc(1, tR, j + r));
  parts.push(`V ${b - r}`, arc(1, tR - r, b), `H ${tL + r}`, arc(1, tL, b - r));
  if (sL > tL) parts.push(`V ${j + r}`, arc(1, tL + r, j), `H ${sL - r}`, arc(0, sL, j - r));
  parts.push('Z');
  return { d: parts.join(' '), top: j, height: j + trayHeight(g, n) };
}
