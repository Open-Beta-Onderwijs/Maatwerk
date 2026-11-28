// SPDX-License-Identifier: AGPL-3.0-or-later

// The snapshot settings in `instellingen.json` (maatwerk-core::snapshots::Settings), shared by
// the Instellingen screen and the mock backend. Pure.

export interface SnapshotSettings {
  intervalHours: number;
  daily: number;
  weekly: number;
  monthly: number;
}

/** maatwerk-core::snapshots::Settings::default. */
export const SNAPSHOT_DEFAULTS: SnapshotSettings = {
  intervalHours: 24,
  daily: 7,
  weekly: 4,
  monthly: 12,
};

/** Allowed ranges, as maatwerk-core::snapshots::Settings::from_json checks them. */
export const SNAPSHOT_LIMITS: Record<keyof SnapshotSettings, [number, number]> = {
  intervalHours: [1, 24 * 31],
  daily: [0, 366],
  weekly: [0, 520],
  monthly: [0, 1200],
};

/** The settings in `instellingen.json`, with the defaults for what is missing or out of range. */
export function snapshotSettings(instellingen: unknown): SnapshotSettings {
  const s = (instellingen as { snapshots?: Record<string, unknown> } | null)?.snapshots ?? {};
  const out = { ...SNAPSHOT_DEFAULTS };
  for (const key of Object.keys(SNAPSHOT_LIMITS) as (keyof SnapshotSettings)[]) {
    const v = s[key];
    const [min, max] = SNAPSHOT_LIMITS[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) out[key] = v;
  }
  return out;
}
