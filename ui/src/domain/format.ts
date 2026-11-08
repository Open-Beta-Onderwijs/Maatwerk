// SPDX-License-Identifier: AGPL-3.0-or-later

// Number formatting for the UI (R-01): decimal comma everywhere. One rounding: exact half-up, in
// the core (decision 3, quirk B8).

import { round0, round1 } from './core';

/** Shown for a missing grade. */
export const NO_GRADE = '—';

function comma(s: string): string {
  return s.replace('.', ',');
}

/** A grade: one decimal, always (`7,0`), comma; `—` when there is none. */
export function formatGrade(g: number | null | undefined): string {
  if (g === null || g === undefined || !Number.isFinite(g)) return NO_GRADE;
  return comma(round1(g).toFixed(1));
}

/** A statistic (mean, SD, a percentage or a limit) with a fixed number of decimals, comma. */
export function formatFixed(x: number, digits = 1): string {
  if (digits === 1) return comma(round1(x).toFixed(1));
  if (digits === 0) return round0(x).toFixed(0);
  return comma(x.toFixed(digits));
}

/** A stored value (weging, n-term, score) as written, with a comma: `0,5`, `2`. */
export function formatNumber(x: number | string): string {
  return comma(String(x));
}

/** Whole numbers without decimals, others with one (`2`, `1,5`). */
export function formatCompact(n: number): string {
  return Number.isInteger(n) ? String(n) : formatFixed(n, 1);
}

/** Strict parse of a typed number with a comma or a dot; NaN when it is not one. */
export function parseDecimal(s: unknown): number {
  return Number(String(s).trim().replace(',', '.'));
}

/** Lenient parse (`parseFloat`): reads the leading number, `7,5 p` gives 7.5. */
export function parseDecimalLoose(s: unknown): number {
  return parseFloat(String(s).replace(',', '.'));
}
