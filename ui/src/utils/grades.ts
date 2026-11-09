// SPDX-License-Identifier: AGPL-3.0-or-later

// Grade groups (histogram buckets) and small grade HTML helpers. Colours are in
// domain/grade-colors.ts, number formats in domain/format.ts.

import { coreCall } from '../domain/core';
import { formatFixed, formatGrade } from '../domain/format';
import { gradeBarColor, gradeTextColor, isFail } from '../domain/grade-colors';

export const GRADE_GROUP_LABELS = ['<4', '4–5', '5–6', '6–7', '7–8', '≥8'];
export const GRADE_GROUP_MIDPOINTS = [2.5, 4.5, 5.5, 6.5, 7.5, 9.0];

export const gradeGroupIdx = (g: number): number => coreCall('gradeGroup', g);

/** A grade pill (design spec 2.3): bar-coloured border, text colour, bold fails. */
export function gradePillHtml(g: number | null, extraClass = ''): string {
  const fail = g !== null && isFail(g) ? ' grade-pill--fail' : '';
  const cls = `grade-pill${fail}${extraClass ? ' ' + extraClass : ''}`;
  return `<span class="${cls}" data-border-color="${gradeBarColor(g)}" data-color="${gradeTextColor(g)}">${formatGrade(g)}</span>`;
}

/** A small filled circle in the grade's bar colour. */
export function gradeDotHtml(g: number): string {
  return `<svg width="10" height="10" viewBox="0 0 10 10" class="stat-dot"><circle cx="5" cy="5" r="5" fill="${gradeBarColor(g)}"/></svg>`;
}

/** Mean ± SD and % onvoldoende, with a dot in the mean's colour. */
export function gradeStatHtml({
  mean,
  sd,
  fails,
}: {
  mean: number;
  sd: number;
  fails: number;
}): string {
  return (
    `<span class="muted stat-line">` +
    `${gradeDotHtml(mean)}${formatFixed(mean)} ± ${formatFixed(sd)}` +
    ` &nbsp;·&nbsp; ${fails}% onvoldoende</span>`
  );
}
