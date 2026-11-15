// SPDX-License-Identifier: AGPL-3.0-or-later

// Boxplots (design spec 3.10, PLAN-2 decision 31): a row per set, the box Q1-Q3 in the test's
// type colour (striped for a PO, grey for a diagnostic test), the median, whiskers to min and
// max, every student a dot (tooltip name and grade), a dashed 5,5 line and an axis 1-10.

import { formatGrade } from '../domain/format';
import { PASS } from '../domain/grade-colors';
import { boxStats } from '../domain/statistics';
import type { TestKind } from '../domain/test-type';
import { esc } from '../utils/html';
import { axisPct, kindClass } from './common';

export interface BoxPoint {
  name: string;
  grade: number;
}

export interface BoxRow {
  /** The label (badge and title, or "Alle leerlingen"), as HTML; the caller escapes it. */
  labelHtml: string;
  kind: TestKind;
  points: BoxPoint[];
}

const pct = (g: number) => axisPct(g).toFixed(2);

function rowHtml(r: BoxRow): string {
  const box = boxStats(r.points.map((p) => p.grade));
  const label = `<div class="ov-box__label">${r.labelHtml}</div>`;
  if (!box) {
    return `<div class="ov-box__row">${label}<div class="ov-box__plot"><div class="ov-pass-line" data-left="${pct(PASS)}%"></div></div><span class="ov-box__med">Nog geen cijfers</span></div>`;
  }
  const range = Math.max(0.4, axisPct(box.max) - axisPct(box.min));
  const iqr = Math.max(0.8, axisPct(box.q3) - axisPct(box.q1));
  const boxTitle = `Kwartielen ${formatGrade(box.q1)} – ${formatGrade(box.q3)}, mediaan ${formatGrade(box.median)}`;
  const dots = r.points
    .map(
      (p, i) =>
        `<div class="ov-box__dot" title="${esc(`${p.name}: ${formatGrade(p.grade)}`)}" data-left="${pct(p.grade)}%" data-top="${6 + (i % 4) * 8}px"></div>`,
    )
    .join('');
  return (
    `<div class="ov-box__row ${kindClass(r.kind)}">${label}<div class="ov-box__plot">` +
    `<div class="ov-pass-line" data-left="${pct(PASS)}%"></div>` +
    `<div class="ov-box__whisker" data-left="${pct(box.min)}%" data-w="${range.toFixed(2)}%"></div>` +
    `<div class="ov-box__cap" data-left="${pct(box.min)}%"></div><div class="ov-box__cap" data-left="${pct(box.max)}%"></div>` +
    `<div class="ov-box__box" title="${esc(boxTitle)}" data-left="${pct(box.q1)}%" data-w="${iqr.toFixed(2)}%"></div>` +
    `<div class="ov-box__median" data-left="${(axisPct(box.median) - 0.15).toFixed(2)}%"></div>` +
    `${dots}</div><span class="ov-box__med">mediaan <b>${formatGrade(box.median)}</b></span></div>`
  );
}

/** The legend, a row per set and the 1-10 axis. */
export function boxplotHtml(rows: BoxRow[]): string {
  const legend =
    `<div class="ov-box__legend">` +
    `<span><span class="ov-box__key-box"></span>kwartielen en mediaan (kleur = toetssoort)</span>` +
    `<span><span class="ov-box__key-dot"></span>leerling</span>` +
    `<span><span class="ov-box__key-pass"></span>5,5</span></div>`;
  const axis = Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join('');
  return (
    `${legend}<div class="ov-box">${rows.map(rowHtml).join('')}` +
    `<div class="ov-box__axis-row"><div class="ov-box__label"></div><div class="ov-box__axis">${axis}</div><span class="ov-box__med"></span></div></div>`
  );
}
