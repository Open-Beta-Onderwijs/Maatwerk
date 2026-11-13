// SPDX-License-Identifier: AGPL-3.0-or-later

// Markup of the grade parts of the student and group cards (F-07, F-08, F-09;
// design spec 4.3, 4.4, board 1). Colours go through data attributes
// (legacy/style-data.ts): strict CSP, no style attributes.

import {
  FAILS_ALARM,
  TREND_WORDS,
  type GroupCardNumbers,
  type StudentCardNumbers,
} from '../../domain/cards';
import { formatFixed, formatGrade } from '../../domain/format';
import { GRADE_BAR, gradeBarColor, gradeTextColor } from '../../domain/grade-colors';
import type { Stats } from '../../domain/statistics';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Bar height (px) for a grade: proportional, 28 px for a 10, at least 3. */
export function barHeight(grade: number): number {
  return Math.max(3, Math.round((28 * Math.min(Math.max(grade, 0), 10)) / 10));
}

const ARROW = `<svg class="trend-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
  role="img" aria-label="LABEL"><path d="M4 12h15M13 6l6 6-6 6"/></svg>`;

/** The trend arrow (spec 2.4): rotated and coloured by level, labelled. */
export function trendArrowHtml(level: keyof typeof TREND_WORDS): string {
  return ARROW.replace('LABEL', `Trend: ${TREND_WORDS[level]}`).replace(
    'class="trend-arrow"',
    `class="trend-arrow trend-arrow--${level}"`,
  );
}

function gradeB(g: number): string {
  return `<b data-color="${gradeTextColor(g)}">${formatGrade(g)}</b>`;
}

/**
 * The right part of a student card: bars, year average with the trend, and
 * "laatste X,X" (upper school: alternating with "SE X,X").
 */
export function studentGradesHtml(n: StudentCardNumbers): string {
  if (n.average === null && n.se === null)
    return `<span class="s-card__none">Nog geen cijfers</span>`;
  if (n.average === null)
    // No grade this year yet, but an SE from earlier years (review 26-28 m5).
    return `<span class="s-card__nums"><span class="s-card__small">SE ${gradeB(n.se!)}</span></span>`;
  const bars = n.bars
    .map(
      (b) =>
        `<span class="s-card__bar" title="${esc(b.title)}" data-h="${barHeight(b.grade)}px"` +
        ` data-bg="${b.diagnostic ? GRADE_BAR.diagnostic : gradeBarColor(b.grade)}"></span>`,
    )
    .join('');
  const barsLabel = `Cijfers: ${n.bars.map((b) => formatGrade(b.grade)).join(', ')}`;
  const last = n.last === null ? '' : `laatste ${gradeB(n.last)}`;
  const se = n.se === null ? '' : `SE ${gradeB(n.se)}`;
  const both = [
    n.last === null ? '' : `Laatste ${formatGrade(n.last)}`,
    se ? `SE ${formatGrade(n.se!)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const small =
    se && last
      ? // Years 4-6 (spec 4.3): the two alternate; reduced motion shows both on one line.
        `<span class="s-card__swap" title="${esc(both)}">
          <span class="s-card__swap-a">${last}</span>
          <span class="s-card__swap-b">${se}</span>
          <span class="s-card__swap-both">${last} · ${se}</span>
        </span>`
      : `<span class="s-card__small" title="${esc(both)}">${last || se}</span>`;
  return `
    <span class="s-card__bars" role="img" aria-label="${esc(barsLabel)}">${bars}</span>
    <span class="s-card__nums">
      <span class="s-card__avg" title="Jaargemiddelde">
        ${n.trend ? trendArrowHtml(n.trend.level) : ''}
        <span class="s-card__avg-value" data-color="${gradeTextColor(n.average)}">${formatGrade(n.average)}</span>
      </span>
      ${small}
    </span>`;
}

function failsHtml(s: Stats): string {
  const alarm = s.fails >= FAILS_ALARM ? ' g-card__fails--alarm' : '';
  return `<span class="g-card__fails${alarm}">${s.fails}% onvoldoende</span>`;
}

function meanSd(s: Stats, label = ''): string {
  const tag = label ? `<span class="g-card__tag">${label}</span> ` : '';
  return (
    `${tag}<b class="g-card__mean" data-color="${gradeTextColor(s.mean)}">${formatFixed(s.mean)}</b>` +
    ` <span class="g-card__sd">± ${formatFixed(s.sd)}</span>`
  );
}

/**
 * The right part of a group card: lower school "7,6 ± 1,4" and the
 * onvoldoende line; upper school (variant B) "SE … · R …" on one line.
 */
export function groupGradesHtml(n: GroupCardNumbers): string {
  if (!n.year && !n.se) return '';
  const fails = n.year ?? n.se!;
  if (!n.se || !n.year) {
    const s = (n.year ?? n.se)!;
    return `<span class="g-card__line">${meanSd(s, n.year ? '' : 'SE')}</span>${failsHtml(fails)}`;
  }
  return (
    `<span class="g-card__line">${meanSd(n.se, 'SE')} <span class="g-card__sd">·</span> ${meanSd(n.year, 'R')}</span>` +
    failsHtml(fails)
  );
}
