// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_DEFAULTS,
  aiSchoolEnabled,
  compileTimeoutSeconds,
  settingProblem,
  snapshotLabel,
  snapshotSettings,
} from './instellingen';
import { checkedLine, folderOf } from './gegevens';

describe('Instellingen: the school AI switch (step 32c)', () => {
  it('is on unless ai.enabled is false, as maatwerk_core::ai::school', () => {
    expect(aiSchoolEnabled(null)).toBe(true);
    expect(aiSchoolEnabled({})).toBe(true);
    expect(aiSchoolEnabled({ ai: { enabled: true } })).toBe(true);
    expect(aiSchoolEnabled({ ai: { enabled: 'nee' } })).toBe(true);
    expect(aiSchoolEnabled({ ai: { enabled: false } })).toBe(false);
  });
});

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
