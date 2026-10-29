// SPDX-License-Identifier: AGPL-3.0-or-later

// Contract tests for the compat layer: each method's reference result shape
// (docs/reference/ipc-api.md) for success and for the typed errors from Rust.

import { describe, expect, it, vi } from 'vitest';

import { PORTED_METHODS, type DataChange } from './api';
import type { CommandError, ErrorCode } from './bindings';
import { BackendError, createTauriApi, type Backend } from './tauri-api';

type Call = { command: string; args: unknown[] };

function err(code: ErrorCode, message = `${code} happened`): CommandError {
  return { code, message, details: { path: 'x.json' } };
}

/** A backend whose every command answers with `reply(command, args)`. */
function fakeBackend(reply: (command: string, args: unknown[]) => unknown) {
  const calls: Call[] = [];
  let listener: ((c: DataChange[]) => void) | null = null;
  let progressListener: ((p: { done: number; total: number }) => void) | null = null;
  const unlisten = vi.fn();
  const commands = new Proxy(
    {},
    {
      get:
        (_t, command: string) =>
        async (...args: unknown[]) => {
          calls.push({ command, args });
          const r = reply(command, args);
          if (r instanceof Error) throw r;
          if (r && typeof r === 'object' && 'code' in r) return { status: 'error', error: r };
          if (typeof r === 'string' && r.startsWith('reject:'))
            return { status: 'error', error: r.slice(7) };
          return { status: 'ok', data: r };
        },
    },
  ) as Backend['commands'];
  const backend: Backend = {
    commands,
    listenDataChanged: async (cb) => {
      listener = cb;
      return unlisten;
    },
    listenAssignmentProgress: async (cb) => {
      progressListener = cb;
      return unlisten;
    },
    outputUrl: (id) => `http://maatwerk-out.localhost/${id}`,
  };
  return {
    api: createTauriApi(backend),
    calls,
    emit: (c: DataChange[]) => listener?.(c),
    progress: (p: { done: number; total: number }) => progressListener?.(p),
    unlisten,
  };
}

describe('TauriApi', () => {
  it('has every ported method', () => {
    const { api } = fakeBackend(() => null);
    for (const m of PORTED_METHODS) expect(typeof api[m]).toBe('function');
  });

  it('readJson: data; null when missing; null when corrupt (D2)', async () => {
    expect(await fakeBackend(() => ({ a: 1 })).api.readJson('a.json')).toEqual({ a: 1 });
    expect(await fakeBackend(() => null).api.readJson('a.json')).toBeNull();
    expect(await fakeBackend(() => err('corrupt_json')).api.readJson('a.json')).toBeNull();
  });

  it('readJsonVersioned: {data, hash}; {null, null} when missing; {error} when unreadable', async () => {
    const ok = fakeBackend(() => ({ data: [1], hash: 'abc' }));
    expect(await ok.api.readJsonVersioned('a.json')).toEqual({ data: [1], hash: 'abc' });
    const missing = fakeBackend(() => null);
    expect(await missing.api.readJsonVersioned('a.json')).toEqual({ data: null, hash: null });
    const corrupt = fakeBackend(() => err('corrupt_json', 'corrupt JSON in a.json'));
    expect(await corrupt.api.readJsonVersioned('a.json')).toEqual({
      error: 'corrupt JSON in a.json',
    });
  });

  it('writeJson: passes cas and expectedHash; maps conflict and locked to reasons', async () => {
    const ok = fakeBackend(() => 'h1');
    expect(await ok.api.writeJson('a.json', { x: 1 })).toEqual({ ok: true, hash: 'h1' });
    await ok.api.writeJson('a.json', { x: 1 }, { cas: true, expectedHash: null });
    await ok.api.writeJson('a.json', { x: 1 }, { cas: true, expectedHash: 'h0' });
    expect(ok.calls.map((c) => c.args)).toEqual([
      ['a.json', { x: 1 }, false, null],
      ['a.json', { x: 1 }, true, null],
      ['a.json', { x: 1 }, true, 'h0'],
    ]);
    for (const code of ['conflict', 'locked'] as const) {
      expect(await fakeBackend(() => err(code)).api.writeJson('a.json', {})).toEqual({
        ok: false,
        reason: code,
      });
    }
    expect(await fakeBackend(() => err('io', 'disk full')).api.writeJson('a.json', {})).toEqual({
      ok: false,
      reason: 'disk full',
    });
    // A framework rejection (string) also becomes a reason.
    expect(await fakeBackend(() => 'reject:bad args').api.writeJson('a.json', {})).toEqual({
      ok: false,
      reason: 'bad args',
    });
  });

  it('deleteFile: {ok: true}; {ok: false, reason}', async () => {
    expect(await fakeBackend(() => null).api.deleteFile('a.json')).toEqual({ ok: true });
    expect(await fakeBackend(() => err('locked')).api.deleteFile('a.json')).toEqual({
      ok: false,
      reason: 'locked',
    });
  });

  it('listYears never rejects', async () => {
    expect(await fakeBackend(() => ['2025-2026']).api.listYears()).toEqual(['2025-2026']);
    expect(await fakeBackend(() => err('io')).api.listYears()).toEqual([]);
  });

  it('rejecting methods throw a BackendError with the code', async () => {
    const { api } = fakeBackend(() => err('invalid_path', 'invalid path "../x"'));
    const attempts: Promise<unknown>[] = [
      api.ensureYear('x'),
      api.readAllJson('../x'),
      api.ensureDir('../x'),
      api.getDataDir(),
      api.readTextFile('../x'),
      api.writeTextFile('../x', ''),
      api.writeLocalSession({}),
      api.savePhoto('../x', ''),
    ];
    for (const p of attempts) {
      const e = await p.catch((e: unknown) => e);
      expect(e).toBeInstanceOf(BackendError);
      expect((e as BackendError).code).toBe('invalid_path');
      expect((e as BackendError).message).toBe('invalid path "../x"');
    }
  });

  it('success shapes of the void and {ok: true} methods', async () => {
    const { api } = fakeBackend(() => null);
    expect(await api.ensureDir('a')).toBeUndefined();
    expect(await api.writeTextFile('a.typ', 'x')).toEqual({ ok: true });
    expect(await api.writeLocalSession({ a: 1 })).toBeUndefined();
    expect(await api.savePhoto('fotos/a.png', 'AA==')).toBeUndefined();
    expect(await api.updatePresence('jan', { online: true })).toBeUndefined();
  });

  it('null-on-error methods: readLocalSession, readPhotoAsDataUrl', async () => {
    const { api } = fakeBackend(() => err('io'));
    expect(await api.readLocalSession()).toBeNull();
    expect(await api.readPhotoAsDataUrl('fotos/a.png')).toBeNull();
  });

  it('updatePresence: null user and missing state are sent as null; errors are only logged', async () => {
    const ok = fakeBackend(() => null);
    await ok.api.updatePresence(null);
    expect(ok.calls[0]?.args).toEqual([null, null]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = fakeBackend(() => err('invalid_argument'));
    await expect(bad.api.updatePresence('a/b', {})).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('an unusable data folder throws even where the reference returns null (m5)', async () => {
    const { api } = fakeBackend(() => err('unsupported_schema'));
    await expect(api.readJson('config.json')).rejects.toBeInstanceOf(BackendError);
    await expect(api.listYears()).rejects.toThrow('unsupported_schema happened');
  });

  it('presence calls reach the backend in call order (m3)', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));
    const commands = {
      updatePresence: async (userId: string | null) => {
        if (userId === 'jan') await slow; // the heartbeat is slow
        order.push(String(userId));
        return { status: 'ok', data: null };
      },
    } as unknown as Backend['commands'];
    const api = createTauriApi({
      commands,
      listenDataChanged: async () => () => {},
      listenAssignmentProgress: async () => () => {},
      outputUrl: (id) => id,
    });
    const heartbeat = api.updatePresence('jan', { online: true });
    const logout = api.updatePresence(null);
    release();
    await Promise.all([heartbeat, logout]);
    expect(order).toEqual(['jan', 'null']);
  });

  it('onDataChanged delivers batches and unsubscribes', async () => {
    const f = fakeBackend(() => null);
    const got: DataChange[][] = [];
    const off = f.api.onDataChanged((c) => got.push(c));
    await Promise.resolve();
    const batch: DataChange[] = [{ relPath: 'a.json', kind: 'added', meta: null }];
    f.emit(batch);
    expect(got).toEqual([batch]);
    off();
    expect(f.unlisten).toHaveBeenCalled();
  });

  it('onDataChanged: unsubscribing before the listener is ready still unlistens', async () => {
    const f = fakeBackend(() => null);
    const off = f.api.onDataChanged(() => {});
    off();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.unlisten).toHaveBeenCalled();
  });

  it('opdracht images: {ok, file, name}, {exists}, {error}; an invalid id rejects', async () => {
    const saved = fakeBackend(() => ({ status: 'saved', file: 'images/o1/a.png', name: 'a' }));
    expect(await saved.api.saveOpdrachtImage('o1', 'a', 'png', 'AA==')).toEqual({
      ok: true,
      file: 'images/o1/a.png',
      name: 'a',
    });
    expect(saved.calls[0]?.args).toEqual(['o1', 'a', 'png', 'AA==', false]);
    const exists = fakeBackend(() => ({ status: 'exists', name: 'a' }));
    expect(await exists.api.importOpdrachtImage('o1', '1', 'a', true)).toEqual({
      ok: false,
      exists: true,
      name: 'a',
    });
    expect(exists.calls[0]?.args).toEqual(['o1', '1', 'a', true]);
    const rejected = fakeBackend(() => ({
      status: 'rejected',
      message: 'Kies de afbeelding opnieuw.',
    }));
    expect(await rejected.api.importOpdrachtImage('o1', '9', 'a')).toEqual({
      ok: false,
      error: 'Kies de afbeelding opnieuw.',
    });
    const invalid = fakeBackend(() => err('invalid_argument', 'Ongeldige opdracht.'));
    for (const p of [
      invalid.api.listOpdrachtImages('../x'),
      invalid.api.saveOpdrachtImage('../x', 'a', 'png', ''),
      invalid.api.copyOpdrachtImages('a', '../x'),
      invalid.api.deleteOpdrachtImages('../x'),
      invalid.api.createAssignmentTypFile('../x.typ'),
    ]) {
      await expect(p).rejects.toThrow('Ongeldige opdracht.');
    }
    const ok = fakeBackend(() => null);
    expect(await ok.api.copyOpdrachtImages('a', 'b')).toEqual({ ok: true });
    expect(await ok.api.deleteOpdrachtImages('a')).toEqual({ ok: true });
    expect(await ok.api.createAssignmentTypFile('opdracht_1.typ')).toEqual({ ok: true });
    expect(await ok.api.pickImageFile()).toBeNull();
    expect(await fakeBackend(() => err('io')).api.readClipboardImage()).toBeNull();
  });

  it('renderRapportPdf normalises the payload (review 5a M1) and maps errors', async () => {
    const f = fakeBackend(() => ({ pdfPath: '1-rapport_preview.pdf', warnings: [] }));
    const students = [{ name: 'A', score: undefined, pct: Number.NaN }];
    expect(await f.api.renderRapportPdf('t1', students, { name: 'T' })).toEqual({
      success: true,
      pdfPath: '1-rapport_preview.pdf',
    });
    expect(f.calls[0]?.args).toEqual(['t1', [{ name: 'A', score: null, pct: 0 }], { name: 'T' }]);
    const bad = fakeBackend(() => err('typst', 'error: unknown variable'));
    expect(await bad.api.renderRapportPdf('t1', [], {})).toEqual({
      success: false,
      error: 'error: unknown variable',
    });
  });

  it('renderAssignmentSvg: pages; preview content defaults to null; warnings are logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeBackend(() => ({ pages: ['<svg/>'], warnings: ['warning: tofu'] }));
    expect(await f.api.renderAssignmentSvg('o.typ', 'T')).toEqual({
      success: true,
      pages: ['<svg/>'],
    });
    expect(f.calls[0]?.args).toEqual(['o.typ', 'T', null]);
    expect(warn).toHaveBeenCalledWith('[typst]', 'warning: tofu');
    warn.mockRestore();
    const bad = fakeBackend(() => err('invalid_argument', 'Ongeldige bestandsnaam: ../o.typ'));
    expect(await bad.api.renderAssignmentSvg('../o.typ', 'T', '')).toEqual({
      success: false,
      error: 'Ongeldige bestandsnaam: ../o.typ',
    });
  });

  it('renderAssignmentBatch: jobs and options with nulls for missing fields; progress events', async () => {
    const f = fakeBackend(() => ({ pdfPath: '2-opdrachten.pdf', pages: 3, warnings: [] }));
    const seen: unknown[] = [];
    const off = f.api.onAssignmentProgress((p) => seen.push(p));
    await Promise.resolve();
    f.progress({ done: 0, total: 1 });
    const r = await f.api.renderAssignmentBatch([{ key: 's1', typFile: 'o.typ' }], {
      duplex: true,
    });
    expect(r).toEqual({ success: true, pdfPath: '2-opdrachten.pdf', pages: 3 });
    expect(f.calls[0]?.args).toEqual([
      [{ key: 's1', typFile: 'o.typ', label: null, header: null, mode: null }],
      { includeAnswers: null, duplex: true, outputName: null },
    ]);
    expect(seen).toEqual([{ done: 0, total: 1 }]);
    off();
    expect(f.unlisten).toHaveBeenCalled();
    expect(await f.api.renderAssignmentBatch([])).toEqual({
      success: false,
      error: 'Er is niets om te genereren.',
    });
    const bad = fakeBackend(() => err('typst', 'Fout in opdracht "A":\n\nerror: x'));
    expect(await bad.api.renderAssignmentBatch([{ key: 's', typFile: 'o.typ' }])).toEqual({
      success: false,
      error: 'Fout in opdracht "A":\n\nerror: x',
    });
  });

  it('outputs: pdfUrl uses the output scheme; openPath gives "" or the message; printPdf', async () => {
    const f = fakeBackend((command) =>
      command === 'printPdf' ? 'rapporten/2025-2026/x.pdf' : null,
    );
    expect(f.api.pdfUrl('1-rapport_preview.pdf')).toBe(
      'http://maatwerk-out.localhost/1-rapport_preview.pdf',
    );
    expect(await f.api.openPath('1-rapport_preview.pdf')).toBe('');
    const name = {
      schooljaar: '2025-2026',
      soort: 'Rapport' as const,
      vak: 'nat',
      groep: '3a',
      toets: 'T',
    };
    expect(await f.api.printPdf('1-rapport_preview.pdf', name)).toBe('rapporten/2025-2026/x.pdf');
    expect(f.calls.at(-1)?.args).toEqual(['1-rapport_preview.pdf', name]);
    const bad = fakeBackend(() => err('not_found', 'not found: 9-x.pdf'));
    expect(await bad.api.openPath('9-x.pdf')).toBe('not found: 9-x.pdf');
    await expect(bad.api.printPdf('9-x.pdf', name)).rejects.toThrow('not found: 9-x.pdf');
  });

  it('dataFolderStatus passes the status through; a failed call throws; restartApp', async () => {
    const status = {
      dataDir: 'D:/data',
      error: { code: 'unsupported_schema' as const, message: 'm', details: { found: '9' } },
    };
    const f = fakeBackend((command) => (command === 'dataFolderStatus' ? status : null));
    expect(await f.api.dataFolderStatus()).toEqual(status);
    await f.api.restartApp();
    expect(f.calls.map((c) => c.command)).toEqual(['dataFolderStatus', 'restartApp']);
    const bad = fakeBackend(() => err('internal', 'blocking task failed'));
    await expect(bad.api.dataFolderStatus()).rejects.toThrow(BackendError);
  });
});
