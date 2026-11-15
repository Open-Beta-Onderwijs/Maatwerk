// SPDX-License-Identifier: AGPL-3.0-or-later

// Histogram of grades (design spec 3.10, PLAN-2 decision 30): the bins of
// `maatwerk-grades::histogram` (step 1 from 0,5; step 0,5 from 1,0), a count above every bar (0
// muted), the grade colour of the bin centre, an empty bin as a 2 px line and a dashed line at
// the 5,5 boundary. The Stapgrootte toggle belongs to "Alle leerlingen" histograms only.

import { formatFixed } from '../domain/format';
import { gradeBarColor } from '../domain/grade-colors';
import { histogram } from '../domain/statistics';
import { esc } from '../utils/html';

export type HistStep = 0.5 | 1;

export interface HistBar {
  n: number;
  /** Bar height in px (2 for an empty bin). */
  height: number;
  /** Bar colour (hex); null for an empty bin (the border colour). */
  color: string | null;
  /** Axis label: "<1,5" ... "≤10,0". */
  label: string;
  /** Tooltip: "≥5,5 en <6,0: 3". */
  title: string;
}

export interface HistModel {
  bars: HistBar[];
  /** Left of the 5,5 line, in percent of the bar area. */
  passPct: number;
}

/** Room above the highest bar for its count. */
const COUNT_ROOM = 26;

/** The bars of a histogram `height` px high. */
export function histogramModel(grades: number[], step: HistStep, height: number): HistModel {
  const { bins, upper, passBin } = histogram(grades, step);
  const start = step === 0.5 ? 1.0 : 0.5;
  const max = Math.max(1, ...bins);
  const label = (i: number) => (i === upper.length - 1 ? '≤' : '<') + formatFixed(upper[i]!);
  const bars = bins.map((n, i) => ({
    n,
    height: n ? Math.round((n / max) * (height - COUNT_ROOM)) + 6 : 2,
    color: n ? gradeBarColor(start + (i + 0.5) * step) : null,
    label: label(i),
    title: `${i ? `≥${formatFixed(upper[i - 1]!)} en ` : ''}${label(i)}: ${n}`,
  }));
  return { bars, passPct: (passBin / bins.length) * 100 };
}

export interface HistogramOptions {
  /** Bar area height in px (100 on small cards, 160 for "Alle leerlingen"). */
  height?: number;
  /** aria-label of the chart. */
  label: string;
}

/** The chart: bars with counts, the 5,5 line and the axis labels. */
export function histogramHtml(model: HistModel, { height = 100, label }: HistogramOptions): string {
  const bars = model.bars
    .map(
      (b) =>
        `<div class="ov-hist__col"><span class="ov-hist__n${b.n ? '' : ' ov-hist__n--zero'}">${b.n}</span>` +
        `<div class="ov-hist__bar${b.color ? '' : ' ov-hist__bar--empty'}" title="${esc(b.title)}" data-h="${b.height}px"${b.color ? ` data-bg="${b.color}"` : ''}></div></div>`,
    )
    .join('');
  const labels = model.bars.map((b) => `<span>${esc(b.label)}</span>`).join('');
  return (
    `<div class="ov-hist">` +
    `<div class="ov-hist__plot"><div class="ov-hist__bars" role="img" aria-label="${esc(label)}" data-h="${height}px">${bars}</div>` +
    `<div class="ov-pass-line ov-hist__pass" title="Grens voldoende: 5,5" data-left="${model.passPct.toFixed(2)}%"></div></div>` +
    `<div class="ov-hist__labels">${labels}</div></div>`
  );
}

/** The "Stapgrootte: 0,5 punten / 1 punt" toggle (default 0,5). */
export function stepToggleHtml(step: HistStep): string {
  const btn = (v: HistStep, text: string) =>
    `<button type="button" class="tog-btn hist-bin-btn${step === v ? ' selected' : ''}" data-bin="${v}" aria-pressed="${step === v}">${text}</button>`;
  return (
    `<div class="ov-step"><span class="ov-step__label">Stapgrootte:</span>` +
    `<div class="btn-toggle-group">${btn(0.5, '0,5 punten')}${btn(1, '1 punt')}</div></div>`
  );
}
