// SPDX-License-Identifier: AGPL-3.0-or-later

// The editor's side of the live compile service (Step 8b, ADR-0002 section
// 12): CodeMirror extensions for diagnostics, autocomplete, hover and go to
// definition (typst-ide through the bridge), patching the SVG preview with
// only the changed pages, mapping clicks between preview and source, the
// vragen panel and the "Bekijk verschillen" view. editor-init.js wires these
// to the session; every bridge call goes through `LiveHost.call`, which the
// iframe proxies to the parent window.

import {
  autocompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap } from '@codemirror/view';
import type {
  EditorCompletions,
  EditorDiagnostic,
  EditorHover,
  EditorPoint,
  EditorRange,
  EditorUpdateEvent,
  EditorVragen,
} from './bridge/api';
import { diffLines } from './domain/textdiff';

/** What the extensions need from the editor. */
export interface LiveHost {
  /** The session id, or null before it opened (or when it failed). */
  session(): number | null;
  /** The file in the editor, relative to the opdracht folder (`opdracht.typ`). */
  file(): string;
  /** A bridge method through the parent (`editorComplete`, ...). */
  call<T>(method: string, ...args: unknown[]): Promise<T>;
  /** Go to a range in a project file (switching tabs when needed). */
  reveal(file: string, from: number, to: number): void;
}

// ── Diagnostics ────────────────────────────────────────────────────────────

/** The diagnostics of `file` for CodeMirror, ranges clamped to the document. */
export function cmDiagnostics(
  diagnostics: EditorDiagnostic[],
  file: string,
  docLength: number,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const d of diagnostics) {
    if (d.location?.file !== file) continue;
    const from = Math.min(d.location.from, docLength);
    const to = Math.min(Math.max(d.location.to, from), docLength);
    const hints = d.hints.map((h) => `\nTip: ${h}`).join('');
    out.push({
      from,
      to,
      severity: d.severity === 'warning' ? 'warning' : 'error',
      message: d.message + hints,
    });
  }
  return out;
}

/** Shows `diagnostics` (of every file) in the view for its file. */
export function showDiagnostics(view: EditorView, diagnostics: EditorDiagnostic[], file: string) {
  view.dispatch(
    setDiagnostics(view.state, cmDiagnostics(diagnostics, file, view.state.doc.length)),
  );
}

/** The status-bar text of a failed compile: `file:line:col: message` per error. */
export function diagnosticsText(diagnostics: EditorDiagnostic[]): string {
  return diagnostics
    .map((d) => {
      const where = d.location
        ? `${d.location.file}:${d.location.line}:${d.location.column}: `
        : '';
      const hints = d.hints.map((h) => `\n  Tip: ${h}`).join('');
      return `${d.severity === 'warning' ? 'waarschuwing' : 'fout'}: ${where}${d.message}${hints}`;
    })
    .join('\n\n');
}

// ── Help from typst-ide ────────────────────────────────────────────────────

const COMPLETION_TYPES: Record<string, string> = {
  func: 'function',
  type: 'type',
  param: 'property',
  constant: 'constant',
  path: 'text',
  package: 'namespace',
  label: 'variable',
  font: 'text',
  symbol: 'text',
  syntax: 'keyword',
};

export function toCompletion(item: EditorCompletions['items'][number]): Completion {
  return {
    label: item.label,
    type: COMPLETION_TYPES[item.kind] ?? 'text',
    detail: item.detail ?? undefined,
    apply: item.apply ? (item.apply.includes('${') ? snippet(item.apply) : item.apply) : undefined,
  };
}

/** Autocomplete, hover, Ctrl+click / F12 to the definition, and the lint gutter. */
export function liveExtensions(host: LiveHost): Extension[] {
  const text = (view: { state: { doc: { toString(): string } } }) => view.state.doc.toString();

  async function complete(ctx: CompletionContext): Promise<CompletionResult | null> {
    const session = host.session();
    if (session === null) return null;
    const r = await host
      .call<EditorCompletions | null>(
        'editorComplete',
        session,
        host.file(),
        ctx.state.doc.toString(),
        ctx.pos,
        ctx.explicit,
      )
      .catch(() => null);
    if (!r || ctx.aborted || !r.items.length) return null;
    return { from: r.from, options: r.items.map(toCompletion), validFor: /^[\p{L}\p{N}_-]*$/u };
  }

  const hover = hoverTooltip(async (view, pos) => {
    const session = host.session();
    if (session === null) return null;
    const r = await host
      .call<EditorHover | null>('editorHover', session, host.file(), text(view), pos)
      .catch(() => null);
    if (!r) return null;
    return {
      pos,
      create() {
        const dom = document.createElement(r.kind === 'code' ? 'pre' : 'div');
        dom.className = `cm-typst-hover cm-typst-hover-${r.kind}`;
        dom.textContent = r.text;
        return { dom };
      },
    };
  });

  async function goToDefinition(view: EditorView, pos: number): Promise<boolean> {
    const session = host.session();
    if (session === null) return false;
    const r = await host
      .call<EditorRange | null>('editorDefinition', session, host.file(), text(view), pos)
      .catch(() => null);
    if (r) host.reveal(r.file, r.from, r.to);
    return !!r;
  }

  return [
    lintGutter(),
    autocompletion({ override: [complete], activateOnTypingDelay: 150 }),
    hover,
    keymap.of([
      {
        key: 'F12',
        run: (view) => {
          void goToDefinition(view, view.state.selection.main.head);
          return true;
        },
      },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        event.preventDefault();
        void goToDefinition(view, pos);
        return true;
      },
    }),
  ];
}

// ── Preview ────────────────────────────────────────────────────────────────

/** Applies the changed pages of `update` to `viewer`; returns the page elements. */
export function patchPages(viewer: HTMLElement, update: EditorUpdateEvent): HTMLElement[] {
  const pages = [...viewer.querySelectorAll<HTMLElement>('.svg-page')];
  for (const p of update.pages) {
    while (pages.length <= p.index) {
      const el = document.createElement('div');
      el.className = 'svg-page';
      el.dataset.page = String(pages.length);
      viewer.appendChild(el);
      pages.push(el);
    }
    pages[p.index]!.innerHTML = p.svg;
    pages[p.index]!.dataset.hash = p.hash;
  }
  for (const extra of pages.splice(update.pageCount)) extra.remove();
  return pages;
}

/** A page's size in pt (from its SVG's viewBox). */
function pageSizePt(pageEl: HTMLElement): { width: number; height: number } {
  const vb = pageEl.querySelector('svg')?.viewBox?.baseVal;
  return { width: vb?.width || 595.28, height: vb?.height || 841.89 };
}

/** The page index and the point (pt) of a click in the preview, or null. */
export function clickPoint(event: MouseEvent): { page: number; x: number; y: number } | null {
  const pageEl = (event.target as Element | null)?.closest<HTMLElement>('.svg-page');
  const svg = pageEl?.querySelector('svg');
  if (!pageEl || !svg) return null;
  const rect = svg.getBoundingClientRect();
  const size = pageSizePt(pageEl);
  return {
    page: Number(pageEl.dataset.page),
    x: ((event.clientX - rect.left) * size.width) / rect.width,
    y: ((event.clientY - rect.top) * size.height) / rect.height,
  };
}

/**
 * Scrolls `point` into view (about a third from the top) unless it is visible,
 * and marks it briefly.
 */
export function showPoint(viewer: HTMLElement, point: EditorPoint, always = false): void {
  const pageEl = viewer.querySelectorAll<HTMLElement>('.svg-page')[point.page];
  const svg = pageEl?.querySelector('svg');
  if (!pageEl || !svg) return;
  const rect = svg.getBoundingClientRect();
  const size = pageSizePt(pageEl);
  const scale = rect.height / size.height;
  // f64 travels as `number | null` (NaN would be null); a point always has one.
  const y = point.y ?? 0;
  const yPx = rect.top + y * scale;
  const v = viewer.getBoundingClientRect();
  if (always || yPx < v.top + 8 || yPx > v.bottom - 8) {
    viewer.scrollTop += yPx - v.top - viewer.clientHeight / 3;
  }
  let mark = viewer.querySelector<HTMLElement>('.preview-mark');
  if (!mark) {
    mark = document.createElement('div');
    mark.className = 'preview-mark';
  }
  pageEl.appendChild(mark);
  mark.style.top = `${y * scale - 2}px`;
  mark.classList.remove('flash');
  void mark.offsetWidth; // restart the animation
  mark.classList.add('flash');
}

// ── Vragen ─────────────────────────────────────────────────────────────────

// Rounded to hundredths: sums of halves and tenths carry float noise (review 8b n2).
const nl = (n: number | null) => String(Math.round((n ?? 0) * 100) / 100).replace('.', ',');

/** The button text: "Vragen: 3 · 7 p", with a warning sign when there are checks. */
export function vragenSummary(v: EditorVragen): string {
  const warn = v.checks.length ? '⚠ ' : '';
  return `${warn}Vragen: ${v.items.length} · ${nl(v.totalPunten)} p`;
}

/** Fills the vragen panel; `onPick` gets the vraag clicked. */
export function renderVragen(
  panel: HTMLElement,
  v: EditorVragen,
  onPick: (item: EditorVragen['items'][number]) => void,
): void {
  panel.replaceChildren();
  if (v.checks.length) {
    const checks = document.createElement('ul');
    checks.className = 'vragen-checks';
    for (const c of v.checks) {
      const li = document.createElement('li');
      li.textContent = c;
      checks.appendChild(li);
    }
    panel.appendChild(checks);
  }
  if (v.items.length) {
    const table = document.createElement('table');
    table.className = 'vragen-table';
    const head = table.createTHead().insertRow();
    for (const h of ['Vraag', 'Punten', 'Antwoord']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    for (const item of v.items) {
      const row = body.insertRow();
      row.className = 'vragen-row';
      row.tabIndex = 0;
      row.insertCell().textContent = item.label;
      row.insertCell().textContent = item.punten === null ? '–' : nl(item.punten);
      row.insertCell().textContent = item.antwoord ?? '–';
      row.addEventListener('click', () => onPick(item));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onPick(item);
      });
    }
    const foot = table.createTFoot().insertRow();
    foot.insertCell().textContent = 'Totaal';
    foot.insertCell().textContent = nl(v.totalPunten);
    foot.insertCell();
    panel.appendChild(table);
  }
}

// ── Bekijk verschillen ─────────────────────────────────────────────────────

/** Fills `container` with the line diff of the copy against the bundled version. */
export function renderDiff(container: HTMLElement, copy: string, bundled: string): void {
  container.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'diff-view';
  for (const line of diffLines(copy, bundled)) {
    const row = document.createElement('div');
    row.className = `diff-${line.kind}`;
    const sign = line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  ';
    row.textContent = sign + line.text;
    pre.appendChild(row);
  }
  container.appendChild(pre);
}
