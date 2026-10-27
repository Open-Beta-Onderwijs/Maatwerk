// SPDX-License-Identifier: AGPL-3.0-or-later

// The real backend: the generated tauri-specta commands (bindings.ts, ADR-0005)
// plus the compat layer that turns their typed `{ code, message, details }`
// errors into each method's reference result shape (docs/reference/ipc-api.md),
// so the legacy screens run unchanged. Methods whose Rust side comes in Steps
// 5-6 (opdracht images, Typst, openPath) still throw.

import { PORTED_METHODS, type DataChange, type FsResult, type Json, type MaatwerkApi } from './api';
import { commands, events, type CommandError, type ErrorCode, type Value } from './bindings';

type Commands = typeof commands;
type Result<T> = { status: 'ok'; data: T } | { status: 'error'; error: CommandError };

/** What the API needs from Tauri; tests pass a fake. */
export interface Backend {
  commands: Commands;
  listenDataChanged(cb: (changes: DataChange[]) => void): Promise<() => void>;
}

const tauriBackend: Backend = {
  commands,
  // `meta` is whatever the file's `_meta` holds; the UI only reads objects from it.
  listenDataChanged: (cb) => events.dataChanged.listen((e) => cb(e.payload as DataChange[])),
};

/** A rejected backend call, with the stable code from Rust. */
export class BackendError extends Error {
  readonly code: ErrorCode | 'unknown';
  readonly details: CommandError['details'];

  constructor(error: unknown) {
    const typed = asCommandError(error);
    super(typed ? typed.message : String(error));
    this.name = 'BackendError';
    this.code = typed?.code ?? 'unknown';
    this.details = typed?.details ?? {};
  }
}

/** Framework failures (bad arguments, unknown command) reject with a string, not our shape. */
function asCommandError(error: unknown): CommandError | null {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return error as CommandError;
  }
  return null;
}

function message(error: unknown): string {
  return asCommandError(error)?.message ?? String(error);
}

/** The data or throw: for methods whose reference handler rejects on error. */
async function orThrow<T>(call: Promise<Result<T>>): Promise<T> {
  const r = await call;
  if (r.status === 'error') throw new BackendError(r.error);
  return r.data;
}

/**
 * The data or a fallback: for methods whose reference handler never rejects.
 * An unusable data folder still throws: an empty app without a message would
 * hide it (review 4b m5).
 */
async function orElse<T, F>(call: Promise<Result<T>>, fallback: F): Promise<T | F> {
  const r = await call;
  if (r.status === 'ok') return r.data;
  if (asCommandError(r.error)?.code === 'unsupported_schema') throw new BackendError(r.error);
  return fallback;
}

/** `{ ok: false, reason }`: `conflict` and `locked` by code, else the message. */
function fsFailure(error: unknown): FsResult {
  const code = asCommandError(error)?.code;
  if (code === 'conflict' || code === 'locked') return { ok: false, reason: code };
  return { ok: false, reason: message(error) };
}

function notYet(method: string): never {
  throw new Error(`window.maatwerk.${method} is nog niet beschikbaar in deze versie (Step 6).`);
}

export function createTauriApi(backend: Backend = tauriBackend): MaatwerkApi {
  const c = backend.commands;
  // Presence calls run in call order: Tauri runs commands concurrently, and a
  // logout overtaken by a heartbeat would leave the teacher online (review 4b m3).
  let presenceQueue: Promise<unknown> = Promise.resolve();
  const api: Partial<MaatwerkApi> = {
    // ── JSON storage ────────────────────────────────────────────────────────
    // Missing and corrupt both give null (D2); store.js reads through
    // readJsonVersioned where the difference matters.
    readJson: (relPath) => orElse(c.readJson(relPath), null),

    async readJsonVersioned(relPath) {
      const r = await c.readJsonVersioned(relPath);
      if (r.status === 'error') return { error: message(r.error) };
      return r.data ?? { data: null, hash: null };
    },

    async writeJson(relPath, data, opts) {
      const cas = Boolean(opts?.cas);
      const r = await c.writeJson(relPath, data as Value, cas, opts?.expectedHash ?? null);
      return r.status === 'ok' ? { ok: true, hash: r.data } : fsFailure(r.error);
    },

    listYears: () => orElse(c.listYears(), [] as string[]),
    ensureYear: (year) => orThrow(c.ensureYear(year)),
    readAllJson: (dir) => orThrow(c.readAllJson(dir)) as Promise<Json[]>,

    async deleteFile(relPath) {
      const r = await c.deleteFile(relPath);
      return r.status === 'ok' ? { ok: true } : fsFailure(r.error);
    },

    async ensureDir(relPath) {
      await orThrow(c.ensureDir(relPath));
    },
    getDataDir: () => orThrow(c.getDataDir()),

    // ── Text files ──────────────────────────────────────────────────────────
    readTextFile: (relPath) => orThrow(c.readTextFile(relPath)),
    async writeTextFile(relPath, content) {
      await orThrow(c.writeTextFile(relPath, content));
      return { ok: true };
    },

    // ── Presence, session, photos ───────────────────────────────────────────
    // The reference only logs presence failures; a heartbeat must not throw.
    updatePresence(userId, state) {
      const run = presenceQueue.then(async () => {
        const r = await c.updatePresence(userId ?? null, (state ?? null) as Value);
        if (r.status === 'error') console.warn('[presence]', message(r.error));
      });
      presenceQueue = run.catch(() => {});
      return run;
    },
    readLocalSession: () =>
      orElse(c.readLocalSession(), null) as Promise<Record<string, unknown> | null>,
    async writeLocalSession(data) {
      await orThrow(c.writeLocalSession(data as Value));
    },
    readPhotoAsDataUrl: (relPath) => orElse(c.readPhotoAsDataUrl(relPath), null),
    async savePhoto(relPath, base64Data) {
      await orThrow(c.savePhoto(relPath, base64Data));
    },

    // ── Events ──────────────────────────────────────────────────────────────
    onDataChanged(cb) {
      let stopped = false;
      let unlisten: (() => void) | null = null;
      backend
        .listenDataChanged(cb)
        .then((fn) => {
          if (stopped) fn();
          else unlisten = fn;
        })
        .catch((e) => console.error('[sync] cannot listen for data changes:', e));
      return () => {
        stopped = true;
        unlisten?.();
      };
    },
    onAssignmentProgress: () => () => {},
    pdfUrl: (pdfPath) => notYet(`pdfUrl(${pdfPath})`),
  };
  for (const method of PORTED_METHODS) {
    if (!(method in api)) {
      (api as Record<string, unknown>)[method] = async () => notYet(method);
    }
  }
  return api as MaatwerkApi;
}
