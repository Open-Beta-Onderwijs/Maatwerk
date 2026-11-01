// SPDX-License-Identifier: AGPL-3.0-or-later

// The live editor of the mock backend (Step 8b): enough of maatwerk-core's
// LiveEditor to drive the editor UI in Playwright, not a Typst compiler.
//
// - Pages: the text split at `#pagebreak()`; each page is an SVG (595x842 pt)
//   with one <text> per source line, 16 pt apart from y = 72.
// - Errors: an unclosed `[` or `(` (at the opener) and `#fout` (unknown
//   variable). `#traag` behaves like a compile the watchdog abandons.
// - Vragen: `#vraag(punten: n, antwoord: [..])` after `#opgave` markers,
//   labelled and checked like maatwerk-core's vragen().
// - Help: completions from a fixed word list, hover for those words,
//   definitions of `#let` names; jumps map lines to y positions and back.
// Debounce 50 ms; the latest generation wins, only changed pages are sent.

import type {
  EditorClickJump,
  EditorCompletions,
  EditorCursorJump,
  EditorDiagnostic,
  EditorHover,
  EditorPage,
  EditorRange,
  EditorUpdateEvent,
  EditorVraag,
  EditorVragen,
} from '../bindings';

const DEBOUNCE_MS = 50;
const LINE_Y0 = 72;
const LINE_DY = 16;
const WORDS = [
  'align',
  'block',
  'box',
  'figure',
  'grid',
  'image',
  'opgave',
  'table',
  'text',
  'vraag',
];
const PAGEBREAK = '#pagebreak()';

export function mockTimeoutMessage(seconds: number): string {
  return (
    `Het compileren duurde langer dan ${seconds} seconden en is afgebroken. Maak de opdracht ` +
    'kleiner of vraag de beheerder om de tijdslimiet (Instellingen) te verhogen.'
  );
}

interface Session {
  id: number;
  read: (path: string) => string | null;
  buffers: Map<string, string>;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  shown: string[];
  previewGeneration: number | null;
  /** The text of the last good compile, for jumps (null when edited since). */
  compiledText: string | null;
  resend: boolean;
  timeoutSeconds: number;
}

function escapeXml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Offsets where each page starts, and the page texts. */
function splitPages(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let start = 0;
  for (;;) {
    const i = text.indexOf(PAGEBREAK, start);
    if (i < 0) break;
    out.push({ start, text: text.slice(start, i) });
    start = i + PAGEBREAK.length;
  }
  out.push({ start, text: text.slice(start) });
  return out;
}

/** The page that holds `offset`. */
function pageOf(pages: { start: number }[], offset: number): number {
  let page = 0;
  pages.forEach((p, i) => {
    if (p.start <= offset) page = i;
  });
  return page;
}

function lineCol(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, column: before[before.length - 1]!.length + 1 };
}

function diag(text: string, from: number, to: number, message: string): EditorDiagnostic {
  return {
    severity: 'error',
    message,
    hints: [],
    location: { file: 'opdracht.typ', ...lineCol(text, from), from, to },
  };
}

function errorsOf(text: string): EditorDiagnostic[] {
  const out: EditorDiagnostic[] = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[' || c === '(') stack.push(i);
    else if ((c === ']' || c === ')') && stack.length) stack.pop();
  }
  for (const at of stack) out.push(diag(text, at, at + 1, 'unclosed delimiter'));
  for (const m of text.matchAll(/#fout\b/g)) {
    out.push(diag(text, m.index + 1, m.index + 5, 'unknown variable: fout'));
  }
  return out.sort((a, b) => a.location!.from - b.location!.from);
}

function letters(n: number): string {
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

export function mockVragen(text: string): EditorVragen {
  const raw: { opgave: number; punten: number | null; antwoord: string | null; at: number }[] = [];
  for (const m of text.matchAll(/#vraag\(([^)]*)\)/g)) {
    const args = m[1]!;
    const opgave = (text.slice(0, m.index).match(/#opgave\b/g) ?? []).length;
    const punten = /punten:\s*([\d.]+)/.exec(args);
    const antwoord = /antwoord:\s*\[([^\]]*)\]/.exec(args);
    raw.push({
      opgave,
      punten: punten ? Number(punten[1]) : null,
      antwoord: antwoord ? antwoord[1]!.trim() : null,
      at: m.index,
    });
  }
  const pages = splitPages(text);
  const items: EditorVraag[] = raw.map((v, i) => {
    const same = raw.filter((w) => w.opgave === v.opgave);
    const nr = raw.slice(0, i + 1).filter((w) => w.opgave === v.opgave).length;
    const page = pageOf(pages, v.at);
    const line = text.slice(pages[page]!.start, v.at).split('\n').length - 1;
    return {
      opgave: v.opgave,
      label: `${v.opgave}${same.length > 1 ? letters(nr) : ''}`,
      punten: v.punten,
      antwoord: v.antwoord,
      page,
      y: LINE_Y0 + line * LINE_DY,
    };
  });
  const checks: string[] = [];
  if (!items.length) checks.push('De opdracht heeft geen vragen.');
  for (const v of items) {
    const name = v.opgave === 0 ? 'Een vraag buiten een opgave' : `Vraag ${v.label}`;
    if (v.opgave === 0) checks.push(`${name} staat niet in een #opgave.`);
    if (v.punten === null) checks.push(`${name} heeft geen punten.`);
    if (!v.antwoord) checks.push(`${name} heeft geen antwoord.`);
  }
  return {
    items,
    totalPunten: items.reduce((sum, v) => sum + (v.punten ?? 0), 0),
    checks,
  };
}

function pageSvg(page: string, index: number): string {
  const lines = page
    .split('\n')
    .map(
      (l, i) =>
        `<text x="72" y="${LINE_Y0 + i * LINE_DY}" font-size="11">${escapeXml(l) || ' '}</text>`,
    )
    .join('');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="595pt" height="842pt" viewBox="0 0 595 842">' +
    `<rect width="595" height="842" fill="#fff"/>${lines}` +
    `<text x="520" y="820" font-size="9">${index + 1}</text></svg>`
  );
}

function identAt(text: string, offset: number): { from: number; to: number; word: string } {
  let from = offset;
  let to = offset;
  while (from > 0 && /[\w-]/.test(text[from - 1]!)) from--;
  while (to < text.length && /[\w-]/.test(text[to]!)) to++;
  return { from, to, word: text.slice(from, to) };
}

export class MockEditor {
  private sessions = new Map<number, Session>();
  private listeners = new Set<(u: EditorUpdateEvent) => void>();
  private next = 0;
  /** Compile time limit in seconds (the `instellingen.json` setting). */
  timeoutSeconds = 30;
  /** The latest update per session, for tests. */
  readonly updates: EditorUpdateEvent[] = [];

  open(read: (path: string) => string | null): number {
    for (const id of [...this.sessions.keys()]) this.close(id);
    const id = ++this.next;
    const session: Session = {
      id,
      read,
      buffers: new Map(),
      generation: 0,
      timer: null,
      shown: [],
      previewGeneration: null,
      compiledText: null,
      resend: false,
      timeoutSeconds: this.timeoutSeconds,
    };
    this.sessions.set(id, session);
    this.schedule(session, 0);
    return id;
  }

  private get(id: number): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`not found: editor session ${id}`);
    return s;
  }

  private text(s: Session): string {
    return s.buffers.get('opdracht.typ') ?? s.read('opdracht.typ') ?? '';
  }

  private bump(id: number, change: (s: Session) => void): number {
    const s = this.get(id);
    change(s);
    s.generation += 1;
    this.schedule(s, DEBOUNCE_MS);
    return s.generation;
  }

  update(id: number, path: string, text: string): number {
    return this.bump(id, (s) => {
      if (s.buffers.get(path) !== text) s.compiledText = null;
      s.buffers.set(path, text);
    });
  }

  unset(id: number, path: string): number {
    return this.bump(id, (s) => {
      s.buffers.delete(path);
      s.compiledText = null;
    });
  }

  refresh(id: number): number {
    return this.bump(id, () => {});
  }

  resend(id: number): number {
    return this.bump(id, (s) => (s.resend = true));
  }

  close(id: number): void {
    const s = this.sessions.get(id);
    if (s?.timer) clearTimeout(s.timer);
    this.sessions.delete(id);
  }

  onUpdate(cb: (u: EditorUpdateEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private schedule(s: Session, ms: number): void {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = null;
      if (this.sessions.get(s.id) === s) this.compile(s);
    }, ms);
  }

  private compile(s: Session): void {
    const generation = s.generation;
    const text = this.text(s);
    if (s.resend) {
      s.shown = [];
      s.resend = false;
    }
    const base = {
      session: s.id,
      generation,
      compileMs: 1,
      renderMs: 0,
    };
    if (text.includes('#traag')) {
      this.emit({
        ...base,
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            message: mockTimeoutMessage(s.timeoutSeconds),
            hints: [],
            location: null,
          },
        ],
        previewGeneration: s.previewGeneration,
        pageCount: s.shown.length,
        pages: [],
        vragen: null,
      });
      return;
    }
    const errors = errorsOf(text);
    if (errors.length) {
      s.compiledText = null;
      this.emit({
        ...base,
        ok: false,
        diagnostics: errors,
        previewGeneration: s.previewGeneration,
        pageCount: s.shown.length,
        pages: [],
        vragen: null,
      });
      return;
    }
    const pages: EditorPage[] = [];
    const shown = splitPages(text).map((p, index) => {
      const svg = pageSvg(p.text, index);
      const h = hash(svg);
      if (s.shown[index] !== h) pages.push({ index, hash: h, svg });
      return h;
    });
    s.shown = shown;
    s.previewGeneration = generation;
    s.compiledText = text;
    this.emit({
      ...base,
      ok: true,
      diagnostics: [],
      previewGeneration: generation,
      pageCount: shown.length,
      pages,
      vragen: mockVragen(text),
    });
  }

  private emit(u: EditorUpdateEvent): void {
    this.updates.push(u);
    for (const cb of this.listeners) cb(u);
  }

  complete(id: number, text: string, offset: number, explicit: boolean): EditorCompletions | null {
    this.get(id);
    const { from, word } = identAt(text, offset);
    if (!explicit && (from === 0 || text[from - 1] !== '#')) return null;
    const items = WORDS.filter((w) => w.startsWith(word)).map((w) => ({
      kind: 'func',
      label: w,
      apply: `${w}(\${})`,
      detail: `${w} (mock)`,
    }));
    return items.length ? { from, items } : null;
  }

  hover(id: number, text: string, offset: number): EditorHover | null {
    this.get(id);
    const { word } = identAt(text, offset);
    return WORDS.includes(word) ? { kind: 'text', text: `${word}: uitleg (mock)` } : null;
  }

  definition(id: number, text: string, offset: number): EditorRange | null {
    this.get(id);
    const { word } = identAt(text, offset);
    if (!word) return null;
    const m = new RegExp(`#let\\s+(${word.replace(/[-]/g, '\\-')})\\b`).exec(text);
    if (!m) return null;
    const from = m.index + m[0].length - word.length;
    return { file: 'opdracht.typ', from, to: from + word.length };
  }

  jumpFromClick(id: number, page: number, _x: number, y: number): EditorClickJump | null {
    const s = this.get(id);
    if (s.compiledText === null || s.previewGeneration === null) return null;
    const p = splitPages(s.compiledText)[page];
    if (!p) return null;
    const lines = p.text.split('\n');
    const line = Math.round((y - LINE_Y0) / LINE_DY);
    if (line < 0 || line >= lines.length) return null;
    const offset = p.start + lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
    return { generation: s.previewGeneration, file: 'opdracht.typ', offset, point: null };
  }

  jumpFromCursor(id: number, offset: number): EditorCursorJump | null {
    const s = this.get(id);
    if (s.compiledText === null || s.previewGeneration === null) return null;
    const pages = splitPages(s.compiledText);
    const page = pageOf(pages, offset);
    const line = s.compiledText.slice(pages[page]!.start, offset).split('\n').length - 1;
    return {
      generation: s.previewGeneration,
      points: [{ page, x: 72, y: LINE_Y0 + line * LINE_DY }],
    };
  }
}
