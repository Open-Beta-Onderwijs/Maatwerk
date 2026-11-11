// SPDX-License-Identifier: AGPL-3.0-or-later

// In-memory backend for `npm run dev:mock`, Vitest and Playwright. Emulates the
// reference main process (docs/reference/ipc-api.md) on a virtual data folder
// seeded from tools/fixtures (format v2, docs/reference/data-files-v2.md): CAS
// on the SHA-1 of the file bytes, own writes are not echoed, external writes
// (test hooks below) emit `data:changed`. Typst calls return canned output.
// Integrity stamps (C19) are not computed. PINs (Step 7b) are stored as
// `mock$<pin>`, not hashed: the rules (4-8 digits, delays, session, admin
// checks) match maatwerk-core::auth. Nothing is persisted: a reload starts over.

import type {
  BatchJob,
  BatchOptions,
  DataChange,
  DataCheck,
  DataFolderStatus,
  ProblemInfo,
  MigrationResult,
  PinCheck,
  StampIssue,
  RubricUse,
  FsResult,
  ImageResult,
  Json,
  MaatwerkApi,
  OpdrachtImage,
  PrintName,
  RenderResult,
  Unsubscribe,
} from '../api';
import type {
  EditorClickJump,
  EditorCompletions,
  EditorCursorJump,
  EditorHover,
  EditorOpened,
  EditorRange,
  EditorUpdateEvent,
  ProjectFileInfo,
  Value,
} from '../bindings';
import { MockEditor } from './mock-editor';
import { cannedPdf } from './pdf';
import { stampMeta } from '../../domain/ids';
import { requiredVersion } from '../../services/read-only';
import { checkRubric, lockedChanges, type Rubric } from '../../domain/rubric';

/** A snapshot of a data folder: file contents (text or base64) and folders. */
export interface MockSeed {
  files: Record<string, { text: string } | { base64: string }>;
  dirs: string[];
}

export const MOCK_DATA_DIR = 'C:\\Maatwerk-mock\\data';
/** The app version the mock backend reports (`dataFolderStatus`); tests compare against it. */
export const MOCK_APP_VERSION = '0.13.0';
export const MOCK_LOG_DIR =
  'C:\\Users\\docent\\AppData\\Local\\nl.openbetaonderwijs.maatwerk\\logs';
const SUBJECTS = ['nat', 'bio', 'schk', 'wi'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
const MIME: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  webp: 'image/webp',
};
const BASE_ASSIGNMENT = '#import "lib.typ": *\n\n// Nieuwe opdracht (mock-sjabloon)\n';
export const MAIN_TYP = '// maatwerk-main 1 (mock)\n#include "opdracht.typ"\n';
export const LIB_TYP = '// maatwerk-lib 2 (mock)\n';
/** The mock's bundled versions; a copy with an older version line counts as outdated. */
const BUNDLED: Record<string, { text: string; marker: string; version: number }> = {
  'main.typ': { text: MAIN_TYP, marker: '// maatwerk-main ', version: 1 },
  'lib.typ': { text: LIB_TYP, marker: '// maatwerk-lib ', version: 2 },
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function sha1(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parent(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}

function baseName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

function stem(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}

/** Directory order on NTFS (quirk B31): ordinal on upper-cased names. */
function ntfsOrder(a: string, b: string): number {
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

function metaOf(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const meta = (data as { _meta?: unknown })._meta;
    return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : null;
  }
  return null;
}

// "Remweg auto!" -> "Remweg-auto" (main.js:255-262).
function cleanImageName(name: string): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** maatwerk-core::auth::delay_after, in ms. */
export function pinDelayMs(failures: number): number {
  return failures < 2 ? 0 : Math.min(2 ** Math.min(failures - 1, 6), 60) * 1000;
}

function checkPinFormat(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('Een pincode heeft 4 tot 8 cijfers.');
}

type UserRecord = Record<string, unknown> & { id: string };

function checkOpdrachtId(id: string): void {
  if (!/^[\w-]+$/.test(String(id ?? ''))) throw new Error('Ongeldige opdracht.');
}

export class MockApi implements MaatwerkApi {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>();
  private session: Record<string, unknown> | null = null;
  private presence: { userId: string; state: Record<string, unknown> } | null = null;
  private dataListeners = new Set<(changes: DataChange[]) => void>();
  private progressListeners = new Set<(p: { done: number; total: number }) => void>();
  private pdfUrls = new Map<string, string>();
  private pdfs = new Map<string, Uint8Array>();
  /** What `dataFolderStatus` reports; tests set an error to show the startup error screen. */
  folderStatus: DataFolderStatus = {
    dataDir: MOCK_DATA_DIR,
    error: null,
    appVersion: MOCK_APP_VERSION,
    readOnly: null,
    source: 'besideApp',
  };
  /** What the folder dialog of `chooseDataFolder` picks: a folder, `null` (cancelled) or a
   *  refusal; tests set it. */
  pickedFolder: string | null | { refused: string } = null;
  /** What `validateDataFolder` and `stampIssues` report; tests fill them. */
  dataCheck: DataCheck = { filesChecked: 0, issues: [] };
  stamps: StampIssue[] = [];
  /** What `migrateDataFolder` returns; tests may replace it. */
  migration: MigrationResult = {
    fromVersion: 2,
    toVersion: 3,
    applied: true,
    backup: 'C:\\Users\\docent\\AppData\\Local\\maatwerk\\backups\\maatwerk-backup-v1.zip',
    written: 12,
    moved: 1,
    deleted: 3,
    warnings: ['Groep 4H1: leerling 1002 stond er dubbel in; de eerste is gehouden.'],
    notes: ['2025-2026 Toets 1 — HERKANSING (van Toets 1): observaties vóór: geen; na: Rekenfout'],
    validation: {
      filesChecked: 12,
      issues: [
        {
          severity: 'warning',
          kind: 'stray',
          path: 'nat/2025-2026/scores/toets-1 (1).json',
          message: 'Conflictkopie van OneDrive; Maatwerk gebruikt dit bestand niet.',
        },
        {
          severity: 'warning',
          kind: 'reference',
          path: 'nat/2025-2026/toetsen.json',
          message: 'Toets toets-2 verwijst naar groep 4H9, die niet bestaat.',
        },
      ],
    },
    reportFile:
      'C:\\Users\\docent\\AppData\\Local\\maatwerk\\backups\\maatwerk-backup-v1 verslag.txt',
  };
  /** Logged-in user and wrong attempts (maatwerk-core::auth::Auth). */
  private authSession: string | null = null;
  private pinFailures = new Map<string, { count: number; last: number }>();
  /** Snapshot names (newest first) and the files each holds; tests fill them. */
  snapshots: { name: string; files: Record<string, Json> }[] = [];
  /** Calls made through the bridge, for tests (`[method, ...args]`). */
  readonly calls: [string, ...unknown[]][] = [];
  /** The live editor sessions (Step 8b); tests read `editor.updates`. */
  readonly editor = new MockEditor();

  constructor(seed: MockSeed = { files: {}, dirs: [] }) {
    for (const [rel, content] of Object.entries(seed.files)) {
      this.putFile(
        rel,
        'text' in content ? encoder.encode(content.text) : fromBase64(content.base64),
      );
    }
    for (const dir of seed.dirs) this.mkdir(dir);
    // seed_initial_data() in maatwerk-core
    this.mkdir('afbeeldingen');
    this.mkdir('opdrachten');
  }

  // ── Virtual file system ───────────────────────────────────────────────────

  private mkdir(relPath: string): void {
    for (let dir = relPath; dir; dir = parent(dir)) this.dirs.add(dir);
  }

  private putFile(relPath: string, bytes: Uint8Array): void {
    this.mkdir(parent(relPath));
    this.files.set(relPath, bytes);
  }

  private list(dirRelPath: string): string[] {
    const prefix = dirRelPath ? `${dirRelPath}/` : '';
    const names = new Set<string>();
    for (const path of [...this.files.keys(), ...this.dirs]) {
      if (path.startsWith(prefix) && path.length > prefix.length) {
        names.add(path.slice(prefix.length).split('/')[0]!);
      }
    }
    return [...names].sort(ntfsOrder);
  }

  private readText(relPath: string): string | null {
    const bytes = this.files.get(relPath);
    return bytes ? decoder.decode(bytes) : null;
  }

  private faults = new Map<string, { pathPart: string; message: string }>();

  /**
   * Records the call; throws the injected fault when one matches (the async
   * method then rejects, like a handler error in the reference main process).
   */
  private record(method: string, args: unknown[]): void {
    this.calls.push([method, ...args]);
    const fault = this.faultFor(method, args);
    if (fault && method !== 'writeJson') throw new Error(fault);
  }

  private faultFor(method: string, args: unknown[]): string | null {
    const fault = this.faults.get(method);
    if (!fault) return null;
    const path = typeof args[0] === 'string' ? args[0] : '';
    return path.includes(fault.pathPart) ? fault.message : null;
  }

  // ── Test hooks (not part of MaatwerkApi) ──────────────────────────────────

  /**
   * Makes `method` fail for paths containing `pathPart` until cleared:
   * writeJson returns `{ ok: false, reason: message }` (a failed write in the
   * reference), every other method rejects with `message`.
   */
  fail(method: string, pathPart = '', message = 'EBUSY: resource busy or locked'): void {
    this.faults.set(method, { pathPart, message });
  }

  clearFaults(): void {
    this.faults.clear();
  }

  private writeDelayMs = 0;

  /** Makes every writeJson take `ms` (like a slow OneDrive folder), to test fast entry (U2). */
  slowWrites(ms: number): void {
    this.writeDelayMs = ms;
  }

  /** A colleague's write arriving through OneDrive: changes the file and emits `data:changed`. */
  externalWrite(relPath: string, data: Json): void {
    const kind = this.files.has(relPath) ? 'changed' : 'added';
    this.putFile(relPath, encoder.encode(JSON.stringify(data, null, 2)));
    this.emit([{ relPath, kind, meta: metaOf(data) }]);
  }

  /** A colleague's delete arriving through OneDrive. */
  externalDelete(relPath: string): void {
    if (!this.files.delete(relPath)) return;
    this.emit([{ relPath, kind: 'deleted', meta: null }]);
  }

  /** Current content of a file as text, or null. */
  peek(relPath: string): string | null {
    return this.readText(relPath);
  }

  private emit(changes: DataChange[]): void {
    for (const cb of this.dataListeners) cb(changes);
  }

  // ── JSON storage ──────────────────────────────────────────────────────────

  async readJson(relPath: string): Promise<Json | null> {
    this.record('readJson', [relPath]);
    const text = this.readText(relPath);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async readJsonVersioned(
    relPath: string,
  ): Promise<{ data: Json; hash: string | null } | { error: string }> {
    this.record('readJsonVersioned', [relPath]);
    const bytes = this.files.get(relPath);
    if (!bytes) return { data: null, hash: null };
    try {
      return { data: JSON.parse(decoder.decode(bytes)), hash: await sha1(bytes) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async writeJson(
    relPath: string,
    data: Json,
    opts: { cas?: boolean; expectedHash?: string | null } = {},
  ): Promise<FsResult> {
    this.record('writeJson', [relPath, data, opts]);
    if (this.writeDelayMs) await new Promise((res) => setTimeout(res, this.writeDelayMs));
    const fault = this.faultFor('writeJson', [relPath]);
    if (fault) return { ok: false, reason: fault };
    if (this.readOnly()) return { ok: false, reason: 'read_only' };
    const refused = this.rubricGuard(relPath, data);
    if (refused) return { ok: false, reason: refused };
    if (opts.cas) {
      const current = this.files.get(relPath);
      const currentHash = current ? await sha1(current) : null;
      if (currentHash !== (opts.expectedHash ?? null)) return { ok: false, reason: 'conflict' };
      // The hash is async: a write that landed meanwhile is a conflict too (the
      // reference compares and writes in one synchronous handler).
      if (this.files.get(relPath) !== current) return { ok: false, reason: 'conflict' };
    }
    const raise = this.raisesPoVersion(relPath, data);
    if (raise) this.raiseMinAppVersion(raise);
    const bytes = encoder.encode(JSON.stringify(data, null, 2) + '\n'); // C13
    this.putFile(relPath, bytes);
    return { ok: true, hash: await sha1(bytes) };
  }

  async listYears(): Promise<string[]> {
    this.record('listYears', []);
    return this.list('')
      .filter((name) => /^\d{4}-\d{4}$/.test(name) && this.dirs.has(name))
      .sort()
      .reverse();
  }

  async ensureYear(year: string): Promise<string> {
    this.record('ensureYear', [year]);
    this.mkdir(`${year}/exams`);
    this.mkdir(`${year}/groups`);
    for (const subject of SUBJECTS) this.mkdir(`${year}/scores/${subject}`);
    return `${MOCK_DATA_DIR}\\${year}`;
  }

  async readAllJson(dirRelPath: string): Promise<Json[]> {
    this.record('readAllJson', [dirRelPath]);
    return this.jsonFilesIn(dirRelPath).map((f) => f.data);
  }

  async readJsonDir(dirRelPath: string): Promise<{ name: string; data: Json }[]> {
    this.record('readJsonDir', [dirRelPath]);
    return this.jsonFilesIn(dirRelPath);
  }

  private jsonFilesIn(dirRelPath: string): { name: string; data: Json }[] {
    const out: { name: string; data: Json }[] = [];
    for (const name of this.list(dirRelPath)) {
      if (!name.endsWith('.json')) continue;
      const text = this.readText(`${dirRelPath}/${name}`);
      if (text === null) continue; // a directory
      try {
        const data = JSON.parse(text);
        if (data !== null) out.push({ name, data });
      } catch {
        // skipped silently, as the reference does
      }
    }
    return out;
  }

  async readOpdrachten(): Promise<Json[]> {
    this.record('readOpdrachten', []);
    const out: Json[] = [];
    for (const id of this.list('opdrachten')) {
      const text = this.readText(`opdrachten/${id}/opdracht.json`);
      if (text === null) continue;
      try {
        const data = JSON.parse(text);
        if (data !== null) out.push(data);
      } catch {
        // skipped, as readAllJson does
      }
    }
    return out;
  }

  async deleteFile(relPath: string): Promise<FsResult> {
    this.record('deleteFile', [relPath]);
    if (this.readOnly()) return { ok: false, reason: 'read_only' };
    const rubricId = /^rubrics\/([^/]+)\.json$/.exec(relPath)?.[1];
    const uses = rubricId ? (this.rubricUses()[rubricId]?.length ?? 0) : 0;
    if (uses > 0) {
      const what = uses === 1 ? 'PO' : "PO's";
      return {
        ok: false,
        reason: `Deze rubric is in gebruik bij ${uses} ${what} en kan niet verwijderd worden`,
      };
    }
    this.files.delete(relPath);
    return { ok: true };
  }

  async ensureDir(relPath: string): Promise<void> {
    this.record('ensureDir', [relPath]);
    this.mkdir(relPath);
  }

  async getDataDir(): Promise<string> {
    this.record('getDataDir', []);
    return MOCK_DATA_DIR;
  }

  // ── Text files ────────────────────────────────────────────────────────────

  async readTextFile(relPath: string): Promise<string | null> {
    this.record('readTextFile', [relPath]);
    return this.readText(relPath);
  }

  async readTextFileVersioned(relPath: string): Promise<{ text: string; hash: string } | null> {
    this.record('readTextFileVersioned', [relPath]);
    const bytes = this.files.get(relPath);
    return bytes ? { text: decoder.decode(bytes), hash: await sha1(bytes) } : null;
  }

  async writeTextFile(
    relPath: string,
    content: string,
    expectedHash?: string | null,
  ): Promise<{ ok: true; hash: string } | { ok: false; reason: 'conflict' }> {
    this.record('writeTextFile', [relPath, content, expectedHash]);
    this.refuseIfReadOnly();
    if (!/^opdrachten\/[\w-]+\/[^/]+\.typ$/i.test(relPath))
      throw new Error(`invalid path ${JSON.stringify(relPath)}`);
    if (expectedHash === '') {
      if (this.files.has(relPath)) return { ok: false, reason: 'conflict' };
    } else if (expectedHash) {
      const current = this.files.get(relPath);
      if (!current || (await sha1(current)) !== expectedHash)
        return { ok: false, reason: 'conflict' };
    }
    const bytes = encoder.encode(content);
    this.putFile(relPath, bytes);
    return { ok: true, hash: await sha1(bytes) };
  }

  /** A colleague's save of a text file arriving through OneDrive. */
  externalWriteText(relPath: string, content: string): void {
    const kind = this.files.has(relPath) ? 'changed' : 'added';
    this.putFile(relPath, encoder.encode(content));
    this.emit([{ relPath, kind, meta: null }]);
  }

  async createOpdrachtFolder(opdrachtId: string): Promise<{ ok: true }> {
    this.record('createOpdrachtFolder', [opdrachtId]);
    checkOpdrachtId(opdrachtId);
    this.fillOpdrachtFolder(opdrachtId);
    return { ok: true };
  }

  private fillOpdrachtFolder(opdrachtId: string): void {
    const files: [string, string][] = [
      ['main.typ', MAIN_TYP],
      ['lib.typ', LIB_TYP],
      ['opdracht.typ', BASE_ASSIGNMENT],
    ];
    for (const [name, text] of files) {
      const rel = `opdrachten/${opdrachtId}/${name}`;
      if (!this.files.has(rel)) this.putFile(rel, encoder.encode(text));
    }
  }

  // ── Opdracht images ───────────────────────────────────────────────────────

  async listOpdrachtImages(opdrachtId: string): Promise<OpdrachtImage[]> {
    this.record('listOpdrachtImages', [opdrachtId]);
    checkOpdrachtId(opdrachtId);
    const dir = `opdrachten/${opdrachtId}/images`;
    return this.list(dir)
      .filter((f) => IMAGE_EXTS.includes(extOf(f)) && this.files.has(`${dir}/${f}`))
      .sort((a, b) => a.localeCompare(b, 'nl'))
      .map((f) => {
        const ext = extOf(f);
        const bytes = this.files.get(`${dir}/${f}`)!;
        const thumb =
          ext === 'svg' ? null : `data:${MIME[ext] ?? 'image/jpeg'};base64,${toBase64(bytes)}`;
        return { file: `images/${f}`, name: stem(f), thumb };
      });
  }

  private storeImage(
    opdrachtId: string,
    rawName: string,
    rawExt: string,
    bytes: Uint8Array,
    overwrite?: boolean,
  ): ImageResult {
    const name = cleanImageName(rawName);
    if (!name) return { ok: false, error: 'Geef de afbeelding een naam.' };
    const ext = String(rawExt).toLowerCase();
    if (!IMAGE_EXTS.includes(ext))
      return { ok: false, error: `Bestandstype .${ext} wordt niet ondersteund.` };
    checkOpdrachtId(opdrachtId);
    const dir = `opdrachten/${opdrachtId}/images`;
    this.mkdir(dir);
    const existing = this.list(dir).filter((f) => stem(f) === name);
    if (existing.length && !overwrite) return { ok: false, exists: true, name };
    for (const f of existing) this.files.delete(`${dir}/${f}`);
    const file = `${name}.${ext}`;
    this.putFile(`${dir}/${file}`, bytes);
    return { ok: true, file: `images/${file}`, name };
  }

  async saveOpdrachtImage(
    opdrachtId: string,
    name: string,
    ext: string,
    base64: string,
    overwrite?: boolean,
  ): Promise<ImageResult> {
    this.record('saveOpdrachtImage', [opdrachtId, name, ext, '<base64>', overwrite]);
    this.refuseIfReadOnly();
    return this.storeImage(opdrachtId, name, ext, fromBase64(base64), overwrite);
  }

  async pickImageFile(): Promise<{ token: string; name: string; ext: string } | null> {
    this.record('pickImageFile', []);
    return null; // the mock has no file dialog: behaves like "cancelled"
  }

  async importOpdrachtImage(
    opdrachtId: string,
    token: string,
    name: string,
    overwrite?: boolean,
  ): Promise<ImageResult> {
    this.record('importOpdrachtImage', [opdrachtId, token, name, overwrite]);
    return { ok: false, error: 'Kies de afbeelding opnieuw.' };
  }

  async readClipboardImage(): Promise<string | null> {
    this.record('readClipboardImage', []);
    return null;
  }

  async copyOpdrachtFolder(fromId: string, toId: string): Promise<{ ok: true }> {
    this.record('copyOpdrachtFolder', [fromId, toId]);
    checkOpdrachtId(fromId);
    checkOpdrachtId(toId);
    const from = `opdrachten/${fromId}/`;
    for (const [path, bytes] of [...this.files]) {
      if (!path.startsWith(from) || path === `${from}opdracht.json`) continue;
      this.putFile(`opdrachten/${toId}/${path.slice(from.length)}`, bytes);
    }
    // Like the app: whatever the source lacked comes from the templates.
    this.fillOpdrachtFolder(toId);
    return { ok: true };
  }

  async deleteOpdrachtFolder(opdrachtId: string): Promise<{ ok: true }> {
    this.record('deleteOpdrachtFolder', [opdrachtId]);
    checkOpdrachtId(opdrachtId);
    const dir = `opdrachten/${opdrachtId}`;
    for (const path of [...this.files.keys()])
      if (path.startsWith(`${dir}/`)) this.files.delete(path);
    for (const d of [...this.dirs]) if (d === dir || d.startsWith(`${dir}/`)) this.dirs.delete(d);
    return { ok: true };
  }

  // ── Presence, session, photos ─────────────────────────────────────────────

  private writePresence(userId: string, state: Record<string, unknown>): void {
    this.putFile(`aanwezigheid/${userId}.json`, encoder.encode(JSON.stringify(state, null, 2)));
  }

  async updatePresence(userId: string | null, state?: Record<string, unknown>): Promise<void> {
    this.record('updatePresence', [userId, state]);
    if (this.presence && this.presence.userId !== userId) {
      this.writePresence(this.presence.userId, {
        ...this.presence.state,
        online: false,
        scoreModal: null,
        heartbeatAt: new Date().toISOString(),
      });
      this.presence = null;
    }
    if (!userId) return;
    this.presence = { userId, state: state ?? {} };
    this.writePresence(userId, state ?? {});
  }

  async readLocalSession(): Promise<Record<string, unknown> | null> {
    this.record('readLocalSession', []);
    return this.session ? structuredClone(this.session) : null;
  }

  async writeLocalSession(data: Record<string, unknown>): Promise<void> {
    this.record('writeLocalSession', [data]);
    this.session = structuredClone(data);
  }

  async readPhotoAsDataUrl(relPath: string): Promise<string | null> {
    this.record('readPhotoAsDataUrl', [relPath]);
    const bytes = this.files.get(relPath);
    if (!bytes) return null;
    return `data:${MIME[extOf(relPath)] ?? 'image/jpeg'};base64,${toBase64(bytes)}`;
  }

  async savePhoto(relPath: string, base64Data: string): Promise<void> {
    this.record('savePhoto', [relPath, '<base64>']);
    this.refuseIfReadOnly();
    this.putFile(relPath, fromBase64(base64Data));
  }

  // ── Typst (canned output) ─────────────────────────────────────────────────

  /** A real PDF the next renders return instead of the canned one (tests, base64). */
  private realPdf: Uint8Array | null = null;

  useRealPdf(base64: string): void {
    this.realPdf = fromBase64(base64);
  }

  /** Typst warnings the next renders return (tests). */
  private renderWarnings: string[] = [];

  useRenderWarnings(warnings: string[]): void {
    this.renderWarnings = [...warnings];
  }

  private storePdf(name: string, pages: string[][]): string {
    const pdfPath = `C:\\Maatwerk-mock\\temp\\${name}`;
    this.pdfs.set(pdfPath, this.realPdf ?? cannedPdf(pages));
    const old = this.pdfUrls.get(pdfPath);
    if (old) URL.revokeObjectURL(old);
    this.pdfUrls.delete(pdfPath);
    return pdfPath;
  }

  async renderRapportPdf(
    examId: string,
    students: unknown[],
    examInfo: Record<string, unknown>,
  ): Promise<RenderResult<{ pdfPath: string; warnings: string[] }>> {
    this.record('renderRapportPdf', [examId, students, examInfo]);
    const title = String(examInfo?.name ?? examId); // payload field is name (domain/rapport.ts)
    const pages = students.map((s, i) => {
      const name = (s as { name?: unknown })?.name;
      return ['Rapport (mock)', title, typeof name === 'string' ? name : `Leerling ${i + 1}`];
    });
    return {
      success: true,
      pdfPath: this.storePdf('rapport_preview.pdf', pages.length ? pages : [['Rapport (mock)']]),
      warnings: [...this.renderWarnings],
    };
  }

  async renderAssignmentSvg(
    opdrachtId: string,
    title: string,
    previewContent?: string,
  ): Promise<RenderResult<{ pages: string[] }>> {
    this.record('renderAssignmentSvg', [opdrachtId, title, previewContent]);
    if (!/^[\w-]+$/.test(opdrachtId)) return { success: false, error: 'Ongeldige opdracht.' };
    const lines = (previewContent ?? '').split('\n').length;
    const escape = (s: string) =>
      s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="595pt" height="842pt" viewBox="0 0 595 842">' +
      '<rect width="595" height="842" fill="#fff"/>' +
      `<text x="72" y="96" font-size="20">${escape(title)} (mock)</text>` +
      `<text x="72" y="130" font-size="12">${escape(opdrachtId)}: ${lines} regels</text></svg>`;
    return { success: true, pages: [svg] };
  }

  async renderAssignmentBatch(
    jobs: BatchJob[],
    opts: BatchOptions = {},
  ): Promise<RenderResult<{ pdfPath: string; pages: number; warnings: string[] }>> {
    this.record('renderAssignmentBatch', [jobs, opts]);
    if (!Array.isArray(jobs) || jobs.length === 0)
      return { success: false, error: 'Er is niets om te genereren.' };
    const outputName = opts.outputName ?? 'opdrachten.pdf';
    if (jobs.some((j) => !/^[\w-]+$/.test(String(j.opdrachtId))))
      return { success: false, error: 'Ongeldige opdracht.' };
    if (baseName(outputName) !== outputName || outputName.includes('\\'))
      return { success: false, error: `Ongeldige bestandsnaam: ${outputName}` };
    const total = jobs.length;
    for (const cb of this.progressListeners) cb({ done: 0, total });
    const pages: string[][] = [];
    for (const [i, job] of jobs.entries()) {
      pages.push([
        job.header?.title ?? job.label ?? job.opdrachtId,
        job.header?.student ?? '',
        job.mode === 'answers' ? 'Antwoorden' : 'Opdracht',
      ]);
      for (const cb of this.progressListeners) cb({ done: i + 1, total });
    }
    return {
      success: true,
      pdfPath: this.storePdf(outputName, pages),
      pages: pages.length,
      warnings: [...this.renderWarnings],
    };
  }

  // ── Shell ─────────────────────────────────────────────────────────────────

  async openPath(target: string): Promise<string> {
    this.record('openPath', [target]);
    return '';
  }

  async printPdf(pdfPath: string, name: PrintName): Promise<string> {
    this.record('printPdf', [pdfPath, name]);
    const bytes = this.pdfs.get(pdfPath);
    if (!bytes) throw new Error(`not found: ${pdfPath}`);
    const parts = [name.soort, name.vak, name.groep, name.toets].filter((p) => p.trim());
    const relPath = `rapporten/${name.schooljaar}/2026-01-01 0000 ${parts.join(' ')}.pdf`;
    this.putFile(relPath, bytes);
    return relPath;
  }

  async setWatchYear(year: string | null): Promise<void> {
    this.record('setWatchYear', [year]);
  }

  async dataFolderStatus(): Promise<DataFolderStatus> {
    this.record('dataFolderStatus', []);
    const status = structuredClone(this.folderStatus);
    if (!status.error) status.readOnly = this.readOnly();
    return status;
  }

  /** Rejects like a backend command refused with `read_only`. */
  private refuseIfReadOnly(): void {
    if (this.readOnly()) throw { code: 'read_only', message: 'read-only', details: {} };
  }

  /** `minAppVersion` of the mock `school.json` when it is newer than the app (as the backend). */
  private readOnly(): string | null {
    const text = this.readText('school.json');
    if (text === null) return null;
    try {
      return requiredVersion(JSON.parse(text), this.folderStatus.appVersion);
    } catch {
      return null;
    }
  }

  async restartApp(): Promise<void> {
    this.record('restartApp', []);
  }

  async chooseDataFolder(): Promise<string | null> {
    this.record('chooseDataFolder', []);
    const picked = this.pickedFolder;
    if (picked !== null && typeof picked === 'object') {
      throw { code: 'invalid_argument', message: picked.refused, details: {} };
    }
    return picked;
  }

  async problemInfo(): Promise<ProblemInfo> {
    this.record('problemInfo', []);
    return { logDir: MOCK_LOG_DIR, version: '0.0.0-mock' };
  }

  async openLogFolder(): Promise<void> {
    this.record('openLogFolder', []);
  }

  /** Logged UI errors, for tests. */
  uiErrors: string[] = [];

  async logUiError(message: string): Promise<void> {
    this.record('logUiError', [message]);
    this.uiErrors.push(message);
  }

  async migrateDataFolder(dryRun?: boolean): Promise<MigrationResult> {
    this.record('migrateDataFolder', [dryRun]);
    const result = structuredClone(this.migration);
    if (!dryRun) return result;
    return { ...result, applied: false, backup: null, validation: null, reportFile: null };
  }

  async rubricUsage(): Promise<Partial<Record<string, RubricUse[]>>> {
    this.record('rubricUsage', []);
    return this.rubricUses();
  }

  /** As `maatwerk_core::rubrics::usage`: exams with a `rubric_id`, newest year first. */
  private rubricUses(): Partial<Record<string, RubricUse[]>> {
    const out: Partial<Record<string, RubricUse[]>> = {};
    const years = this.list('')
      .filter((n) => /^\d{4}-\d{4}$/.test(n))
      .sort()
      .reverse();
    for (const year of years) {
      for (const { data } of this.jsonFilesIn(`${year}/exams`)) {
        const exam = data as { id?: string; title?: string; rubric_id?: string } | null;
        if (!exam?.rubric_id) continue;
        (out[exam.rubric_id] ??= []).push({
          year,
          examId: exam.id ?? '',
          naam: exam.title ?? '',
        });
      }
    }
    return out;
  }

  /**
   * The `minAppVersion` this write raises to, as `rubrics::guard_write`: a rubric or a PO
   * observatie 0.12.0, a PO exam 0.13.0 (step 22); null for anything else.
   */
  private raisesPoVersion(relPath: string, data: Json): string | null {
    const isPoObs =
      /^observaties\//i.test(relPath) &&
      Array.isArray((data as { toetstypes?: unknown })?.toetstypes) &&
      (data as { toetstypes: unknown[] }).toetstypes.includes('po');
    if (/^rubrics\/[^/]+\.json$/i.test(relPath) || isPoObs) return '0.12.0';
    const isPoExam =
      /^[^/]+\/exams\/[^/]+\.json$/i.test(relPath) && (data as { kind?: unknown })?.kind === 'po';
    return isPoExam ? '0.13.0' : null;
  }

  /**
   * The core's write guard (`rubrics::guard_write`): a refusal message, or null. The caller raises
   * `minAppVersion` once the CAS has passed (review 21 m1).
   */
  private rubricGuard(relPath: string, data: Json): string | null {
    const id = /^rubrics\/([^/]+)\.json$/i.exec(relPath)?.[1];
    if (id) {
      const rubric = data as unknown as Rubric;
      if (rubric?.id !== id) return `Rubric niet opgeslagen: het id hoort ${id} te zijn`;
      const check = checkRubric(rubric);
      if (!check.valid) {
        const parts = [...check.errors];
        check.categories.forEach((c, i) => {
          if (c.errors.length) parts.push(`${rubric.categories[i]?.naam}: ${c.errors.join(' · ')}`);
        });
        return `Rubric niet opgeslagen: ${parts.join('; ')}`;
      }
      const old = this.readText(relPath);
      const n = this.rubricUses()[id]?.length ?? 0;
      if (old !== null && n > 0) {
        const locked = lockedChanges(JSON.parse(old) as Rubric, rubric);
        if (locked.length) {
          return (
            `Rubric niet opgeslagen: in gebruik bij ${n} ${n === 1 ? 'PO' : "PO's"}, ` +
            `dus maxima en soort liggen vast. ${locked.join('; ')}`
          );
        }
      }
    }
    return null;
  }

  private raiseMinAppVersion(min: string): void {
    const text = this.readText('school.json');
    if (text === null) return;
    const school = JSON.parse(text) as Record<string, unknown>;
    const current = typeof school.minAppVersion === 'string' ? school.minAppVersion : '';
    if (current && requiredVersion({ minAppVersion: min }, current) === null) return;
    school.minAppVersion = min;
    this.putFile('school.json', encoder.encode(JSON.stringify(school, null, 2) + '\n'));
  }

  async validateDataFolder(): Promise<DataCheck> {
    this.record('validateDataFolder', []);
    return structuredClone(this.dataCheck);
  }

  async stampIssues(): Promise<StampIssue[]> {
    this.record('stampIssues', []);
    return structuredClone(this.stamps);
  }

  async acceptStamp(relPath: string): Promise<void> {
    this.record('acceptStamp', [relPath]);
    this.stamps = this.stamps.filter((s) => s.path !== relPath);
    this.dataCheck.issues = this.dataCheck.issues.filter(
      (i) => !(i.kind === 'stamp' && i.path === relPath),
    );
  }

  // ── Accounts and snapshots (Step 7b) ──────────────────────────────────────

  private readUser(userId: string): UserRecord {
    if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error(`invalid path ${userId}`);
    const text = this.readText(`gebruikers/${userId}.json`);
    if (text === null) throw new Error(`not found: gebruikers/${userId}.json`);
    return JSON.parse(text) as UserRecord;
  }

  private writeUser(userId: string, change: (u: UserRecord) => void): Value {
    this.refuseIfReadOnly();
    const onDisk = this.readUser(userId);
    const next = structuredClone(onDisk);
    change(next);
    const saved = stampMeta(next, onDisk as { _meta?: never }, this.authSession ?? userId);
    this.putFile(
      `gebruikers/${userId}.json`,
      encoder.encode(JSON.stringify(saved, null, 2) + '\n'),
    );
    return saved as unknown as Value;
  }

  private throttled(key: string, ok: () => boolean): PinCheck {
    const now = Date.now();
    const f = this.pinFailures.get(key);
    const result = (outcome: PinCheck['outcome'], retryAfterMs = 0): PinCheck => ({
      outcome,
      retryAfterMs,
      user: null,
      recoveryCodes: null,
    });
    if (f && f.last + pinDelayMs(f.count) > now) {
      return result('wait', f.last + pinDelayMs(f.count) - now);
    }
    if (ok()) {
      this.pinFailures.delete(key);
      return result('ok');
    }
    const count = (f?.count ?? 0) + 1;
    this.pinFailures.set(key, { count, last: now });
    return result('wrong', pinDelayMs(count));
  }

  private requireAdmin(): string {
    const id = this.authSession;
    if (!id) throw new Error('Niet ingelogd.');
    const user = this.readUser(id);
    if (user.isAdmin !== true || user.actief === false) {
      throw new Error('Alleen de beheerder mag dit.');
    }
    return id;
  }

  private static newCodes(): string[] {
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    const half = () =>
      Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
        '',
      );
    return Array.from({ length: 10 }, () => `${half()}-${half()}`);
  }

  private static canonicalCode(code: string): string {
    const n = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return n.length === 8 ? `${n.slice(0, 4)}-${n.slice(4)}` : n;
  }

  async verifyPin(userId: string, pin: string): Promise<PinCheck> {
    this.record('verifyPin', [userId]);
    const user = this.readUser(userId);
    if (user.actief === false) throw new Error('Deze gebruiker is gedeactiveerd.');
    if (typeof user.pinHash !== 'string' || !user.pinHash) {
      return { outcome: 'noPin', retryAfterMs: 0, user: null, recoveryCodes: null };
    }
    const check = this.throttled(`pin:${userId}`, () => user.pinHash === `mock$${pin}`);
    if (check.outcome === 'ok') this.authSession = userId;
    return check;
  }

  async setFirstPin(userId: string, pin: string): Promise<PinCheck> {
    this.record('setFirstPin', [userId]);
    checkPinFormat(pin);
    const user = this.readUser(userId);
    if (user.actief === false) throw new Error('Deze gebruiker is gedeactiveerd.');
    if (user.pinHash) {
      throw new Error('Er is intussen al een pincode ingesteld. Log in met die pincode.');
    }
    const codes = user.isAdmin === true ? MockApi.newCodes() : null;
    const saved = this.writeUser(userId, (u) => {
      u.pinHash = `mock$${pin}`;
      if (codes) u.recoveryCodeHashes = codes.map((c) => `mock$${c}`);
    });
    this.authSession = userId;
    return { outcome: 'ok', retryAfterMs: 0, user: saved, recoveryCodes: codes };
  }

  async changePin(currentPin: string, newPin: string): Promise<PinCheck> {
    this.record('changePin', []);
    checkPinFormat(newPin);
    const id = this.authSession;
    if (!id) throw new Error('Niet ingelogd.');
    const check = await this.verifyPin(id, currentPin);
    if (check.outcome !== 'ok') return check;
    const saved = this.writeUser(id, (u) => {
      u.pinHash = `mock$${newPin}`;
    });
    return { ...check, user: saved };
  }

  async resetPin(userId: string): Promise<Json> {
    this.record('resetPin', [userId]);
    const admin = this.requireAdmin();
    if (admin === userId) throw new Error('Wijzig je eigen pincode via je profiel.');
    return this.writeUser(userId, (u) => {
      delete u.pinHash;
    });
  }

  async recoverWithCode(userId: string, code: string, newPin: string): Promise<PinCheck> {
    this.record('recoverWithCode', [userId]);
    checkPinFormat(newPin);
    const user = this.readUser(userId);
    if (user.isAdmin !== true) throw new Error('Alleen de beheerder heeft herstelcodes.');
    const hashes = Array.isArray(user.recoveryCodeHashes) ? user.recoveryCodeHashes : [];
    const used = `mock$${MockApi.canonicalCode(code)}`;
    const check = this.throttled(`recover:${userId}`, () => hashes.includes(used));
    if (check.outcome !== 'ok') return check;
    const saved = this.writeUser(userId, (u) => {
      u.recoveryCodeHashes = hashes.filter((h) => h !== used);
      u.pinHash = `mock$${newPin}`;
    });
    this.authSession = userId;
    return { ...check, user: saved };
  }

  async renewRecoveryCodes(pin: string): Promise<PinCheck> {
    this.record('renewRecoveryCodes', []);
    const admin = this.requireAdmin();
    const check = await this.verifyPin(admin, pin);
    if (check.outcome !== 'ok') return check;
    const codes = MockApi.newCodes();
    const saved = this.writeUser(admin, (u) => {
      u.recoveryCodeHashes = codes.map((c) => `mock$${c}`);
    });
    return { ...check, user: saved, recoveryCodes: codes };
  }

  async logout(): Promise<void> {
    this.record('logout', []);
    this.authSession = null;
  }

  /** The user logged in through the PIN methods (tests). */
  get loggedIn(): string | null {
    return this.authSession;
  }

  async saveTextAs(defaultName: string, content: string): Promise<string | null> {
    this.record('saveTextAs', [defaultName, content]);
    return `C:\\Users\\docent\\Documents\\${defaultName}`;
  }

  async listSnapshots(): Promise<string[]> {
    this.record('listSnapshots', []);
    return this.snapshots.map((s) => s.name);
  }

  async snapshotForFile(relPath: string): Promise<string | null> {
    this.record('snapshotForFile', [relPath]);
    return this.snapshots.find((s) => relPath in s.files)?.name ?? null;
  }

  async restoreFromSnapshot(relPath: string, snapshot: string): Promise<void> {
    this.record('restoreFromSnapshot', [relPath, snapshot]);
    this.requireAdmin();
    const copy = this.snapshots.find((s) => s.name === snapshot)?.files[relPath];
    if (copy === undefined) throw new Error(`not found: ${relPath}`);
    this.putFile(relPath, encoder.encode(JSON.stringify(copy, null, 2) + '\n'));
    this.stamps = this.stamps.filter((s) => s.path !== relPath);
    this.dataCheck.issues = this.dataCheck.issues.filter(
      (i) => !(i.kind === 'stamp' && i.path === relPath),
    );
  }

  // ── Live editor ───────────────────────────────────────────────────────────

  async editorOpen(opdrachtId: string, title: string): Promise<EditorOpened> {
    this.record('editorOpen', [opdrachtId, title]);
    checkOpdrachtId(opdrachtId);
    const files = await this.projectFilesStatus(opdrachtId);
    // EditorSettings::read: whole seconds 2-300 in instellingen.json, else 30.
    const instellingen = JSON.parse(this.readText('instellingen.json') ?? 'null') as {
      editor?: { compileTimeoutSeconds?: unknown };
    } | null;
    const t = instellingen?.editor?.compileTimeoutSeconds;
    this.editor.timeoutSeconds =
      typeof t === 'number' && Number.isInteger(t) && t >= 2 && t <= 300 ? t : 30;
    const session = this.editor.open((path) => this.readText(`opdrachten/${opdrachtId}/${path}`));
    return { session, files, timeoutSeconds: this.editor.timeoutSeconds };
  }

  async editorUpdate(session: number, path: string, text: string): Promise<number> {
    this.record('editorUpdate', [session, path, text.length]);
    return this.editor.update(session, path, text);
  }

  async editorUnset(session: number, path: string): Promise<number> {
    this.record('editorUnset', [session, path]);
    return this.editor.unset(session, path);
  }

  async editorRefresh(session: number): Promise<number> {
    this.record('editorRefresh', [session]);
    return this.editor.refresh(session);
  }

  async editorResend(session: number): Promise<number> {
    this.record('editorResend', [session]);
    return this.editor.resend(session);
  }

  async editorClose(session: number): Promise<void> {
    this.record('editorClose', [session]);
    this.editor.close(session);
  }

  async editorComplete(
    session: number,
    _path: string,
    text: string,
    offset: number,
    explicit: boolean,
  ): Promise<EditorCompletions | null> {
    return this.editor.complete(session, text, offset, explicit);
  }

  async editorHover(
    session: number,
    _path: string,
    text: string,
    offset: number,
  ): Promise<EditorHover | null> {
    return this.editor.hover(session, text, offset);
  }

  async editorDefinition(
    session: number,
    _path: string,
    text: string,
    offset: number,
  ): Promise<EditorRange | null> {
    return this.editor.definition(session, text, offset);
  }

  async editorJumpFromClick(
    session: number,
    page: number,
    x: number,
    y: number,
  ): Promise<EditorClickJump | null> {
    this.record('editorJumpFromClick', [session, page, x, y]);
    return this.editor.jumpFromClick(session, page, x, y);
  }

  async editorJumpFromCursor(
    session: number,
    _path: string,
    offset: number,
  ): Promise<EditorCursorJump | null> {
    return this.editor.jumpFromCursor(session, offset);
  }

  onEditorUpdate(cb: (update: EditorUpdateEvent) => void): Unsubscribe {
    return this.editor.onUpdate(cb);
  }

  async projectFilesStatus(opdrachtId: string): Promise<ProjectFileInfo[]> {
    checkOpdrachtId(opdrachtId);
    const out: ProjectFileInfo[] = [];
    for (const [file, bundled] of Object.entries(BUNDLED)) {
      const bytes = this.files.get(`opdrachten/${opdrachtId}/${file}`);
      const base = { file, bundledVersion: bundled.version };
      if (!bytes) {
        out.push({ ...base, state: 'missing', version: null, hash: null });
        continue;
      }
      const text = decoder.decode(bytes);
      const line = text.split('\n').find((l) => l.startsWith(bundled.marker));
      const version = line ? parseInt(line.slice(bundled.marker.length), 10) : null;
      const state =
        text === bundled.text
          ? 'current'
          : version !== null && version < bundled.version
            ? 'outdated'
            : 'modified';
      out.push({ ...base, state, version, hash: await sha1(bytes) });
    }
    return out;
  }

  async restoreProjectFile(
    opdrachtId: string,
    file: string,
    expectedHash: string | null,
  ): Promise<string> {
    this.record('restoreProjectFile', [opdrachtId, file, expectedHash]);
    checkOpdrachtId(opdrachtId);
    const bundled = BUNDLED[file];
    if (!bundled) throw new Error(`not a bundled project file: ${file}`);
    const rel = `opdrachten/${opdrachtId}/${file}`;
    const current = this.files.get(rel);
    const ok =
      expectedHash === null ? !current : !!current && (await sha1(current)) === expectedHash;
    if (!ok) throw new Error(`conflict on ${rel}`);
    const bytes = encoder.encode(bundled.text);
    this.putFile(rel, bytes);
    return sha1(bytes);
  }

  async bundledProjectFile(file: string): Promise<string> {
    const bundled = BUNDLED[file];
    if (!bundled) throw new Error(`not a bundled project file: ${file}`);
    return bundled.text;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  onDataChanged(cb: (changes: DataChange[]) => void): Unsubscribe {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onAssignmentProgress(cb: (progress: { done: number; total: number }) => void): Unsubscribe {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  pdfUrl(pdfPath: string): string {
    let url = this.pdfUrls.get(pdfPath);
    if (!url) {
      const bytes = this.pdfs.get(pdfPath) ?? cannedPdf([['Geen PDF (mock)']]);
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      this.pdfUrls.set(pdfPath, url);
    }
    return url;
  }
}
