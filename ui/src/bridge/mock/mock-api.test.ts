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
    expect(await api.readJson('config.json')).toEqual({ activeYear: '2025-2026' });
    const exams = await api.readAllJson('2025-2026/exams');
    expect(exams.length).toBeGreaterThan(0);
  });

  it('readJson returns null for missing and unparsable files (D2)', async () => {
    expect(await api.readJson('nope.json')).toBeNull();
    await api.writeTextFile('broken.json', '{');
    expect(await api.readJson('broken.json')).toBeNull();
    expect(await api.readJsonVersioned('broken.json')).toHaveProperty('error');
  });

  it('writes JSON like JSON.stringify(x, null, 2) and returns the SHA-1 of the bytes', async () => {
    const res = await api.writeJson('a/b.json', { x: 1 });
    expect(res).toEqual({ ok: true, hash: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(api.peek('a/b.json')).toBe('{\n  "x": 1\n}');
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

  it('readAllJson skips unparsable and null files, in NTFS order (B31)', async () => {
    await api.writeTextFile('d/b.json', '{"n":"b"}');
    await api.writeTextFile('d/A.json', '{"n":"A"}');
    await api.writeTextFile('d/c.json', 'null');
    await api.writeTextFile('d/e.json', '{');
    await api.writeTextFile('d/f.txt', '{"n":"f"}');
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
      file: 'images/op-1/Remweg-auto.png',
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
    await api.copyOpdrachtImages('op-1', 'op-2');
    expect((await api.listOpdrachtImages('op-2')).map((i) => i.name)).toEqual(['Remweg-auto']);
    await api.deleteOpdrachtImages('op-1');
    expect(await api.listOpdrachtImages('op-1')).toEqual([]);
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
    expect(await api.renderAssignmentBatch([{ key: 'a', typFile: '../x.typ' }])).toEqual({
      success: false,
      error: 'Ongeldige bestandsnaam: ../x.typ',
    });
    const progress: number[] = [];
    api.onAssignmentProgress((p) => progress.push(p.done));
    const res = await api.renderAssignmentBatch([
      { key: 'a', typFile: 'a.typ' },
      { key: 'b', typFile: 'b.typ' },
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
