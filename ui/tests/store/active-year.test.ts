// SPDX-License-Identifier: AGPL-3.0-or-later

// The year the tabs open with. The reference never writes `activeYear` (it has no
// config.json at all unless someone made one), so it fell back to the current
// school year. Since Step 7a the migration and the first-run setup write
// config.json with only `schema_version`: that must fall back too, or every year
// selector opens empty (user, 2026-11-03, after the Step 10 manual test).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '../store-session';

afterEach(() => {
  vi.useRealTimers();
});

describe('activeYear', () => {
  it('falls back to the current school year when config.json has none', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T12:00:00'), toFake: ['Date'] });
    const { Store } = await openStore({
      files: { 'config.json': JSON.stringify({ schema_version: 2 }) },
      subject: null,
    });
    expect(Store.getConfigSync!().activeYear).toBe('2026-2027');
    expect((await Store.getConfig!()).activeYear).toBe('2026-2027');
    expect(Store.getConfigSync!().schema_version).toBe(2);
  });

  it('falls back when there is no config.json, as in the reference', async () => {
    vi.useFakeTimers({ now: new Date('2026-03-01T12:00:00'), toFake: ['Date'] });
    const { Store } = await openStore({ files: {}, subject: null });
    expect(Store.getConfigSync!().activeYear).toBe('2025-2026');
  });

  it('keeps an activeYear that is set', async () => {
    const { Store } = await openStore({
      files: { 'config.json': JSON.stringify({ schema_version: 2, activeYear: '2024-2025' }) },
      subject: null,
    });
    expect(Store.getConfigSync!().activeYear).toBe('2024-2025');
    expect((await Store.getConfig!()).activeYear).toBe('2024-2025');
  });
});
