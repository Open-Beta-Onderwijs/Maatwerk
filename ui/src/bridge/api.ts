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
//
// Data format v2 (Step 7a, docs/reference/data-files-v2.md): the opdracht
// methods work on folders `opdrachten/<id>/` (C14), so createAssignmentTypFile,
// copyOpdrachtImages and deleteOpdrachtImages became createOpdrachtFolder,
// copyOpdrachtFolder and deleteOpdrachtFolder, and the Typst methods take an
// opdracht id instead of a `.typ` file name.

/** Any JSON value as stored in the data folder. */
export type Json = unknown;

export type { PrintName } from '../domain/print';
import type { DataFolderStatus } from './bindings';

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
 * The data folder as opened at start (generated from Rust). `error` is set
 * when it cannot be used (e.g. `unsupported_schema`, `io`); the app then shows
 * the startup error screen instead of running on empty data (review 4b m5).
 */
export type { DataFolderStatus } from './bindings';

export interface BatchJob {
  key: string;
  /** The opdracht folder `opdrachten/<id>/`. */
  opdrachtId: string;
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
  /** Relative to the opdracht folder, e.g. `images/<name>.png`. */
  file: string;
  name: string;
  /** PNG data URL, or null when the image cannot be decoded (SVG). */
  thumb: string | null;
}

export type Unsubscribe = () => void;

/** The migration offered on the startup screen (C1). */
export type { MigrationResult, DataCheck, DataIssue, StampIssue } from './bindings';
import type { MigrationResult, DataCheck, StampIssue } from './bindings';

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
  /** Every `opdrachten/<id>/opdracht.json` (C14). */
  readOpdrachten(): Promise<Json[]>;
  deleteFile(relPath: string): Promise<FsResult>;
  ensureDir(relPath: string): Promise<void>;
  /** Absolute data folder; the editor only uses it as a "ready" flag. */
  getDataDir(): Promise<string>;

  // ── Text files (opdracht .typ) ────────────────────────────────────────────
  readTextFile(relPath: string): Promise<string | null>;
  /** The text and its hash for a later checked write (C17); null when missing. */
  readTextFileVersioned(relPath: string): Promise<{ text: string; hash: string } | null>;
  /**
   * Writes `opdrachten/<id>/<name>.typ`. With `expectedHash` the file must
   * still have that hash (`''`: must not exist), else `{ ok: false, reason:
   * 'conflict' }` (C17).
   */
  writeTextFile(
    relPath: string,
    content: string,
    expectedHash?: string | null,
  ): Promise<{ ok: true; hash: string } | { ok: false; reason: 'conflict' }>;
  /** `main.typ`, `lib.typ` and `opdracht.typ` for a new opdracht; existing files stay. */
  createOpdrachtFolder(opdrachtId: string): Promise<{ ok: true }>;

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
  /** Copies the Typst files and images of an opdracht folder (not `opdracht.json`). */
  copyOpdrachtFolder(fromId: string, toId: string): Promise<{ ok: true }>;
  deleteOpdrachtFolder(opdrachtId: string): Promise<{ ok: true }>;

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
    opdrachtId: string,
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
   * "Afdrukken": copies a render output into `rapporten/` next to the data
   * folder under a descriptive name and opens the copy with the OS (ADR-0002
   * section 9, C15, C18). Resolves to the copy's path relative to that shared
   * folder; rejects when it cannot be written.
   */
  printPdf(pdfPath: string, name: PrintName): Promise<string>;
  /** The school year whose folder the watcher polls (ADR-0003 C7); null: config.json. */
  setWatchYear(year: string | null): Promise<void>;
  /** Checked before anything else at start (not a reference method). */
  dataFolderStatus(): Promise<DataFolderStatus>;
  /** "Opnieuw proberen" on the startup error screen: restarts the app. */
  restartApp(): Promise<void>;
  /** v1 -> v2 after a backup, only while the folder needs it (startup screen). */
  migrateDataFolder(): Promise<MigrationResult>;
  /** `validate-data` on the open folder (admin, "Gegevenscontrole"). */
  validateDataFolder(): Promise<DataCheck>;
  /** JSON files read with a missing or wrong stamp since start (C19). */
  stampIssues(): Promise<StampIssue[]>;
  /** "Accepteren": re-stamps the file as it is. */
  acceptStamp(relPath: string): Promise<void>;
}

/**
 * The 28 ported reference methods, for contract tests and the parity table.
 * Three were renamed for the opdracht folders (C14, see the top of the file).
 */
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
  'createOpdrachtFolder',
  'listOpdrachtImages',
  'saveOpdrachtImage',
  'pickImageFile',
  'importOpdrachtImage',
  'readClipboardImage',
  'copyOpdrachtFolder',
  'deleteOpdrachtFolder',
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
