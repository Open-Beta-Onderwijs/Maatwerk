// SPDX-License-Identifier: AGPL-3.0-or-later

// Number formatting for the UI (R-01): decimal comma everywhere. One rounding: exact half-up, in
// the core (decision 3, quirk B8).

import { round0, round1 } from './core';
import type { AverageFormat } from './statistics';

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

/**
 * A student average as shown (Cijfergemiddelden, decisions 91-93): `shown` is already the core's
 * value under `fmt` (`Shown.shown`), so this only writes its decimals: `5`, `5,5`, `5,50`.
 */
export function formatShown(shown: number | null | undefined, fmt: AverageFormat): string {
  if (shown === null || shown === undefined || !Number.isFinite(shown)) return NO_GRADE;
  return comma(shown.toFixed(fmt.decimalen));
}

/** The hover text of a shown average (decision 93): "Afgerond op 1 decimaal". */
export function formatHint(fmt: AverageFormat): string {
  const how = fmt.methode === 'afkappen' ? 'Afgekapt' : 'Afgerond';
  return `${how} op ${fmt.decimalen} ${fmt.decimalen === 1 ? 'decimaal' : 'decimalen'}`;
}

/** The hover text of a group mean of shown averages (decision 93). */
export const GROUP_MEAN_HINT = 'Gemiddelde van de getoonde cijfers, afgerond op 1 decimaal';

/** A stored value (weging, n-term, score) as written, with a comma: `0,5`, `2`. */
export function formatNumber(x: number | string): string {
  return comma(String(x));
}

/** "412 kB", "31,4 MB", "2,1 GB" (decimal comma). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 ** 3) return `${formatNumber(Math.round((bytes / 1024 ** 2) * 10) / 10)} MB`;
  return `${formatNumber(Math.round((bytes / 1024 ** 3) * 10) / 10)} GB`;
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

/** An N-term with at least one decimal, as a teacher writes it: `1,0`, `1,5`, `1,25`. */
export function formatNTerm(n: number): string {
  return Number.isInteger(n) ? formatFixed(n, 1) : formatNumber(n);
}
