// SPDX-License-Identifier: AGPL-3.0-or-later

// S38 / ADR-0003 C6: every JSON write of the Store is a compare-and-swap.
// school.json and config.json are patched onto the latest version on disk; the
// RTTI template editor saves only over the version it loaded. "Another
// instance" is a direct write on the MockApi between the Store's read and write.

import { describe, expect, it, vi } from 'vitest';
import { openStore } from '../store-session';

const YEAR = '2025-2026';

async function session(files: Record<string, string>) {
  const s = await openStore({ files, subject: null });
  const writes = vi.spyOn(s.api, 'writeJson');
  return { ...s, writes };
}

async function disk(api: { readJson(rel: string): Promise<unknown> }, rel: string) {
  return api.readJson(rel);
}

describe('CAS for the formerly blind writes (S38, C6)', () => {
  it('updateSchool keeps a field another teacher changed meanwhile', async () => {
    const { Store, api, writes } = await session({
      'config.json': JSON.stringify({ activeYear: YEAR }),
      'school.json': JSON.stringify({ naam: 'A', plaats: 'X' }),
    });
    await Store.loadSchool!();
    await api.writeJson('school.json', { naam: 'A', plaats: 'Y' });
    writes.mockClear();
    await Store.updateSchool!({ naam: 'B' });
    expect(await disk(api, 'school.json')).toEqual({ naam: 'B', plaats: 'Y' });
    expect(Store.getSchoolSync!()).toEqual({ naam: 'B', plaats: 'Y' });
    expect(writes.mock.calls.every((c) => c[2]?.cas === true)).toBe(true);
  });

  it('updateSchool creates school.json when it is missing', async () => {
    const { Store, api } = await session({ 'config.json': JSON.stringify({ activeYear: YEAR }) });
    await Store.updateSchool!({ schoolsoort: ['havo'] });
    expect(await disk(api, 'school.json')).toEqual({ schoolsoort: ['havo'] });
  });

  it('setActiveYear keeps other config fields written meanwhile', async () => {
    const { Store, api, writes } = await session({
      'config.json': JSON.stringify({ activeYear: '2024-2025' }),
    });
    await Store.getConfig!();
    await api.writeJson('config.json', { activeYear: '2024-2025', other: 1 });
    writes.mockClear();
    await Store.setActiveYear!(YEAR);
    expect(await disk(api, 'config.json')).toEqual({ activeYear: YEAR, other: 1 });
    expect((await Store.getConfig!()).activeYear).toBe(YEAR);
    expect(writes.mock.calls.every((c) => c[2]?.cas === true)).toBe(true);
  });

  it('saveVersioned writes over the loaded version and conflicts after a foreign change', async () => {
    const rel = 'templates/x.json';
    const { Store, api } = await session({
      'config.json': JSON.stringify({ activeYear: YEAR }),
      [rel]: JSON.stringify({ v: 1 }),
    });
    const { data, hash } = await Store.loadVersioned!(rel);
    expect(data).toEqual({ v: 1 });
    const next = await Store.saveVersioned!(rel, { v: 2 }, hash);
    expect(await disk(api, rel)).toEqual({ v: 2 });
    // Saving again with the new hash works; with the old one it conflicts.
    await Store.saveVersioned!(rel, { v: 3 }, next);
    await expect(Store.saveVersioned!(rel, { v: 4 }, hash)).rejects.toMatchObject({
      code: 'conflict',
    });
    await api.writeJson(rel, { v: 'other' });
    await expect(Store.saveVersioned!(rel, { v: 5 }, next)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await disk(api, rel)).toEqual({ v: 'other' });
  });

  it('saveVersioned with a null hash only creates a new file', async () => {
    const { Store, api } = await session({ 'config.json': JSON.stringify({ activeYear: YEAR }) });
    const { data, hash } = await Store.loadVersioned!('t/new.json');
    expect([data, hash]).toEqual([null, null]);
    await Store.saveVersioned!('t/new.json', { a: 1 }, hash);
    await expect(Store.saveVersioned!('t/new.json', { a: 2 }, null)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await disk(api, 't/new.json')).toEqual({ a: 1 });
  });

  it('loadVersioned refuses an unreadable file', async () => {
    const { Store } = await session({
      'config.json': JSON.stringify({ activeYear: YEAR }),
      't/bad.json': '{"half',
    });
    await expect(Store.loadVersioned!('t/bad.json')).rejects.toThrow(/onleesbaar/);
  });

  it('the blind helpers are gone', async () => {
    const { Store } = await session({ 'config.json': JSON.stringify({ activeYear: YEAR }) });
    expect(Store.saveSchool).toBeUndefined();
    expect(Store.saveStudents).toBeUndefined();
    expect(Store.saveStudentScores).toBeUndefined();
  });
});
