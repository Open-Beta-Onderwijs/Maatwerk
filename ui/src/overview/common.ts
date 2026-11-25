// SPDX-License-Identifier: AGPL-3.0-or-later

// Small parts shared by the overview charts and tables (design spec 3.10, step 29): the test
// badge, the grade pill of the overviews, the axis position of a grade and the "gem. ± SD"
// line. Values computed at render time go through the style data attributes (the CSP forbids
// style="", legacy/style-data.ts).

import { attemptCode } from '../domain/exam-info';
import { formatFixed, formatGrade, formatHint, formatShown } from '../domain/format';
import {
  GRADE_BAR,
  gradeBarColor,
  gradeTextColor,
  isFail,
  shownTextColor,
} from '../domain/grade-colors';
import type { Shown } from '../domain/numbers';
import { testBadgeClass, testKind, type TestKind } from '../domain/test-type';
import { pct, type AverageFormat, type Stats } from '../domain/statistics';
import type { Exam } from '../domain/types';
import { esc } from '../utils/html';

/** The type badge of a test (spec 2.5), with an optional tooltip. */
export function examBadgeHtml(exam: Exam, title?: string): string {
  const t = title ? ` title="${esc(title)}"` : '';
  return `<span class="${testBadgeClass(exam)}"${t}>${esc(attemptCode(exam))}</span>`;
}

/** The kind class of a chart part in the test's type colour (`ov-kind--se`, ...). */
export function kindClass(kind: TestKind): string {
  return `ov-kind--${kind}`;
}

export { testKind };

/**
 * A grade pill of the overviews (board 45): `—` muted for no grade, grey italic for a diagnostic
 * test (it counts for nothing), bold below 5,5.
 */
export function ovPillHtml(g: number | null, diagnostic = false): string {
  if (g === null) return '<span class="ov-pill ov-pill--none">—</span>';
  if (diagnostic) return `<span class="ov-pill ov-pill--diag">${formatGrade(g)}</span>`;
  const fail = isFail(g) ? ' ov-pill--fail' : '';
  return `<span class="ov-pill${fail}" data-border-color="${gradeBarColor(g)}" data-color="${gradeTextColor(g)}">${formatGrade(g)}</span>`;
}

/**
 * The pill of a student average as shown (decisions 91-93): the core's value with the format's
 * decimals, red from its fail flag, the format in the hover text.
 */
export function ovShownPillHtml(s: Shown | null, fmt: AverageFormat): string {
  if (s === null) return '<span class="ov-pill ov-pill--none">—</span>';
  const fail = s.fails ? ' ov-pill--fail' : '';
  const border = s.fails ? GRADE_BAR.fail : gradeBarColor(s.shown);
  return `<span class="ov-pill${fail}" title="${esc(formatHint(fmt))}" data-border-color="${border}" data-color="${shownTextColor(s)}">${formatShown(s.shown, fmt)}</span>`;
}

/** Position of a grade on a 1-10 axis, in percent (clamped). */
export function axisPct(g: number): number {
  return Math.max(0, Math.min(100, ((g - 1) / 9) * 100));
}

/** "gem. 6,4 ± 1,4 · 30% onvoldoende", the mean in its grade colour (spec 3.10). */
export function meanLineHtml(s: Stats | null): string {
  if (!s) return '<span class="ov-meanline">Nog geen cijfers</span>';
  return (
    `<span class="ov-meanline">gem. <b data-color="${gradeTextColor(s.mean)}">${formatFixed(s.mean)}</b>` +
    ` ± ${formatFixed(s.sd)} · ${s.fails}% onvoldoende</span>`
  );
}

/** "1 leerling" / "12 leerlingen". */
export function studentCount(n: number): string {
  return `${n} ${n === 1 ? 'leerling' : 'leerlingen'}`;
}

/** A whole percentage of `n` out of `of` (0 when `of` is 0). */
export function pctOf(n: number, of: number): number {
  return pct(n, of);
}

/** A tab or card whose data could not be read (review 29 m3). */
export const LOAD_FAILED = 'Kon de gegevens niet laden. Sluit het venster en probeer het opnieuw.';

/** The empty state of a tab or card. */
export function emptyHtml(text: string): string {
  return `<p class="ov-empty hint">${esc(text)}</p>`;
}
