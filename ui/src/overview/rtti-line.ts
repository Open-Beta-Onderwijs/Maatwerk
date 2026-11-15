// SPDX-License-Identifier: AGPL-3.0-or-later

// RTTI-verloop (design spec 3.10, PLAN-2 decision 32): one point per test in test order (PO's are
// left out by the caller, with a note), the test badges on the x-axis, a y-axis 0-100 %, dashed
// lines, a dot per value with its percentage always shown right of it. Per test the four labels
// are sorted and pushed apart to at least 14 px; the stack moves up if it would cross the axis.
// The current test gets an accent-tint band (the exam overview).

import type { RttiCategory } from '../domain/grades';
import { RTTI_CATS, RTTI_HEX, RTTI_NAMES } from '../domain/rtti-names';
import type { Exam } from '../domain/types';
import { esc } from '../utils/html';
import { examBadgeHtml } from './common';

export interface RttiLinePoint {
  exam: Exam;
  /** R, T1, T2, I in percent; null where the test has no such points. */
  pcts: (number | null)[];
}

/** Least distance between two labels of one test, in px. */
export const LABEL_GAP = 14;
const LABEL_H = 14;

/**
 * Label tops for values drawn at `ys` (dot centres): each label centred on its dot, then pushed
 * down to keep `gap` px between labels, and the whole stack moved up if it would end below
 * `bottom`. Returned in the order of `ys`.
 */
export function spreadLabels(ys: readonly number[], bottom: number, gap = LABEL_GAP): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const out = new Array<number>(ys.length);
  let prev = -Infinity;
  for (const { y, i } of order) {
    const top = Math.max(y - LABEL_H / 2, prev + gap);
    out[i] = top;
    prev = top;
  }
  const over = prev + gap - bottom;
  if (over > 0) for (let i = 0; i < out.length; i++) out[i]! -= over;
  return out;
}

export interface RttiLineDot {
  cat: RttiCategory;
  cx: number;
  cy: number;
  r: number;
  /** Label position (left, top) in px. */
  lx: number;
  ly: number;
  value: number;
  tip: string;
}

export interface RttiLineModel {
  W: number;
  H: number;
  x0: number;
  x1: number;
  yt: number;
  yb: number;
  grid: { y: number; label: string }[];
  lines: { cat: RttiCategory; points: string }[];
  dots: RttiLineDot[];
  /** Badge centre per test, in percent of the width. */
  codes: { leftPct: number; exam: Exam }[];
  /** The band behind the current test, if it is in the chart. */
  highlight: { x: number; y: number; w: number; h: number } | null;
}

export function rttiLineModel(
  points: readonly RttiLinePoint[],
  W: number,
  H: number,
  currentId: string | null = null,
): RttiLineModel {
  const x0 = 52;
  const x1 = W - 28;
  const yt = 24;
  const yb = H - 36;
  // Room inside the axes (user 2026-11-15): the first and last test are not on the border; the
  // right side also holds the value labels.
  const p0 = x0 + 32;
  const p1 = x1 - 44;
  const xr = (j: number) =>
    points.length === 1 ? (p0 + p1) / 2 : p0 + (j * (p1 - p0)) / (points.length - 1);
  const yr = (v: number) => yb - (v / 100) * (yb - yt);
  const lines = RTTI_CATS.map((cat, ci) => ({
    cat,
    points: points
      .map((p, j) =>
        p.pcts[ci] == null ? null : `${xr(j).toFixed(1)},${yr(p.pcts[ci]!).toFixed(1)}`,
      )
      .filter((s): s is string => s !== null)
      .join(' '),
  }));
  const dots: RttiLineDot[] = [];
  points.forEach((p, j) => {
    const vals = RTTI_CATS.map((cat, ci) => ({ cat, v: p.pcts[ci] })).filter(
      (x): x is { cat: RttiCategory; v: number } => x.v != null,
    );
    const tops = spreadLabels(
      vals.map((x) => yr(x.v)),
      yb + 4,
    );
    const code = p.exam.volgnummer ?? '';
    const current = p.exam.id === currentId;
    vals.forEach((x, k) => {
      dots.push({
        cat: x.cat,
        cx: xr(j),
        cy: yr(x.v),
        r: current ? 6 : 4.5,
        lx: Math.round(xr(j) + 9),
        ly: Math.round(tops[k]!),
        value: x.v,
        tip: `${x.cat} ${code}: ${x.v}%`,
      });
    });
  });
  const cur = points.findIndex((p) => p.exam.id === currentId);
  return {
    W,
    H,
    x0,
    x1,
    yt,
    yb,
    grid: [0, 25, 50, 75, 100].map((v) => ({ y: yr(v), label: `${v}%` })),
    lines,
    dots,
    codes: points.map((p, j) => ({ leftPct: (xr(j) / W) * 100, exam: p.exam })),
    highlight: cur < 0 ? null : { x: xr(cur) - 22, y: yt - 8, w: 44, h: yb - yt + 16 },
  };
}

/** The legend with the names of spec 2.6. */
export function rttiLegendHtml(): string {
  return `<div class="ov-rtti-legend">${RTTI_CATS.map(
    (c) =>
      `<span><span class="ov-rtti-key ov-rtti--${c.toLowerCase()}"></span>${c} <span class="ov-rtti-legend__name">${RTTI_NAMES[c]}</span></span>`,
  ).join('')}</div>`;
}

const f1 = (x: number) => x.toFixed(1);

/** The chart (SVG, labels as SVG text; the badges as HTML under it). */
export function rttiLineHtml(m: RttiLineModel, label: string): string {
  const hl = m.highlight
    ? `<rect class="ov-rline__hl" x="${f1(m.highlight.x)}" y="${f1(m.highlight.y)}" width="${m.highlight.w}" height="${f1(m.highlight.h)}" rx="8"></rect>`
    : '';
  const grid = m.grid
    .map(
      (g) =>
        `<line class="ov-rline__grid" x1="${m.x0}" x2="${m.x1}" y1="${f1(g.y)}" y2="${f1(g.y)}"></line>` +
        `<text class="ov-rline__ylabel" x="${m.x0 - 10}" y="${f1(g.y + 4)}" text-anchor="end">${g.label}</text>`,
    )
    .join('');
  const axis = `<line class="ov-rline__axis" x1="${m.x0}" x2="${m.x0}" y1="${m.yt}" y2="${m.yb}"></line>`;
  const lines = m.lines
    .filter((l) => l.points)
    .map(
      (l) =>
        `<polyline points="${l.points}" fill="none" stroke="${RTTI_HEX[l.cat]}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" opacity="0.75"></polyline>`,
    )
    .join('');
  const dots = m.dots
    .map(
      (d) =>
        `<circle class="ov-rline__dot" cx="${f1(d.cx)}" cy="${f1(d.cy)}" r="${d.r}" fill="${RTTI_HEX[d.cat]}"><title>${esc(d.tip)}</title></circle>` +
        `<text class="ov-rline__value" x="${d.lx}" y="${d.ly + 11}" fill="${RTTI_HEX[d.cat]}">${d.value}%</text>`,
    )
    .join('');
  const codes = m.codes
    .map(
      (c) =>
        `<span class="ov-rline__code" data-left="${c.leftPct.toFixed(2)}%">${examBadgeHtml(c.exam, c.exam.title ?? '')}</span>`,
    )
    .join('');
  return (
    `<div class="ov-rline">` +
    `<svg class="ov-rline__svg" viewBox="0 0 ${m.W} ${m.H}" role="img" aria-label="${esc(label)}">${hl}${grid}${axis}${lines}${dots}</svg>` +
    `<div class="ov-rline__codes">${codes}</div></div>`
  );
}
