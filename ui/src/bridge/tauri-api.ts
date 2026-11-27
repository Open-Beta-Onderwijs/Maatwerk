// SPDX-License-Identifier: AGPL-3.0-or-later

// The real backend: the generated tauri-specta commands (bindings.ts, ADR-0005)
// plus the compat layer that turns their typed `{ code, message, details }`
// errors into each method's reference result shape (docs/reference/ipc-api.md),
// so the legacy screens run unchanged.

import { Channel, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type * as Ai from './ai-api';
import type { VakNumbers } from '../domain/numbers';
import { normaliseForTypst } from '../domain/rapport';
import {
  PORTED_METHODS,
  type DataChange,
  type FsResult,
  type ImageResult,
  type Json,
  type MaatwerkApi,
  type Unsubscribe,
} from './api';
import {
  commands,
  events,
  type CommandError,
  type EditorUpdateEvent,
  type ErrorCode,
  type ImageStored,
  type Value,
} from './bindings';

type Commands = typeof commands;
type Result<T> = { status: 'ok'; data: T } | { status: 'error'; error: CommandError };
type Progress = { done: number; total: number };

/** The URI scheme that serves render outputs (src-tauri/src/scheme.rs). */
export const OUTPUT_SCHEME = 'maatwerk-out';
/** The emoji font on the output scheme (`EMOJI_FONT_PATH` in src-tauri/src/scheme.rs). */
export const EMOJI_FONT_PATH = 'maatwerk-emoji.ttf';

/** What the API needs from Tauri; tests pass a fake. */
export interface Backend {
  commands: Commands;
  listenDataChanged(cb: (changes: DataChange[]) => void): Promise<() => void>;
  listenAssignmentProgress(cb: (progress: Progress) => void): Promise<() => void>;
  listenEditorUpdate(cb: (update: EditorUpdateEvent) => void): Promise<() => void>;
  /** The window's close request; it closes once `cb` is done, unless it resolves false. */
  listenCloseRequested?(cb: () => Promise<boolean>): Promise<() => void>;
  /** URL of a render output for the viewer iframe. */
  outputUrl(outputId: string): string;
}

const tauriBackend: Backend = {
  commands,
  // `meta` is whatever the file's `_meta` holds; the UI only reads objects from it.
  listenDataChanged: (cb) => events.dataChanged.listen((e) => cb(e.payload as DataChange[])),
  listenAssignmentProgress: (cb) => events.assignmentProgress.listen((e) => cb(e.payload)),
  listenEditorUpdate: (cb) => events.editorUpdate.listen((e) => cb(e.payload)),
  // Tauri awaits the handler, then destroys the window (core:window:allow-destroy) unless the
  // handler called preventDefault (the teacher chose to stay, review 37 M1). A handler that
  // throws would leave the window open for good, so nothing gets out: an error closes.
  listenCloseRequested: (cb) =>
    getCurrentWindow().onCloseRequested(async (event) => {
      let close = true;
      try {
        close = await cb();
      } catch (e) {
        console.error('[close]', e);
      }
      if (!close) event.preventDefault();
    }),
  // `http://maatwerk-out.localhost/<id>` on Windows, `maatwerk-out://localhost/<id>` elsewhere.
  outputUrl: (outputId) => convertFileSrc(outputId, OUTPUT_SCHEME),
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

/** The command's JSON in the shape `ai-api.ts` declares for it. */
async function asJson<T>(call: Promise<Result<Value>>): Promise<T> {
  return (await orThrow(call)) as unknown as T;
}

/** `window.maatwerk.ai` over the `ai_*` commands (src-tauri/src/ai.rs). */
function createAiApi(c: Commands): Ai.AiApi {
  const json = (v: unknown) => v as Value;
  return {
    detect: (gebruiker, refresh) => asJson(c.aiDetect(gebruiker, refresh)),
    saveSettings: (gebruiker, settings) => asJson(c.aiSaveSettings(gebruiker, json(settings))),
    send(gebruiker, opdrachtId, provider, request, onEvent) {
      const channel = new Channel<Value>();
      channel.onmessage = (event) => onEvent(event as unknown as Ai.AiEvent);
      return asJson(c.aiSend(gebruiker, opdrachtId, provider, json(request), channel));
    },
    stop: (opdrachtId) => c.aiStop(opdrachtId),
    conversations: (gebruiker, opdrachtId) => asJson(c.aiConversations(gebruiker, opdrachtId)),
    conversation: (gebruiker, opdrachtId, provider) =>
      asJson(c.aiConversation(gebruiker, opdrachtId, provider)),
    async newConversation(gebruiker, opdrachtId, provider) {
      await orThrow(c.aiNewConversation(gebruiker, opdrachtId, provider));
    },
    proposal: (gebruiker, opdrachtId, provider, current) =>
      asJson(c.aiProposal(gebruiker, opdrachtId, provider, current)),
    apply: (gebruiker, opdrachtId, provider, current, hunks, images) =>
      asJson(c.aiApply(gebruiker, opdrachtId, provider, current, hunks, images)),
    commitImages: (gebruiker, opdrachtId, provider, images) =>
      asJson(c.aiCommitImages(gebruiker, opdrachtId, provider, images)),
    async undoImages(gebruiker, opdrachtId, provider, images) {
      await orThrow(c.aiUndoImages(gebruiker, opdrachtId, provider, images));
    },
    proposalImage: (gebruiker, opdrachtId, provider, path) =>
      orThrow(c.aiProposalImage(gebruiker, opdrachtId, provider, path)),
    context: (gebruiker, opdrachtId) => orThrow(c.aiContext(gebruiker, opdrachtId)),
    async saveContext(gebruiker, opdrachtId, context) {
      await orThrow(c.aiSaveContext(gebruiker, opdrachtId, json(context)));
    },
    syllabusList: () => asJson(c.aiSyllabusList()),
    async openSyllabusFolder() {
      await orThrow(c.aiOpenSyllabusFolder());
    },
    presets: async () => (await c.aiPresets()) as unknown as Ai.AiPreset[],
    pickAttachments: () => asJson(c.aiPickAttachments()),
  };
}

/**
 * The data or a fallback: for methods whose reference handler never rejects.
 * An unusable data folder still throws: an empty app without a message would
 * hide it (review 4b m5).
 */
async function orElse<T, F>(call: Promise<Result<T>>, fallback: F): Promise<T | F> {
  const r = await call;
  if (r.status === 'ok') return r.data;
  const code = asCommandError(r.error)?.code;
  if (code === 'unsupported_schema' || code === 'needs_migration') throw new BackendError(r.error);
  return fallback;
}

/**
 * `{ ok: false, reason }`: `conflict`, `locked` and `read_only` by code, else the message (a
 * `forbidden` score write, step 35, gives its Dutch message).
 */
function fsFailure(error: unknown): FsResult {
  const code = asCommandError(error)?.code;
  if (code === 'conflict' || code === 'locked' || code === 'read_only')
    return { ok: false, reason: code };
  return { ok: false, reason: message(error) };
}

/** `{ status }` from Rust to the reference's `{ ok, ... }` image results. */
function imageResult(stored: ImageStored): ImageResult {
  switch (stored.status) {
    case 'saved':
      return { ok: true, file: stored.file, name: stored.name };
    case 'exists':
      return { ok: false, exists: true, name: stored.name };
    case 'rejected':
      return { ok: false, error: stored.message };
  }
}

/** Compile warnings (e.g. characters without a font); the reference dropped them (T14). */
function logWarnings(warnings: string[]): void {
  for (const w of warnings) console.warn('[typst]', w);
}

/** Subscribes through a promise-returning listen; the returned function also works before it resolves. */
function subscribe<T>(
  listen: (cb: (payload: T) => void) => Promise<() => void>,
  cb: (payload: T) => void,
  what: string,
): Unsubscribe {
  let stopped = false;
  let unlisten: (() => void) | null = null;
  listen(cb)
    .then((fn) => {
      if (stopped) fn();
      else unlisten = fn;
    })
    .catch((e) => console.error(`[${what}] cannot listen:`, e));
  return () => {
    stopped = true;
    unlisten?.();
  };
}

export function createTauriApi(backend: Backend = tauriBackend): MaatwerkApi {
  const c = backend.commands;
  // Presence calls run in call order: Tauri runs commands concurrently, and a
  // logout overtaken by a heartbeat would leave the teacher online (review 4b m3).
  let presenceQueue: Promise<unknown> = Promise.resolve();
  const api: Partial<MaatwerkApi> = {
    ai: createAiApi(c),

    // ── JSON storage ────────────────────────────────────────────────────────
    // Missing and corrupt both give null (D2); store.js reads through
    // readJsonVersioned where the difference matters.
    readJson: (relPath) => orElse(c.readJson(relPath), null),

    async readJsonVersioned(relPath) {
      const r = await c.readJsonVersioned(relPath);
      if (r.status === 'error') {
        // corrupt_json: `found` is the hash of the unreadable bytes (review 4a m4).
        const unreadableHash =
          r.error.code === 'corrupt_json' ? (r.error.details.found ?? null) : null;
        return { error: message(r.error), unreadableHash };
      }
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
    readJsonDir: (dir) => orThrow(c.readJsonDir(dir)) as Promise<{ name: string; data: Json }[]>,
    readOpdrachten: () => orThrow(c.readOpdrachten()) as Promise<Json[]>,

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
    readTextFileVersioned: (relPath) => orThrow(c.readTextFileVersioned(relPath)),
    async writeTextFile(relPath, content, expectedHash) {
      const r = await c.writeTextFile(relPath, content, expectedHash ?? null);
      if (r.status === 'ok') return { ok: true, hash: r.data };
      if (asCommandError(r.error)?.code === 'conflict') return { ok: false, reason: 'conflict' };
      throw new BackendError(r.error);
    },
    async createOpdrachtFolder(opdrachtId) {
      await orThrow(c.createOpdrachtFolder(opdrachtId));
      return { ok: true };
    },

    // ── Opdracht images ─────────────────────────────────────────────────────
    // An invalid opdracht id rejects ('Ongeldige opdracht.'), as in the reference.
    listOpdrachtImages: (opdrachtId) => orThrow(c.listOpdrachtImages(opdrachtId)),
    async saveOpdrachtImage(opdrachtId, name, ext, base64, overwrite) {
      return imageResult(
        await orThrow(c.saveOpdrachtImage(opdrachtId, name, ext, base64, Boolean(overwrite))),
      );
    },
    pickImageFile: () => orThrow(c.pickImageFile()),
    async importOpdrachtImage(opdrachtId, token, name, overwrite) {
      return imageResult(
        await orThrow(c.importOpdrachtImage(opdrachtId, token, name, Boolean(overwrite))),
      );
    },
    readClipboardImage: () => orElse(c.readClipboardImage(), null),
    async copyOpdrachtFolder(fromId, toId) {
      await orThrow(c.copyOpdrachtFolder(fromId, toId));
      return { ok: true };
    },
    async deleteOpdrachtFolder(opdrachtId) {
      await orThrow(c.deleteOpdrachtFolder(opdrachtId));
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

    // ── Typst ───────────────────────────────────────────────────────────────
    // Every failure is `{ success: false, error }`; a compile error's message
    // is Typst's error text.
    async renderRapportPdf(examId, students, examInfo) {
      // Restores what the reference's toTypst did to the payload (review 5a M1).
      const r = await c.renderRapportPdf(
        examId,
        normaliseForTypst(students) as Value,
        normaliseForTypst(examInfo) as Value,
      );
      if (r.status === 'error') return { success: false, error: message(r.error) };
      logWarnings(r.data.warnings);
      return { success: true, pdfPath: r.data.pdfPath, warnings: r.data.warnings };
    },
    async renderPoRapportPdf(examId, students, poInfo) {
      const r = await c.renderPoRapportPdf(
        examId,
        normaliseForTypst(students) as Value,
        normaliseForTypst(poInfo) as Value,
      );
      if (r.status === 'error') return { success: false, error: message(r.error) };
      logWarnings(r.data.warnings);
      return { success: true, pdfPath: r.data.pdfPath, warnings: r.data.warnings };
    },
    async renderAssignmentSvg(opdrachtId, title, previewContent) {
      const r = await c.renderAssignmentSvg(opdrachtId, title, previewContent ?? null);
      if (r.status === 'error') return { success: false, error: message(r.error) };
      logWarnings(r.data.warnings);
      return { success: true, pages: r.data.pages };
    },
    async renderAssignmentBatch(jobs, opts) {
      if (!Array.isArray(jobs) || jobs.length === 0)
        return { success: false, error: 'Er is niets om te genereren.' };
      const r = await c.renderAssignmentBatch(
        jobs.map((j) => ({
          key: String(j.key),
          opdrachtId: j.opdrachtId,
          label: j.label ?? null,
          header: (j.header ?? null) as Value,
          mode: j.mode ?? null,
        })),
        {
          includeAnswers: opts?.includeAnswers ?? null,
          duplex: opts?.duplex ?? null,
          outputName: opts?.outputName ?? null,
        },
      );
      if (r.status === 'error') return { success: false, error: message(r.error) };
      logWarnings(r.data.warnings);
      return {
        success: true,
        pdfPath: r.data.pdfPath,
        pages: r.data.pages,
        warnings: r.data.warnings,
      };
    },

    // ── Shell ───────────────────────────────────────────────────────────────
    async openPath(target) {
      const r = await c.openPath(target);
      return r.status === 'ok' ? '' : message(r.error);
    },
    async openDataFolder(relPath) {
      const r = await c.openDataFolder(relPath);
      return r.status === 'ok' ? '' : message(r.error);
    },
    printPdf: (pdfPath, name) => orThrow(c.printPdf(pdfPath, name)),
    async setWatchYear(year) {
      const r = await c.setWatchYear(year);
      if (r.status === 'error') console.warn('[sync]', message(r.error));
    },
    dataFolderStatus: () => orThrow(c.dataFolderStatus()),
    restartApp: () => c.restartApp(),
    chooseDataFolder: () => orThrow(c.chooseDataFolder()),
    problemInfo: () => c.problemInfo(),
    openLogFolder: () => orThrow(c.openLogFolder()).then(() => undefined),
    logUiError: (message) => c.logUiError(message),
    migrateDataFolder: (dryRun) => orThrow(c.migrateDataFolder(dryRun ?? null)),
    validateDataFolder: () => orThrow(c.validateDataFolder()),
    rubricUsage: () => orThrow(c.rubricUsage()),
    // The command returns JSON; its shape is `VakNumbers` (maatwerk_core::numbers).
    vakNumbers: async (year, vak) =>
      (await orThrow(c.vakNumbers(year, vak))) as unknown as VakNumbers,
    stampIssues: () => orThrow(c.stampIssues()),
    async acceptStamp(relPath) {
      await orThrow(c.acceptStamp(relPath));
    },
    verifyPin: (userId, pin, role) => orThrow(c.verifyPin(userId, pin, role ?? null)),
    setFirstPin: (userId, pin, role) => orThrow(c.setFirstPin(userId, pin, role ?? null)),
    changePin: (currentPin, newPin) => orThrow(c.changePin(currentPin, newPin)),
    resetPin: (userId) => orThrow(c.resetPin(userId)),
    recoverWithCode: (userId, code, newPin) => orThrow(c.recoverWithCode(userId, code, newPin)),
    renewRecoveryCodes: (pin) => orThrow(c.renewRecoveryCodes(pin)),
    async logout() {
      await orThrow(c.logout());
    },
    async loginGast(vak) {
      await orThrow(c.loginGast(vak));
    },
    copyOpdrachtToSectie: (fromId, vak, teacherId, pin) =>
      orThrow(c.copyOpdrachtToSectie(fromId, vak, teacherId, pin)),
    saveTextAs: (defaultName, content) => orThrow(c.saveTextAs(defaultName, content)),
    listSnapshots: () => orThrow(c.listSnapshots()),
    rapportenUsage: () => orThrow(c.rapportenUsage()),
    rapportenCleanup: (before) => orThrow(c.rapportenCleanup(before)),
    snapshotForFile: (relPath) => orThrow(c.snapshotForFile(relPath)),
    async restoreFromSnapshot(relPath, snapshot) {
      await orThrow(c.restoreFromSnapshot(relPath, snapshot));
    },

    // ── Live editor ─────────────────────────────────────────────────────────
    editorOpen: (opdrachtId, title) => orThrow(c.editorOpen(opdrachtId, title)),
    editorUpdate: (session, path, text) => orThrow(c.editorUpdate(session, path, text)),
    editorUnset: (session, path) => orThrow(c.editorUnset(session, path)),
    editorRefresh: (session) => orThrow(c.editorRefresh(session)),
    editorResend: (session) => orThrow(c.editorResend(session)),
    editorClose: (session) => c.editorClose(session),
    editorComplete: (session, path, text, offset, explicit) =>
      orThrow(c.editorComplete(session, path, text, offset, explicit)),
    editorHover: (session, path, text, offset) =>
      orThrow(c.editorHover(session, path, text, offset)),
    editorDefinition: (session, path, text, offset) =>
      orThrow(c.editorDefinition(session, path, text, offset)),
    editorJumpFromClick: (session, page, x, y) =>
      orThrow(c.editorJumpFromClick(session, page, x, y)),
    editorJumpFromCursor: (session, path, offset) =>
      orThrow(c.editorJumpFromCursor(session, path, offset)),
    onEditorUpdate: (cb) => subscribe((f) => backend.listenEditorUpdate(f), cb, 'editor'),
    projectFilesStatus: (opdrachtId) => orThrow(c.projectFilesStatus(opdrachtId)),
    restoreProjectFile: (opdrachtId, file, expectedHash) =>
      orThrow(c.restoreProjectFile(opdrachtId, file, expectedHash)),
    bundledProjectFile: (file) => orThrow(c.bundledProjectFile(file)),

    // ── Events ──────────────────────────────────────────────────────────────
    onDataChanged: (cb) => subscribe((f) => backend.listenDataChanged(f), cb, 'sync'),
    onCloseRequested: (cb) => {
      const listen = backend.listenCloseRequested;
      if (!listen) return () => {};
      let stopped = false;
      let unlisten: (() => void) | null = null;
      listen(cb)
        .then((fn) => {
          if (stopped) fn();
          else unlisten = fn;
        })
        .catch((e) => console.error('[close] cannot listen:', e));
      return () => {
        stopped = true;
        unlisten?.();
      };
    },
    onAssignmentProgress: (cb) =>
      subscribe((f) => backend.listenAssignmentProgress(f), cb, 'assignment progress'),
    pdfUrl: (pdfPath) => backend.outputUrl(pdfPath),
    emojiFontUrl: () => backend.outputUrl(EMOJI_FONT_PATH),
  };
  for (const method of PORTED_METHODS) {
    if (!(method in api)) throw new Error(`TauriApi misses ${method}`);
  }
  return api as MaatwerkApi;
}
