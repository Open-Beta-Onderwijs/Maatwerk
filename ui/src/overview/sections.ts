// SPDX-License-Identifier: AGPL-3.0-or-later

// Group sections in an overview table (design spec 3.10): a heading row per group (klas,
// projectgroep) and GEMIDDELDE and STANDAARDDEVIATIE rows directly under its students. The
// numbers are the core's (`stats` for grades of one test, `statsOfAverages` for students'
// averages, decision 21); the SD is the population SD the cards and rapport use.

import { formatFixed } from '../domain/format';
import { stats, statsOfAverages, type Stats } from '../domain/statistics';
import { esc } from '../utils/html';
import { ovPillHtml } from './common';

export interface SectionCell {
  mean: number | null;
  sd: number | null;
}

/** Mean and SD of the grades of one column (null without grades). */
export function columnStats(grades: readonly number[]): SectionCell {
  const s: Stats | null = grades.length ? stats([...grades]) : null;
  return { mean: s?.mean ?? null, sd: s?.sd ?? null };
}

/** Mean and SD of students' averages, as shown (decision 21). */
export function averagesStats(averages: readonly number[]): SectionCell {
  const s: Stats | null = averages.length ? statsOfAverages([...averages]) : null;
  return { mean: s?.mean ?? null, sd: s?.sd ?? null };
}

/** "± 1,3", or "—" without a value. */
export function sdText(sd: number | null): string {
  return sd == null ? '—' : `± ${formatFixed(sd)}`;
}

export interface FootColumn {
  cell: SectionCell;
  /** A diagnostic test: the mean grey italic (it counts for nothing). */
  diagnostic?: boolean;
  /** Extra classes on the td (the JAAR columns' background). */
  className?: string;
  /** Columns this cell spans (a grade and its dot column). */
  span?: number;
}

/**
 * The GEMIDDELDE and STANDAARDDEVIATIE rows. `lead` is the number of cells before the columns
 * (the label takes the first; the others stay empty).
 */
export function meanSdRowsHtml(columns: FootColumn[], { lead = 1 } = {}): string {
  const pad = '<td></td>'.repeat(Math.max(0, lead - 1));
  const td = (c: FootColumn, inner: string) =>
    `<td class="ov-foot__cell${c.className ? ` ${c.className}` : ''}"${c.span && c.span > 1 ? ` colspan="${c.span}"` : ''}>${inner}</td>`;
  const mean = columns.map((c) => td(c, ovPillHtml(c.cell.mean, c.diagnostic))).join('');
  const sd = columns.map((c) => td(c, esc(sdText(c.cell.sd)))).join('');
  return (
    `<tr class="ov-foot ov-foot--mean"><td class="ov-foot__label">GEMIDDELDE</td>${pad}${mean}</tr>` +
    `<tr class="ov-foot ov-foot--sd"><td class="ov-foot__label">STANDAARDDEVIATIE</td>${pad}${sd}</tr>`
  );
}

/** A heading row over a group's students ("Groep 5A · 12 leerlingen"). */
export function sectionHeadHtml(text: string, colspan: number): string {
  return `<tr class="ov-section"><th class="ov-section__head" colspan="${colspan}" scope="colgroup">${esc(text)}</th></tr>`;
}
