// SPDX-License-Identifier: AGPL-3.0-or-later

// Contract of the MockApi against the reference handlers (docs/reference/ipc-api.md).

import { beforeEach, describe, expect, it } from 'vitest';
import seed from 'virtual:maatwerk-fixtures';
import { PORTED_METHODS, type DataChange } from '../api';
import { MockApi } from './mock-api';

let api: MockApi;
beforeEach(() => {
  api = new MockApi(seed);
});

describe('MockApi', () => {
  it('implements every ported method', () => {
    for (const method of PORTED_METHODS) expect(typeof api[method]).toBe('function');
    expect(PORTED_METHODS).toHaveLength(28);
  });

  it('is seeded from the tiny fixture', async () => {
    expect(await api.listYears()).toEqual(['2025-2026']);
    expect(await api.readJson('config.json')).toEqual({
      activeYear: '2025-2026',
      schema_version: 2,
    });
    expect(await api.readOpdrachten()).toHaveLength(7);
    const exams = await api.readAllJson('2025-2026/exams');
    expect(exams.length).toBeGreaterThan(0);
  });

  it('readJson returns null for missing and unparsable files (D2)', async () => {
    expect(await api.readJson('nope.json')).toBeNull();
    api.externalWriteText('broken.json', '{');
    expect(await api.readJson('broken.json')).toBeNull();
    expect(await api.readJsonVersioned('broken.json')).toHaveProperty('error');
  });

  it('writes JSON like JSON.stringify(x, null, 2) plus a newline (C13), returns the SHA-1', async () => {
    const res = await api.writeJson('a/b.json', { x: 1 });
    expect(res).toEqual({ ok: true, hash: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(api.peek('a/b.json')).toBe('{\n  "x": 1\n}\n');
    const versioned = await api.readJsonVersioned('a/b.json');
    expect(versioned).toEqual({ data: { x: 1 }, hash: (res as { hash: string }).hash });
  });

  it('CAS: writes only when the expected hash matches; null means "must not exist"', async () => {
    const first = await api.writeJson('c.json', 1, { cas: true, expectedHash: null });
    expect(first).toMatchObject({ ok: true });
    const second = await api.writeJson('c.json', 2, { cas: true, expectedHash: null });
    expect(second).toEqual({ ok: false, reason: 'conflict' });
    const { hash } = (await api.readJsonVersioned('c.json')) as { hash: string };
    const third = await api.writeJson('c.json', 3, { cas: true, expectedHash: hash });
    expect(third).toMatchObject({ ok: true });
    expect(await api.readJson('c.json')).toBe(3);
  });

  it('CAS: a write landing while the hash is computed is a conflict, not lost', async () => {
    await api.writeJson('r.json', { v: 1 });
    const { hash } = (await api.readJsonVersioned('r.json')) as { hash: string };
    const pending = api.writeJson('r.json', { v: 2 }, { cas: true, expectedHash: hash });
    api.externalWrite('r.json', { v: 'colleague' }); // synchronous, during the await
    expect(await pending).toEqual({ ok: false, reason: 'conflict' });
    expect(await api.readJson('r.json')).toEqual({ v: 'colleague' });
  });

  it('readAllJson skips unparsable and null files, in NTFS order (B31)', async () => {
    api.externalWriteText('d/b.json', '{"n":"b"}');
    api.externalWriteText('d/A.json', '{"n":"A"}');
    api.externalWriteText('d/c.json', 'null');
    api.externalWriteText('d/e.json', '{');
    api.externalWriteText('d/f.txt', '{"n":"f"}');
    expect(await api.readAllJson('d')).toEqual([{ n: 'A' }, { n: 'b' }]);
    expect(await api.readAllJson('missing')).toEqual([]);
  });

  it('own writes are not echoed; external writes emit data:changed with _meta', async () => {
    const seen: DataChange[][] = [];
    const off = api.onDataChanged((c) => seen.push(c));
    await api.writeJson('own.json', { a: 1 });
    expect(seen).toEqual([]);
    api.externalWrite('x.json', { _meta: { rev: 2 } });
    api.externalWrite('x.json', [1]);
    api.externalDelete('x.json');
    expect(seen).toEqual([
      [{ relPath: 'x.json', kind: 'added', meta: { rev: 2 } }],
      [{ relPath: 'x.json', kind: 'changed', meta: null }],
      [{ relPath: 'x.json', kind: 'deleted', meta: null }],
    ]);
    off();
    api.externalWrite('y.json', {});
    expect(seen).toHaveLength(3);
  });

  it('ensureYear creates the folder skeleton', async () => {
    await api.ensureYear('2026-2027');
    expect(await api.listYears()).toEqual(['2026-2027', '2025-2026']);
  });

  it('opdracht images: clean names, refuse duplicates, validate ids', async () => {
    const png = 'iVBORw0KGgo=';
    expect(await api.saveOpdrachtImage('op-1', 'Remweg auto!', 'PNG', png)).toEqual({
      ok: true,
      file: 'images/Remweg-auto.png',
      name: 'Remweg-auto',
    });
    expect(await api.saveOpdrachtImage('op-1', 'Remweg auto', 'jpg', png)).toEqual({
      ok: false,
      exists: true,
      name: 'Remweg-auto',
    });
    expect(await api.saveOpdrachtImage('op-1', '!!', 'png', png)).toEqual({
      ok: false,
      error: 'Geef de afbeelding een naam.',
    });
    expect(await api.saveOpdrachtImage('op-1', 'x', 'bmp', png)).toEqual({
      ok: false,
      error: 'Bestandstype .bmp wordt niet ondersteund.',
    });
    await expect(api.listOpdrachtImages('../x')).rejects.toThrow('Ongeldige opdracht.');
    await api.createOpdrachtFolder('op-1');
    await api.copyOpdrachtFolder('op-1', 'op-2');
    expect((await api.listOpdrachtImages('op-2')).map((i) => i.file)).toEqual([
      'images/Remweg-auto.png',
    ]);
    expect(api.peek('opdrachten/op-2/main.typ')).toContain('maatwerk-main');
    await api.deleteOpdrachtFolder('op-1');
    expect(await api.listOpdrachtImages('op-1')).toEqual([]);
    expect(api.peek('opdrachten/op-1/opdracht.typ')).toBeNull();
  });

  it('opdracht text: checked writes (C17) and the folder list', async () => {
    await api.createOpdrachtFolder('op-1');
    const path = 'opdrachten/op-1/opdracht.typ';
    const first = await api.readTextFileVersioned(path);
    const mine = await api.writeTextFile(path, '= mijn', first!.hash);
    expect(mine).toMatchObject({ ok: true });
    api.externalWriteText(path, '= collega');
    expect(await api.writeTextFile(path, '= weer mijn', (mine as { hash: string }).hash)).toEqual({
      ok: false,
      reason: 'conflict',
    });
    expect(api.peek(path)).toBe('= collega');
    await expect(api.writeTextFile('opdrachten/x.typ', '')).rejects.toThrow('invalid path');
    await api.writeJson('opdrachten/op-1/opdracht.json', { id: 'op-1' });
    expect((await api.readOpdrachten()).map((o) => (o as { id: string }).id)).toContain('op-1');
  });

  it('presence: switching users marks the previous one offline', async () => {
    await api.updatePresence('u1', { online: true, scoreModal: 'e1' });
    await api.updatePresence('u2', { online: true });
    expect(JSON.parse(api.peek('users/u1.json')!)).toMatchObject({
      online: false,
      scoreModal: null,
    });
    await api.updatePresence(null);
    expect(JSON.parse(api.peek('users/u2.json')!)).toMatchObject({ online: false });
  });

  it('batch render validates input and reports progress', async () => {
    expect(await api.renderAssignmentBatch([])).toEqual({
      success: false,
      error: 'Er is niets om te genereren.',
    });
    expect(await api.renderAssignmentBatch([{ key: 'a', opdrachtId: '../x' }])).toEqual({
      success: false,
      error: 'Ongeldige opdracht.',
    });
    const progress: number[] = [];
    api.onAssignmentProgress((p) => progress.push(p.done));
    const res = await api.renderAssignmentBatch([
      { key: 'a', opdrachtId: 'a' },
      { key: 'b', opdrachtId: 'b' },
    ]);
    expect(res).toMatchObject({ success: true, pages: 2 });
    expect(progress).toEqual([0, 1, 2]);
  });

  it('render output is a real PDF reachable through pdfUrl', async () => {
    const res = await api.renderRapportPdf('e1', [{ name: 'Test' }], { title: 'Toets' });
    expect(res.success).toBe(true);
    const url = api.pdfUrl((res as { pdfPath: string }).pdfPath);
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
  });
});

describe('MockApi accounts (Step 7b, rules of maatwerk-core::auth)', () => {
  const TEACHER = 'gebr-1756713600001';

  it('sets a first PIN once and logs in', async () => {
    expect((await api.verifyPin(TEACHER, '12345')).outcome).toBe('noPin');
    await expect(api.setFirstPin(TEACHER, '123')).rejects.toThrow('4 tot 8 cijfers');
    const set = await api.setFirstPin(TEACHER, '12345');
    expect(set.recoveryCodes).toBeNull();
    expect(api.loggedIn).toBe(TEACHER);
    await expect(api.setFirstPin(TEACHER, '54321')).rejects.toThrow('al een pincode');
    await api.logout();
    expect((await api.verifyPin(TEACHER, '12345')).outcome).toBe('ok');
  });

  it('delays after the second wrong PIN', async () => {
    await api.setFirstPin(TEACHER, '12345');
    expect(await api.verifyPin(TEACHER, '00000')).toMatchObject({
      outcome: 'wrong',
      retryAfterMs: 0,
    });
    expect(await api.verifyPin(TEACHER, '00000')).toMatchObject({
      outcome: 'wrong',
      retryAfterMs: 2000,
    });
    expect((await api.verifyPin(TEACHER, '12345')).outcome).toBe('wait');
  });

  it('lets only the logged-in admin reset a PIN', async () => {
    await api.setFirstPin(TEACHER, '12345');
    await expect(api.resetPin(TEACHER)).rejects.toThrow('beheerder');
    const admin = await api.setFirstPin('admin', '99999');
    expect(admin.recoveryCodes).toHaveLength(10);
    const user = (await api.resetPin(TEACHER)) as { pinHash?: string };
    expect(user.pinHash).toBeUndefined();
    expect((await api.verifyPin(TEACHER, '12345')).outcome).toBe('noPin');
  });

  it('uses a recovery code once', async () => {
    const { recoveryCodes } = await api.setFirstPin('admin', '99999');
    const code = recoveryCodes![0]!;
    await api.logout();
    expect((await api.recoverWithCode('admin', code, '11111')).outcome).toBe('ok');
    expect((await api.recoverWithCode('admin', code, '22222')).outcome).toBe('wrong');
  });
});
