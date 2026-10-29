// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge between the UI and the backend: the 28 ported methods of the
// reference `window.rtti` (docs/reference/ipc-api.md; ADR-0002 section 2) plus
// the two event subscriptions. Result shapes are the reference's ("compat
// shapes"), so the legacy screens run unchanged. Typed errors from Rust are
// mapped to these shapes by TauriApi (tauri-api.ts, ADR-0005).
//
// Dropped on purpose: listScoreFiles, typstVersion, compileTypst (no call
// site) and renderAssignmentPdf (only reachable through a dead editor proxy
// branch).

/** Any JSON value as stored in the data folder. */
export type Json = unknown;

export type { PrintName } from '../domain/print';

/** `{ ok, reason }` results of the fs write/delete methods. */
export type FsResult = { ok: true; hash?: string } | { ok: false; reason: string };

/** Results of the opdracht image methods. */
export type ImageResult =
  | { ok: true; file: string; name: string }
  | { ok: false; error: string }
  | { ok: false; exists: true; name: string };

/** `{ success, error }` results of the Typst methods. */
export type RenderResult<T> = ({ success: true } & T) | { success: false; error: string };

export interface DataChange {
  /** Posix path relative to the data folder. */
  relPath: string;
  kind: 'added' | 'changed' | 'deleted';
  /** The file's `_meta` for non-array JSON, else null. */
  meta: Record<string, unknown> | null;
}

/**
 * The data folder as opened at start. `error` is set when it cannot be used
 * (e.g. `unsupported_schema`, `io`); the app then shows the startup error
 * screen instead of running on empty data (review 4b m5).
 */
export interface DataFolderStatus {
  dataDir: string;
  error: { code: string; message: string; details: { found?: string | null } } | null;
}

export interface BatchJob {
  key: string;
  typFile: string;
  label?: string;
  header?: {
    title: string;
    student: string;
    group: string;
    exam: string;
    observaties: { icon: string; name: string }[];
  };
  mode?: 'student' | 'answers';
}

export interface BatchOptions {
  includeAnswers?: boolean;
  duplex?: boolean;
  outputName?: string;
}

export interface OpdrachtImage {
  /** Relative to `data/opdrachten`, e.g. `images/<id>/<name>.png`. */
  file: string;
  name: string;
  /** PNG data URL, or null when the image cannot be decoded (SVG). */
  thumb: string | null;
}

export type Unsubscribe = () => void;

import type { PrintName } from '../domain/print';

export interface MaatwerkApi {
  // ── JSON storage ──────────────────────────────────────────────────────────
  /** Parsed JSON, or null when missing or unparsable. */
  readJson(relPath: string): Promise<Json | null>;
  /** `{ data, hash }`; `{ data: null, hash: null }` when missing; `{ error }` when unreadable. */
  readJsonVersioned(
    relPath: string,
  ): Promise<{ data: Json; hash: string | null } | { error: string }>;
  writeJson(
    relPath: string,
    data: Json,
    opts?: { cas?: boolean; expectedHash?: string | null },
  ): Promise<FsResult>;
  /** Year folders (`YYYY-YYYY`), newest first. */
  listYears(): Promise<string[]>;
  /** Creates the year's folder skeleton; returns its absolute path. */
  ensureYear(year: string): Promise<string>;
  /** Parsed contents of every `*.json` directly in the folder; unparsable files are skipped. */
  readAllJson(dirRelPath: string): Promise<Json[]>;
  deleteFile(relPath: string): Promise<FsResult>;
  ensureDir(relPath: string): Promise<void>;
  /** Absolute data folder; the editor only uses it as a "ready" flag. */
  getDataDir(): Promise<string>;

  // ── Text files (opdracht .typ) ────────────────────────────────────────────
  readTextFile(relPath: string): Promise<string | null>;
  writeTextFile(relPath: string, content: string): Promise<{ ok: true }>;
  createAssignmentTypFile(typFile: string): Promise<{ ok: true }>;

  // ── Opdracht images ───────────────────────────────────────────────────────
  listOpdrachtImages(opdrachtId: string): Promise<OpdrachtImage[]>;
  saveOpdrachtImage(
    opdrachtId: string,
    name: string,
    ext: string,
    base64: string,
    overwrite?: boolean,
  ): Promise<ImageResult>;
  pickImageFile(): Promise<{ token: string; name: string; ext: string } | null>;
  importOpdrachtImage(
    opdrachtId: string,
    token: string,
    name: string,
    overwrite?: boolean,
  ): Promise<ImageResult>;
  /** Clipboard image as base64 PNG, or null. */
  readClipboardImage(): Promise<string | null>;
  copyOpdrachtImages(fromId: string, toId: string): Promise<{ ok: true }>;
  deleteOpdrachtImages(opdrachtId: string): Promise<{ ok: true }>;

  // ── Presence, session, photos ─────────────────────────────────────────────
  updatePresence(userId: string | null, state?: Record<string, unknown>): Promise<void>;
  readLocalSession(): Promise<Record<string, unknown> | null>;
  writeLocalSession(data: Record<string, unknown>): Promise<void>;
  readPhotoAsDataUrl(relPath: string): Promise<string | null>;
  savePhoto(relPath: string, base64Data: string): Promise<void>;

  // ── Typst ─────────────────────────────────────────────────────────────────
  // `pdfPath` in the results is an output ID in the app (not a file path):
  // pass it to pdfUrl, openPath or printPdf.
  renderRapportPdf(
    examId: string,
    students: unknown[],
    examInfo: Record<string, unknown>,
  ): Promise<RenderResult<{ pdfPath: string }>>;
  renderAssignmentSvg(
    typFile: string,
    title: string,
    previewContent?: string,
  ): Promise<RenderResult<{ pages: string[] }>>;
  renderAssignmentBatch(
    jobs: BatchJob[],
    opts?: BatchOptions,
  ): Promise<RenderResult<{ pdfPath: string; pages: number }>>;

  // ── Shell ─────────────────────────────────────────────────────────────────
  /**
   * Opens a render output (`pdfPath`) or a data-relative file with the OS;
   * `''` on success, else an error text. Absolute paths are refused.
   */
  openPath(target: string): Promise<string>;

  // ── Events ────────────────────────────────────────────────────────────────
  onDataChanged(cb: (changes: DataChange[]) => void): Unsubscribe;
  onAssignmentProgress(cb: (progress: { done: number; total: number }) => void): Unsubscribe;

  // ── New in the port (not a reference IPC method) ──────────────────────────
  /**
   * URL under which the PDF viewer iframe can load a PDF returned by a render
   * method. Replaces the reference's `'file:///' + pdfPath`, which a webview
   * cannot load.
   */
  pdfUrl(pdfPath: string): string;
  /**
   * "Afdrukken": copies a render output into `rapporten/` under a descriptive
   * name and opens the copy with the OS (ADR-0002 section 9, C15). Resolves to
   * the copy's data-relative path; rejects when it cannot be written.
   */
  printPdf(pdfPath: string, name: PrintName): Promise<string>;
  /** The school year whose folder the watcher polls (ADR-0003 C7); null: config.json. */
  setWatchYear(year: string | null): Promise<void>;
  /** Checked before anything else at start (not a reference method). */
  dataFolderStatus(): Promise<DataFolderStatus>;
  /** "Opnieuw proberen" on the startup error screen: restarts the app. */
  restartApp(): Promise<void>;
}

/** The 28 ported reference methods, for contract tests and the parity table. */
export const PORTED_METHODS = [
  'readJson',
  'readJsonVersioned',
  'writeJson',
  'listYears',
  'ensureYear',
  'readAllJson',
  'deleteFile',
  'ensureDir',
  'getDataDir',
  'readTextFile',
  'writeTextFile',
  'createAssignmentTypFile',
  'listOpdrachtImages',
  'saveOpdrachtImage',
  'pickImageFile',
  'importOpdrachtImage',
  'readClipboardImage',
  'copyOpdrachtImages',
  'deleteOpdrachtImages',
  'updatePresence',
  'readLocalSession',
  'writeLocalSession',
  'readPhotoAsDataUrl',
  'savePhoto',
  'renderRapportPdf',
  'renderAssignmentSvg',
  'renderAssignmentBatch',
  'openPath',
] as const satisfies readonly (keyof MaatwerkApi)[];

declare global {
  interface Window {
    maatwerk: MaatwerkApi;
  }
}
