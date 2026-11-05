// SPDX-License-Identifier: AGPL-3.0-or-later

// Number formatting for the UI (R-01, quirk B8): decimal comma everywhere.
//
// Two rounding paths exist on purpose, as before this module: `formatGrade`
// rounds the product (`Math.round(x * 10) / 10`), `formatFixed` uses
// `toFixed`, which rounds the binary value. They can differ at x.x5 (quirk
// B8). Unifying them changes shown numbers, so it waits for step 19 (domain
// logic in maatwerk-core) with a before/after table; until then every caller
// keeps the path it had.

/** Shown for a missing grade. */
export const NO_GRADE = '—';

function comma(s: string): string {
  return s.replace('.', ',');
}

/**
 * A grade: one decimal, always (`7,0`), comma; `—` when there is none.
 * Rounds `Math.round(g * 10) / 10` (the grade-system rounding).
 */
export function formatGrade(g: number | null | undefined): string {
  if (g === null || g === undefined || !Number.isFinite(g)) return NO_GRADE;
  return comma((Math.round(g * 10) / 10).toFixed(1));
}

/**
 * A statistic (mean, SD, percentage bound) with a fixed number of decimals,
 * rounded by `toFixed`, comma.
 */
export function formatFixed(x: number, digits = 1): string {
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
