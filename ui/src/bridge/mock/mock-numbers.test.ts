// SPDX-License-Identifier: AGPL-3.0-or-later

// The mock backend's `vakNumbers` (the TS mirror of maatwerk_core::numbers). Its numbers are
// checked against Rust by tools/numbers-parity.mjs; here the contract and the setting.

import { describe, expect, it } from 'vitest';
import seed from 'virtual:maatwerk-fixtures';
import { MockApi } from './mock-api';
import { shownAverage } from '../../domain/statistics';

const YEAR = '2025-2026';

describe('MockApi vakNumbers', () => {
  it('refuses a year or vak that is not a plain name', async () => {
    const api = new MockApi(seed);
    await expect(api.vakNumbers('../x', 'nat')).rejects.toThrow(/Geen geldig/);
    await expect(api.vakNumbers(YEAR, 'a/b')).rejects.toThrow(/Geen geldig/);
  });

  it('gives every student of the year, the exams and the groups of the vak', async () => {
    const api = new MockApi(seed);
    const n = await api.vakNumbers(YEAR, 'nat');
    expect(n.formats.r).toEqual({ methode: 'afronden', decimalen: 1 });
    expect(Object.keys(n.students).length).toBeGreaterThan(0);
    expect(Object.keys(n.exams).length).toBeGreaterThan(0);
    expect(Object.keys(n.groups).length).toBeGreaterThan(0);
    const withAverage = Object.values(n.students).filter((s) => s.average);
    expect(withAverage.length).toBeGreaterThan(0);
    for (const s of withAverage) expect(s.average!.shown).toBe(shownAverage(s.average!.raw));
  });

  it('shows the averages under the school setting', async () => {
    const api = new MockApi(seed);
    const inst = ((await api.readJson('instellingen.json')) ?? {}) as Record<string, unknown>;
    await api.writeJson('instellingen.json', {
      ...inst,
      gemiddelden: { r: { methode: 'afkappen', decimalen: 0 } },
    } as never);
    const n = await api.vakNumbers(YEAR, 'nat');
    expect(n.formats.r).toEqual({ methode: 'afkappen', decimalen: 0 });
    for (const s of Object.values(n.students)) {
      if (!s.average) continue;
      expect(s.average.shown).toBe(
        shownAverage(s.average.raw, { methode: 'afkappen', decimalen: 0 }),
      );
      expect(Number.isInteger(s.average.shown)).toBe(true);
      expect(s.average.fails).toBe(s.average.shown < 5.5);
    }
  });
});

describe('MockApi: only the admin changes the Cijfergemiddelden (rights, step 38)', () => {
  it('refuses a teacher, lets other settings through', async () => {
    const api = new MockApi(seed);
    await api.setFirstPin('gebr-1756713600001', '12345');
    const inst = ((await api.readJson('instellingen.json')) ?? {}) as Record<string, unknown>;
    const refused = await api.writeJson('instellingen.json', {
      ...inst,
      gemiddelden: { r: { methode: 'afkappen', decimalen: 0 } },
    } as never);
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { reason: string }).reason).toMatch(/Alleen de beheerder/);
    const other = await api.writeJson('instellingen.json', {
      ...inst,
      editor: { compileTimeoutSeconds: 60 },
    } as never);
    expect(other).toMatchObject({ ok: true });
  });
});
