// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isoWeek, snapshotKinds } from './mock-snapshots';

// The same example as maatwerk-core's `each_kept_snapshot_has_the_first_rule_that_keeps_it`.
describe('Aanwezige snapshots (step 28, spec 4.9)', () => {
  it('ISO weeks start on Monday; 1 January can be in the last week of the year before', () => {
    expect(isoWeek(new Date(2026, 10, 2))).toBe('2026-45'); // Monday
    expect(isoWeek(new Date(2026, 10, 8))).toBe('2026-45'); // Sunday
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-53');
  });

  it('names each kept snapshot by the first rule that keeps it, as maatwerk-core::snapshots::kinds', () => {
    const names = [
      '2026-11-04 1118.zip',
      '2026-11-04 0900.zip', // same day, older: only kept by nothing
      '2026-11-03 0842.zip',
      '2026-10-28 0905.zip',
      '2026-09-15 0812.zip',
    ];
    const kinds = snapshotKinds(names, { intervalHours: 24, daily: 2, weekly: 2, monthly: 3 });
    expect([...kinds.values()]).toEqual([
      'dagelijks',
      null,
      'dagelijks',
      'wekelijks',
      'maandelijks',
    ]);
  });
});
