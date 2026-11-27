// SPDX-License-Identifier: AGPL-3.0-or-later

// Question changes after scores (edit-locks.md decision 11): a max or soort change asks first,
// and a max below a score already entered for that question is refused. Raw entered points only,
// no grade numbers.

import { formatNumber } from './format';

type Rec = { scores?: Record<string, Record<string, unknown> | undefined> } | null | undefined;

/** The highest score entered per question of `exam` over the records ("N" and blanks skip). */
export function highestEntered(records: readonly Rec[], exam: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    for (const [q, v] of Object.entries(r?.scores?.[exam] ?? {})) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[q] = Math.max(out[q] ?? 0, v);
    }
  }
  return out;
}

/** Why a max of `pts` points is refused for question `id`, or null. */
export function maxRefusal(
  highest: Readonly<Record<string, number>>,
  id: string,
  pts: number,
): string | null {
  const top = highest[id];
  if (top === undefined || pts >= top) return null;
  return `Er is al een score van ${formatNumber(top)} ingevoerd voor deze vraag: het maximum kan niet lager.`;
}

/** The question asked once per editor before a max or soort change after scores. */
export const CHANGE_AFTER_SCORES =
  'Er zijn al scores ingevoerd voor deze toets. Als je het maximum of de soort van een vraag verandert, veranderen de cijfers. Wil je doorgaan?';
