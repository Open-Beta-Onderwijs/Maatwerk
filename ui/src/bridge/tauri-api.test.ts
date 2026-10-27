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
  };
  return {
    api: createTauriApi(backend),
    calls,
    emit: (c: DataChange[]) => listener?.(c),
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

  it('methods of later steps still say they are not available', async () => {
    const { api } = fakeBackend(() => null);
    await expect(api.renderRapportPdf('t1', [], {})).rejects.toThrow(/nog niet beschikbaar/);
    await expect(api.listOpdrachtImages('o1')).rejects.toThrow(/nog niet beschikbaar/);
  });
});
