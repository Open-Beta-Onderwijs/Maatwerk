// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_DEFAULTS,
  compileTimeoutSeconds,
  isoWeek,
  settingProblem,
  snapshotKinds,
  snapshotLabel,
  snapshotSettings,
} from './instellingen';
import { checkedLine, folderOf } from './gegevens';

describe('Instellingen (Step 7b)', () => {
  it('reads the snapshot settings like maatwerk-core, with defaults', () => {
    expect(snapshotSettings(null)).toEqual(SNAPSHOT_DEFAULTS);
    expect(
      snapshotSettings({ snapshots: { intervalHours: 6, daily: 3, weekly: 'x', monthly: -1 } }),
    ).toEqual({ ...SNAPSHOT_DEFAULTS, intervalHours: 6, daily: 3 });
    expect(snapshotSettings({ snapshots: { intervalHours: 0 } }).intervalHours).toBe(24);
    expect(snapshotSettings({ snapshots: { intervalHours: 1.5 } }).intervalHours).toBe(24);
  });

  it('checks typed values against the same ranges', () => {
    expect(settingProblem('intervalHours', '12')).toBeNull();
    expect(settingProblem('intervalHours', '0')).toBe(
      'Vul een heel getal van 1 tot en met 744 in.',
    );
    expect(settingProblem('daily', '0')).toBeNull();
    expect(settingProblem('daily', '1,5')).not.toBeNull();
    expect(settingProblem('monthly', '')).not.toBeNull();
  });

  it('reads the compile time limit like EditorSettings (Step 8b)', () => {
    expect(compileTimeoutSeconds(null)).toBe(30);
    expect(compileTimeoutSeconds({ editor: { compileTimeoutSeconds: 5 } })).toBe(5);
    for (const bad of [1, 301, 2.5, '10', null]) {
      expect(compileTimeoutSeconds({ editor: { compileTimeoutSeconds: bad } })).toBe(30);
    }
    expect(settingProblem('compileTimeoutSeconds', '300')).toBeNull();
    expect(settingProblem('compileTimeoutSeconds', '1')).toBe(
      'Vul een heel getal van 2 tot en met 300 in.',
    );
  });

  it('shows snapshot names as Dutch dates', () => {
    expect(snapshotLabel('2026-10-31 0815.zip')).toBe('31-10-2026 08:15');
    expect(snapshotLabel('2026-10-31 0815 (2).zip')).toBe('31-10-2026 08:15');
    expect(snapshotLabel('raar.zip')).toBe('raar.zip');
  });
});

describe('Aanwezige snapshots (step 28, spec 4.9)', () => {
  it('ISO weeks start on Monday; 1 January can be in the last week of the year before', () => {
    expect(isoWeek(new Date(2026, 10, 2))).toBe('2026-45'); // Monday
    expect(isoWeek(new Date(2026, 10, 8))).toBe('2026-45'); // Sunday
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-53');
  });

  it('names each kept snapshot by the first rule that keeps it, as maatwerk-core::keep', () => {
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

describe('Gegevenscontrole cards (step 28)', () => {
  it('opens the folder of a finding', () => {
    expect(folderOf('2026-2027/scores/nat/106052.json')).toBe('2026-2027/scores/nat');
    expect(folderOf('school.json')).toBe('');
  });

  it('says how many files were checked and when', () => {
    expect(checkedLine(238, new Date(2026, 10, 4, 11, 8))).toBe(
      '238 bestanden gecontroleerd · vandaag om 11:08',
    );
    expect(checkedLine(1, new Date(2026, 10, 4, 9, 30))).toContain('1 bestand gecontroleerd');
  });
});
