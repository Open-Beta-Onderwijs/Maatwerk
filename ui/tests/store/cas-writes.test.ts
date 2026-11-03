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
    // C16: school.json carries _meta now.
    expect(await disk(api, 'school.json')).toMatchObject({
      naam: 'B',
      plaats: 'Y',
      _meta: { rev: 1 },
    });
    expect(Store.getSchoolSync!()).toMatchObject({ naam: 'B', plaats: 'Y' });
    expect(writes.mock.calls.every((c) => c[2]?.cas === true)).toBe(true);
  });

  it('updateSchool with a function edits the latest version (schoolsoort toggle)', async () => {
    const { Store, api } = await session({
      'config.json': JSON.stringify({ activeYear: YEAR }),
      'school.json': JSON.stringify({ naam: 'A', schoolsoort: ['vmbo'] }),
    });
    await Store.loadSchool!();
    await api.writeJson('school.json', { naam: 'A', schoolsoort: ['vmbo', 'vwo'] });
    const saved = await Store.updateSchool!((cur: { schoolsoort: string[] }) => {
      cur.schoolsoort = [...cur.schoolsoort, 'havo'];
    });
    expect(saved.schoolsoort).toEqual(['vmbo', 'vwo', 'havo']);
    expect(await disk(api, 'school.json')).toMatchObject({
      naam: 'A',
      schoolsoort: ['vmbo', 'vwo', 'havo'],
    });
  });

  it('updateSchool creates school.json when it is missing', async () => {
    const { Store, api } = await session({ 'config.json': JSON.stringify({ activeYear: YEAR }) });
    await Store.updateSchool!({ schoolsoort: ['havo'] });
    expect(await disk(api, 'school.json')).toMatchObject({ schoolsoort: ['havo'] });
  });

  it('C16: a school field saved from a stale form conflicts and names the colleague', async () => {
    const { Store, api } = await session({
      'config.json': JSON.stringify({ activeYear: YEAR }),
      'school.json': JSON.stringify({ naam: 'A', _meta: { rev: 3 } }),
    });
    const loaded = await Store.loadSchool!();
    await api.writeJson('school.json', { naam: 'C', _meta: { rev: 4, updatedBy: 'gebr-2' } });
    const err = await Store.updateSchool!({ naam: 'B' }, loaded._meta.rev).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'conflict', updatedBy: 'gebr-2' });
    expect(await disk(api, 'school.json')).toMatchObject({ naam: 'C' });
    const saved = await Store.updateSchool!({ naam: 'B' }, 4);
    expect(saved._meta.rev).toBe(5);
  });

  it('C16: users are one file each; a stale edit of the same user conflicts', async () => {
    const { Store, api } = await session({
      'config.json': JSON.stringify({ activeYear: YEAR }),
      'gebruikers.json': JSON.stringify([
        { id: 'admin', voornaam: 'A', isAdmin: true },
        { id: 'gebr-1', voornaam: 'Jan' },
      ]),
    });
    const users = await Store.loadUsers!();
    expect(users.map((u: { id: string }) => u.id)).toEqual(['admin', 'gebr-1']);
    const jan = users[1];
    await Store.upsertUser!({ ...jan, voornaam: 'Janneke' });
    expect(await disk(api, 'gebruikers/gebr-1.json')).toMatchObject({
      voornaam: 'Janneke',
      _meta: { rev: 1 },
    });
    // Another admin's edit of the same user, saved after this one loaded it:
    await api.writeJson('gebruikers/gebr-1.json', {
      id: 'gebr-1',
      voornaam: 'Johan',
      _meta: { rev: 2, updatedBy: 'admin' },
    });
    const err = await Store.upsertUser!({ ...jan, voornaam: 'Jan B' }, 1).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'conflict', updatedBy: 'admin' });
    expect(await disk(api, 'gebruikers/gebr-1.json')).toMatchObject({ voornaam: 'Johan' });
    // A new user is a new file; the others are untouched.
    await Store.upsertUser!({ id: 'gebr-2', voornaam: 'Piet' });
    expect(await disk(api, 'gebruikers/admin.json')).toMatchObject({ voornaam: 'A' });
    expect((await Store.loadUsers!()).length).toBe(3);
  });

  it('setActiveYear keeps other config fields written meanwhile', async () => {
    const { Store, api, writes } = await session({
      'config.json': JSON.stringify({ activeYear: '2024-2025' }),
    });
    await Store.getConfig!();
    await api.writeJson('config.json', { activeYear: '2024-2025', other: 1 });
    writes.mockClear();
    await Store.setActiveYear!(YEAR);
    // Review 7a m4: schema_version is (re)set too.
    expect(await disk(api, 'config.json')).toEqual({
      activeYear: YEAR,
      other: 1,
      schema_version: 2,
    });
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
