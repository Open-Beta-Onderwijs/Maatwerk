// SPDX-License-Identifier: AGPL-3.0-or-later

// In-memory backend for `npm run dev:mock`, Vitest and Playwright. Emulates the
// reference main process (docs/reference/ipc-api.md) on a virtual data folder
// seeded from tools/fixtures: CAS on the SHA-1 of the file bytes, own writes
// are not echoed, external writes (test hooks below) emit `data:changed`.
// Typst calls return canned output. Nothing is persisted: a reload starts over.

import type {
  BatchJob,
  BatchOptions,
  DataChange,
  FsResult,
  ImageResult,
  Json,
  MaatwerkApi,
  OpdrachtImage,
  RenderResult,
  Unsubscribe,
} from '../api';
import { cannedPdf } from './pdf';

/** A snapshot of a data folder: file contents (text or base64) and folders. */
export interface MockSeed {
  files: Record<string, { text: string } | { base64: string }>;
  dirs: string[];
}

export const MOCK_DATA_DIR = 'C:\\Maatwerk-mock\\data';
const SUBJECTS = ['nat', 'bio', 'schk', 'wi'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
const MIME: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  webp: 'image/webp',
};
const BASE_ASSIGNMENT = '#import "lib.typ": *\n\n// Nieuwe opdracht (mock-sjabloon)\n';

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
  /** Calls made through the bridge, for tests (`[method, ...args]`). */
  readonly calls: [string, ...unknown[]][] = [];

  constructor(seed: MockSeed = { files: {}, dirs: [] }) {
    for (const [rel, content] of Object.entries(seed.files)) {
      this.putFile(
        rel,
        'text' in content ? encoder.encode(content.text) : fromBase64(content.base64),
      );
    }
    for (const dir of seed.dirs) this.mkdir(dir);
    // seedInitialData() in main.js
    this.mkdir('fotos');
    this.mkdir('opdrachten/images');
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

  private record(method: string, args: unknown[]): void {
    this.calls.push([method, ...args]);
  }

  // ── Test hooks (not part of MaatwerkApi) ──────────────────────────────────

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
    if (opts.cas) {
      const current = this.files.get(relPath);
      const currentHash = current ? await sha1(current) : null;
      if (currentHash !== (opts.expectedHash ?? null)) return { ok: false, reason: 'conflict' };
    }
    const bytes = encoder.encode(JSON.stringify(data, null, 2));
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
    const out: Json[] = [];
    for (const name of this.list(dirRelPath)) {
      if (!name.endsWith('.json')) continue;
      const text = this.readText(`${dirRelPath}/${name}`);
      if (text === null) continue; // a directory
      try {
        const data = JSON.parse(text);
        if (data !== null) out.push(data);
      } catch {
        // skipped silently, as the reference does
      }
    }
    return out;
  }

  async deleteFile(relPath: string): Promise<FsResult> {
    this.record('deleteFile', [relPath]);
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

  async writeTextFile(relPath: string, content: string): Promise<{ ok: true }> {
    this.record('writeTextFile', [relPath, content]);
    this.putFile(relPath, encoder.encode(content));
    return { ok: true };
  }

  async createAssignmentTypFile(typFile: string): Promise<{ ok: true }> {
    this.record('createAssignmentTypFile', [typFile]);
    this.putFile(`opdrachten/${typFile}`, encoder.encode(BASE_ASSIGNMENT));
    return { ok: true };
  }

  // ── Opdracht images ───────────────────────────────────────────────────────

  async listOpdrachtImages(opdrachtId: string): Promise<OpdrachtImage[]> {
    this.record('listOpdrachtImages', [opdrachtId]);
    checkOpdrachtId(opdrachtId);
    const dir = `opdrachten/images/${opdrachtId}`;
    return this.list(dir)
      .filter((f) => IMAGE_EXTS.includes(extOf(f)) && this.files.has(`${dir}/${f}`))
      .sort((a, b) => a.localeCompare(b, 'nl'))
      .map((f) => {
        const ext = extOf(f);
        const bytes = this.files.get(`${dir}/${f}`)!;
        const thumb =
          ext === 'svg' ? null : `data:${MIME[ext] ?? 'image/jpeg'};base64,${toBase64(bytes)}`;
        return { file: `images/${opdrachtId}/${f}`, name: stem(f), thumb };
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
    const dir = `opdrachten/images/${opdrachtId}`;
    this.mkdir(dir);
    const existing = this.list(dir).filter((f) => stem(f) === name);
    if (existing.length && !overwrite) return { ok: false, exists: true, name };
    for (const f of existing) this.files.delete(`${dir}/${f}`);
    const file = `${name}.${ext}`;
    this.putFile(`${dir}/${file}`, bytes);
    return { ok: true, file: `images/${opdrachtId}/${file}`, name };
  }

  async saveOpdrachtImage(
    opdrachtId: string,
    name: string,
    ext: string,
    base64: string,
    overwrite?: boolean,
  ): Promise<ImageResult> {
    this.record('saveOpdrachtImage', [opdrachtId, name, ext, '<base64>', overwrite]);
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

  async copyOpdrachtImages(fromId: string, toId: string): Promise<{ ok: true }> {
    this.record('copyOpdrachtImages', [fromId, toId]);
    checkOpdrachtId(fromId);
    checkOpdrachtId(toId);
    const from = `opdrachten/images/${fromId}`;
    for (const f of this.list(from)) {
      const bytes = this.files.get(`${from}/${f}`);
      if (bytes) this.putFile(`opdrachten/images/${toId}/${f}`, bytes);
    }
    return { ok: true };
  }

  async deleteOpdrachtImages(opdrachtId: string): Promise<{ ok: true }> {
    this.record('deleteOpdrachtImages', [opdrachtId]);
    checkOpdrachtId(opdrachtId);
    const dir = `opdrachten/images/${opdrachtId}`;
    for (const path of [...this.files.keys()])
      if (path.startsWith(`${dir}/`)) this.files.delete(path);
    this.dirs.delete(dir);
    return { ok: true };
  }

  // ── Presence, session, photos ─────────────────────────────────────────────

  private writePresence(userId: string, state: Record<string, unknown>): void {
    this.putFile(`users/${userId}.json`, encoder.encode(JSON.stringify(state, null, 2)));
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
    this.putFile(relPath, fromBase64(base64Data));
  }

  // ── Typst (canned output) ─────────────────────────────────────────────────

  private storePdf(name: string, pages: string[][]): string {
    const pdfPath = `C:\\Maatwerk-mock\\temp\\${name}`;
    this.pdfs.set(pdfPath, cannedPdf(pages));
    const old = this.pdfUrls.get(pdfPath);
    if (old) URL.revokeObjectURL(old);
    this.pdfUrls.delete(pdfPath);
    return pdfPath;
  }

  async renderRapportPdf(
    examId: string,
    students: unknown[],
    examInfo: Record<string, unknown>,
  ): Promise<RenderResult<{ pdfPath: string }>> {
    this.record('renderRapportPdf', [examId, students, examInfo]);
    const title = String(examInfo?.title ?? examId);
    const pages = students.map((s, i) => {
      const name = (s as { name?: unknown })?.name;
      return ['Rapport (mock)', title, typeof name === 'string' ? name : `Leerling ${i + 1}`];
    });
    return {
      success: true,
      pdfPath: this.storePdf('rapport_preview.pdf', pages.length ? pages : [['Rapport (mock)']]),
    };
  }

  async renderAssignmentSvg(
    typFile: string,
    title: string,
    previewContent?: string,
  ): Promise<RenderResult<{ pages: string[] }>> {
    this.record('renderAssignmentSvg', [typFile, title, previewContent]);
    if (baseName(typFile) !== typFile || typFile.includes('\\'))
      return { success: false, error: `Ongeldige bestandsnaam: ${typFile}` };
    const lines = (previewContent ?? '').split('\n').length;
    const escape = (s: string) =>
      s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="595pt" height="842pt" viewBox="0 0 595 842">' +
      '<rect width="595" height="842" fill="#fff"/>' +
      `<text x="72" y="96" font-size="20">${escape(title)} (mock)</text>` +
      `<text x="72" y="130" font-size="12">${escape(typFile)}: ${lines} regels</text></svg>`;
    return { success: true, pages: [svg] };
  }

  async renderAssignmentBatch(
    jobs: BatchJob[],
    opts: BatchOptions = {},
  ): Promise<RenderResult<{ pdfPath: string; pages: number }>> {
    this.record('renderAssignmentBatch', [jobs, opts]);
    if (!Array.isArray(jobs) || jobs.length === 0)
      return { success: false, error: 'Er is niets om te genereren.' };
    const outputName = opts.outputName ?? 'opdrachten.pdf';
    for (const name of [...jobs.map((j) => j.typFile), outputName]) {
      if (baseName(name) !== name || name.includes('\\'))
        return { success: false, error: `Ongeldige bestandsnaam: ${name}` };
    }
    const total = jobs.length;
    for (const cb of this.progressListeners) cb({ done: 0, total });
    const pages: string[][] = [];
    for (const [i, job] of jobs.entries()) {
      pages.push([
        job.header?.title ?? job.label ?? job.typFile,
        job.header?.student ?? '',
        job.mode === 'answers' ? 'Antwoorden' : 'Opdracht',
      ]);
      for (const cb of this.progressListeners) cb({ done: i + 1, total });
    }
    return { success: true, pdfPath: this.storePdf(outputName, pages), pages: pages.length };
  }

  // ── Shell ─────────────────────────────────────────────────────────────────

  async openPath(absPath: string): Promise<string> {
    this.record('openPath', [absPath]);
    return '';
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
