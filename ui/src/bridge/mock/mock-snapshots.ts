// SPDX-License-Identifier: AGPL-3.0-or-later

// The mock's copy of maatwerk-core::snapshots::kinds (spec 4.9), for listSnapshots: the
// Instellingen screen shows what the backend sends (review 26-28 m6).

import type { SnapshotSettings } from '../../domain/snapshot-settings';

/** The kind of a kept snapshot (spec 4.9), as maatwerk-core::snapshots::keep chooses them. */
export type SnapshotKind = 'dagelijks' | 'wekelijks' | 'maandelijks';

function snapshotTime(name: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})/.exec(name);
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) : null;
}

/** ISO 8601 week as "year-week" (weeks start on Monday; week 1 holds 4 January). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-${week}`;
}

/**
 * Per snapshot name: dagelijks, wekelijks or maandelijks, the first of these
 * that keeps it (the newest of each of the last `daily` days, `weekly` ISO
 * weeks and `monthly` months); null for one kept only as the newest.
 */
export function snapshotKinds(
  names: string[],
  settings: SnapshotSettings,
): Map<string, SnapshotKind | null> {
  const dated = names
    .map((name) => ({ name, t: snapshotTime(name) }))
    .filter((s): s is { name: string; t: Date } => s.t !== null)
    .sort((a, b) => b.t.getTime() - a.t.getTime());
  const newestPer = (count: number, key: (t: Date) => string) => {
    const seen = new Set<string>();
    const keep = new Set<string>();
    for (const s of dated) {
      if (seen.size >= count) break;
      const k = key(s.t);
      if (!seen.has(k)) {
        seen.add(k);
        keep.add(s.name);
      }
    }
    return keep;
  };
  const daily = newestPer(settings.daily, (t) => t.toDateString());
  const weekly = newestPer(settings.weekly, isoWeek);
  const monthly = newestPer(settings.monthly, (t) => `${t.getFullYear()}-${t.getMonth()}`);
  return new Map(
    names.map((n) => [
      n,
      daily.has(n)
        ? 'dagelijks'
        : weekly.has(n)
          ? 'wekelijks'
          : monthly.has(n)
            ? 'maandelijks'
            : null,
    ]),
  );
}
