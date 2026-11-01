// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_DEFAULTS,
  compileTimeoutSeconds,
  settingProblem,
  snapshotLabel,
  snapshotSettings,
} from './instellingen';

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
