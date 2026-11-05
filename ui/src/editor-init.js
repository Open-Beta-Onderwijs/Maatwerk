// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * editor-init.js — CodeMirror 6 setup for the Typst assignment editor.
 *
 * Loaded as an ES module inside editor.html (which runs inside the #editor-frame
 * iframe). Does NOT have access to window.maatwerk directly; all file I/O and
 * compilation is done by posting messages to the parent window, which proxies
 * the calls via modals/editor.js. The preview comes from a live compile session
 * in Rust (Step 8b, editor-live.ts): edits go to it as they happen, changed
 * pages and diagnostics come back as `maatwerk-editor-update` messages.
 *
 * CodeMirror comes from npm (pinned in ui/package.json); Vite bundles one copy
 * of @codemirror/state, so the "multiple instances" instanceof error of separate
 * CDN bundles cannot occur.
 */

import { EditorState, RangeSetBuilder, countColumn } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
  ViewPlugin,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from '@codemirror/commands';
import {
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
  bracketMatching,
} from '@codemirror/language';
import { Tag, tags } from '@lezer/highlight';
import { applyStyleData } from './legacy/style-data';
import { renderAvatar } from './components/avatar';
import editorCmCss from './editor-cm.css?inline';
import { blockFileDrops } from './utils/no-file-drop';
import {
  clickPoint,
  diagnosticsText,
  liveExtensions,
  patchPages,
  renderDiff,
  renderVragen,
  showDiagnostics,
  showPoint,
  vragenSummary,
} from './editor-live';

blockFileDrops();

// editor.html has no style="" (strict CSP): initial hidden states are data-display.
applyStyleData(document);

// ── postMessage bridge ────────────────────────────────────────────────────────

let _seq = 0;
const _pending = {};

// Rejects when the parent answers with `error` (D25: the reference never
// answered a failed call, so the promise stayed pending forever).
function postToParent(type, data = {}) {
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    _pending[id] = { resolve, reject };
    window.parent.postMessage({ type, id, ...data }, '*');
  });
}

/**
 * postToParent for the figure and clipboard actions: a failed call (D25) shows
 * the reason in the status bar and yields `fallback` instead of an unhandled
 * rejection (review 3a m3).
 */
function askParent(type, data, fallback) {
  return postToParent(type, data).catch((err) => {
    setStatus('Fout bij afbeelding', err.message);
    return typeof fallback === 'function' ? fallback(err) : fallback;
  });
}

/**
 * Asks the teacher in the app's own dialog (in the parent window). Never the
 * native window.confirm: in Tauri, tauri-plugin-dialog makes it async, so it
 * returns a Promise and `!window.confirm(...)` never stops anything (M-OPD-9).
 * Resolves false when the dialog cannot be shown.
 */
function askConfirm(message, { okLabel = 'OK', danger = false } = {}) {
  return postToParent('maatwerk-confirm', { message, okLabel, danger }).then(
    (ok) => ok === true,
    () => false,
  );
}

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg?.type === 'maatwerk-response' && _pending[msg.id]) {
    const { resolve, reject } = _pending[msg.id];
    delete _pending[msg.id];
    if (msg.error !== undefined) reject(new Error(msg.error));
    else resolve(msg.result);
  }
});

// ── Typst StreamLanguage definition ──────────────────────────────────────────

// Lezer has no underline tag, so the stream tokens map to a custom one.
const underlineTag = Tag.define();

// Token styling lives in editor-cm.css as .cm-<token> classes.
const typstHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, class: 'cm-comment' },
  { tag: tags.keyword, class: 'cm-keyword' },
  { tag: tags.string, class: 'cm-string' },
  { tag: tags.number, class: 'cm-number' },
  { tag: tags.heading, class: 'cm-heading' },
  { tag: tags.strong, class: 'cm-strong' },
  { tag: tags.emphasis, class: 'cm-em' },
  { tag: tags.meta, class: 'cm-meta' },
  { tag: underlineTag, class: 'cm-underline' },
]);

const typstLanguage = StreamLanguage.define({
  name: 'typst',
  tokenTable: { underline: underlineTag },
  languageData: { commentTokens: { line: '//' } },
  startState: () => ({
    inBlockComment: false,
    inMath: false,
    awaitUnderlineBracket: false,
    underlineDepth: 0,
  }),

  token(stream, state) {
    // Underline: waiting for [ after #underline
    if (state.awaitUnderlineBracket) {
      if (stream.eatSpace()) return null;
      state.awaitUnderlineBracket = false;
      if (stream.peek() === '[') {
        stream.next();
        state.underlineDepth = 1;
        return 'underline';
      }
    }

    // Underline: inside #underline[…]
    if (state.underlineDepth > 0) {
      if (stream.peek() === '[') {
        stream.next();
        state.underlineDepth++;
        return 'underline';
      }
      if (stream.peek() === ']') {
        stream.next();
        state.underlineDepth--;
        return 'underline';
      }
      while (!stream.eol() && stream.peek() !== '[' && stream.peek() !== ']') stream.next();
      return 'underline';
    }

    // Block comment
    if (state.inBlockComment) {
      if (stream.match('*/')) {
        state.inBlockComment = false;
      } else {
        stream.next();
      }
      return 'comment';
    }

    // Line comment
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    // Block comment start
    if (stream.match('/*')) {
      state.inBlockComment = true;
      return 'comment';
    }

    // Math mode toggle $...$
    if (stream.peek() === '$') {
      stream.next();
      if (state.inMath) {
        state.inMath = false;
        return 'meta';
      }
      state.inMath = true;
      return 'meta';
    }
    if (state.inMath) {
      stream.next();
      return 'meta';
    }

    // Raw string blocks (backtick)
    if (stream.peek() === '`') {
      stream.next();
      while (!stream.eol() && stream.peek() !== '`') stream.next();
      if (!stream.eol()) stream.next();
      return 'string';
    }

    // String literals
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol() && stream.peek() !== '"') {
        if (stream.peek() === '\\') stream.next();
        stream.next();
      }
      if (!stream.eol()) stream.next();
      return 'string';
    }

    // Headings at the start of a line: = / == / ===
    if (stream.sol() && stream.match(/^={1,3}\s/)) {
      stream.skipToEnd();
      return 'heading';
    }

    // Typst keywords/functions: #identifier
    if (stream.peek() === '#') {
      stream.next();
      if (stream.match(/^underline(?![a-zA-Z0-9_])/)) {
        state.awaitUnderlineBracket = true;
        return 'keyword';
      }
      if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
        return 'keyword';
      }
      return null;
    }

    // Bold *...* / emphasis _..._: like Typst, the markers only count at word
    // boundaries (render_uitleg is no emphasis), and only with a closing marker
    // on the same line.
    const prev = stream.string.charAt(stream.pos - 1);
    if (!/[\p{L}\p{N}]/u.test(prev)) {
      if (stream.match(/^\*(?:[^*]|(?<=[\p{L}\p{N}])\*(?=[\p{L}\p{N}]))+\*(?![\p{L}\p{N}])/u))
        return 'strong';
      if (stream.match(/^_(?:[^_]|(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}]))+_(?![\p{L}\p{N}])/u))
        return 'emphasis';
    }

    // Numbers
    if (stream.match(/^\d+(\.\d+)?(pt|em|cm|mm|in|%)?/)) {
      return 'number';
    }

    stream.next();
    return null;
  },
});

// ── Wrapped line indent ───────────────────────────────────────────────────────

// Wrapped parts of a line start under its text, plus 2 extra columns so they
// read as a continuation. Hanging indent: the line gets padding for the whole
// indent and a negative text-indent of the same size, so only its first row
// starts at the left edge (6px is CodeMirror's own .cm-line padding).
const WRAP_EXTRA_COLS = 2;
const _wrapIndentDecos = new Map();

function wrapIndentDeco(cols) {
  let deco = _wrapIndentDecos.get(cols);
  if (!deco) {
    deco = Decoration.line({
      attributes: { style: `padding-left: calc(6px + ${cols}ch); text-indent: -${cols}ch` },
    });
    _wrapIndentDecos.set(cols, deco);
  }
  return deco;
}

function buildWrapIndent(view) {
  const builder = new RangeSetBuilder();
  const { doc, tabSize } = view.state;
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine) continue;
      lastLine = line.number;
      const indent = /^[ \t]*/.exec(line.text)[0];
      const cols = countColumn(indent, tabSize) + WRAP_EXTRA_COLS;
      builder.add(line.from, line.from, wrapIndentDeco(cols));
    }
  }
  return builder.finish();
}

const wrapIndent = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildWrapIndent(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildWrapIndent(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Initialisation ────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
// The opdracht folder (C14). The editor edits its opdracht.typ and, with a
// warning, its own main.typ and lib.typ (ADR-0002 5a).
const opdrachtId = params.get('id') ?? '';
const naam = params.get('naam') ?? 'Opdracht';
const MAIN_FILE = 'opdracht.typ';
const LAYOUT_FILES = ['main.typ', 'lib.typ'];
const filePath = (file) => `opdrachten/${opdrachtId}/${file}`;

document.getElementById('editor-title-naam').textContent = naam;

document.getElementById('btn-app-title').addEventListener('click', () => {
  closeAfterSave('editor-close');
});

// The user's avatar, as in the main window's top bar (B-08: photo or initials).
const badgeBtn = document.getElementById('editor-badge-btn');
postToParent('maatwerk-user-avatar')
  .then((a) => {
    if (!a) return;
    badgeBtn.title = `${a.name}: terug naar het gebruikersmenu`;
    // The photo comes with the answer (the iframe has no bridge of its own).
    const user = { ...a.user, foto: a.photo ? `editor:${a.name}` : null };
    const opts = { size: 30, ring: 'accent', square: a.square };
    return renderAvatar(badgeBtn, user, opts, () => Promise.resolve(a.photo));
  })
  .catch((e) => console.warn('[editor] avatar', e));
badgeBtn.addEventListener('click', () => {
  closeAfterSave('editor-logout');
});

let view = null;
let dataDir = null;
let saveTimer = null;

// ── Error popover ─────────────────────────────────────────────────────────────

const _popover = document.getElementById('error-popover');
let _popoverOpen = false;

function openErrorPopover(anchorEl) {
  _popoverOpen = true;
  _popover.style.display = '';
  const rect = anchorEl.getBoundingClientRect();
  const pw = Math.min(560, window.innerWidth - 20);
  let left = rect.left;
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  _popover.style.left = Math.max(10, left) + 'px';
  _popover.style.top = rect.bottom + 4 + 'px';
  _popover.style.maxWidth = pw + 'px';
  setTimeout(() => {
    document.addEventListener('mousedown', _dismissPopover);
  }, 0);
}

function closeErrorPopover() {
  _popoverOpen = false;
  _popover.style.display = 'none';
  document.removeEventListener('mousedown', _dismissPopover);
}

function _dismissPopover(e) {
  if (!_popover.contains(e.target)) closeErrorPopover();
}

function setStatus(msg, errorText = null) {
  const el = document.getElementById('editor-status');
  closeErrorPopover();
  if (errorText) {
    _popover.textContent = errorText;
    const btn = document.createElement('button');
    btn.id = 'btn-render-error';
    btn.textContent = msg;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_popoverOpen) {
        closeErrorPopover();
        return;
      }
      openErrorPopover(btn);
    });
    el.innerHTML = '';
    el.appendChild(btn);
  } else {
    el.textContent = msg;
  }
}

// ── Files ─────────────────────────────────────────────────────────────────────
// One EditorState per file (own undo history); the view shows the current one.
// `baseHash` is C17's: the version this editor last loaded or saved.

/** @type {Map<string, { state: EditorState | null, baseHash: string | null, info: any }>} */
const files = new Map(
  [MAIN_FILE, ...LAYOUT_FILES].map((f) => [f, { state: null, baseHash: null, info: null }]),
);
let current = MAIN_FILE;

const tabsEl = document.getElementById('file-tabs');
const bannerEl = document.getElementById('file-banner');

/** Text as CodeMirror should hold it: without a BOM (review 8a n8), so offsets match Typst's. */
const stripBom = (text) => (text.startsWith('\uFEFF') ? text.slice(1) : text);

function renderTabs() {
  for (const btn of tabsEl.querySelectorAll('.file-tab')) {
    const file = btn.dataset.file;
    btn.classList.toggle('active', file === current);
    btn.setAttribute('aria-selected', String(file === current));
    const state = files.get(file)?.info?.state;
    btn.classList.toggle('needs-attention', state === 'outdated' || state === 'missing');
  }
}

const BANNER_TEXT =
  'Dit bestand bepaalt de opmaak van de opdracht. Wijzig het alleen als je weet wat je doet: ' +
  'een fout hier kan de opdracht onbruikbaar maken.';

function renderBanner() {
  const info = files.get(current)?.info;
  if (!LAYOUT_FILES.includes(current)) {
    bannerEl.style.display = 'none';
    return;
  }
  bannerEl.style.display = '';
  bannerEl.replaceChildren();
  const text = document.createElement('span');
  let message = BANNER_TEXT;
  if (info?.state === 'outdated') message = `Er is een nieuwere versie van ${current}. ${message}`;
  if (info?.state === 'missing')
    message = `${current} ontbreekt: de opdracht werkt pas weer na herstel.`;
  text.textContent = message;
  bannerEl.appendChild(text);
  // Always offered for an existing file: the state is from the last status check,
  // edits made since then count too (the diff uses the editor text; M-OPD-9).
  if (info?.state !== 'missing') {
    const diff = document.createElement('button');
    diff.id = 'btn-file-diff';
    diff.textContent = 'Bekijk verschillen';
    diff.addEventListener('click', () => showDiff(current));
    bannerEl.appendChild(diff);
  }
  const restore = document.createElement('button');
  restore.id = 'btn-file-restore';
  restore.textContent = 'Herstel standaardversie';
  restore.addEventListener('click', () => restoreFile(current));
  bannerEl.appendChild(restore);
}

async function loadFile(file) {
  const entry = files.get(file);
  if (entry.state) return entry.state;
  const read = await postToParent('maatwerk-read-text-versioned', { path: filePath(file) });
  // No file yet: the first save must not overwrite one a colleague made meanwhile ('').
  entry.baseHash = read?.hash ?? '';
  entry.state = createState(stripBom(read?.text ?? ''));
  return entry.state;
}

/** Shows `file` in the editor; a pending save of the current file is written first. */
async function switchTo(file) {
  if (file === current || !view) return;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNow();
  }
  files.get(current).state = view.state;
  let state;
  try {
    state = await loadFile(file);
  } catch (err) {
    setStatus('Fout bij laden', err.message);
    return;
  }
  current = file;
  view.setState(state);
  renderTabs();
  renderBanner();
  applyDiagnostics();
}

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.file-tab');
  if (btn) switchTo(btn.dataset.file);
});

/** Go to a range in a project file (definitions, preview clicks). */
async function reveal(file, from, to = from) {
  if (!files.has(file)) {
    setStatus(`Staat in ${file}`);
    return;
  }
  await switchTo(file);
  const len = view.state.doc.length;
  view.dispatch({
    selection: { anchor: Math.min(from, len), head: Math.min(to, len) },
    scrollIntoView: true,
  });
  view.focus();
}

// "Herstel standaardversie": the bundled version goes to disk (CAS on the hash
// this editor has); the editor text is replaced as one undoable change.
async function restoreFile(file) {
  const entry = files.get(file);
  const ok = await askConfirm(
    `De standaardversie van ${file} vervangt jouw versie. Met Ongedaan maken (Ctrl+Z) krijg ` +
      'je je eigen versie terug. Doorgaan?',
    { okLabel: 'Herstellen', danger: true },
  );
  if (!ok) return;
  try {
    const flushed = await flushSave();
    if (!flushed) return;
    const expected = entry.info?.state === 'missing' ? null : entry.baseHash || null;
    const hash = await callEditor('restoreProjectFile', opdrachtId, file, expected);
    const text = await callEditor('bundledProjectFile', file);
    entry.baseHash = hash;
    replaceDoc(text);
    if (session !== null) callEditor('editorUnset', session, file).catch(() => {});
    const status = await callEditor('projectFilesStatus', opdrachtId);
    applyFileStatus(status);
    setStatus(`Standaardversie van ${file} hersteld`);
  } catch (err) {
    setStatus('Herstellen mislukt', err.message);
  }
}

const diffModal = document.getElementById('diff-modal');
document.getElementById('btn-diff-close').addEventListener('click', () => {
  diffModal.style.display = 'none';
});

async function showDiff(file) {
  try {
    const bundled = await callEditor('bundledProjectFile', file);
    const copy =
      file === current ? view.state.doc.toString() : files.get(file).state.doc.toString();
    document.getElementById('diff-title').textContent =
      `Verschillen: jouw ${file} (−) en de standaardversie (+)`;
    renderDiff(document.getElementById('diff-body'), copy, bundled);
    diffModal.style.display = '';
  } catch (err) {
    setStatus('Fout bij vergelijken', err.message);
  }
}

function applyFileStatus(status) {
  for (const info of status ?? []) {
    const entry = files.get(info.file);
    if (entry) entry.info = info;
  }
  renderTabs();
  renderBanner();
}

// ── SVG preview ───────────────────────────────────────────────────────────────

const svgViewer = document.getElementById('svg-viewer');
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const PT_TO_PX = 96 / 72;
let zoomMode = 'fit'; // 'fit' (page width) or 'fixed'
let zoomScale = 1;

function pageWidthPx(pageEl) {
  const vb = pageEl.querySelector('svg')?.viewBox?.baseVal;
  return (vb?.width || 595.28) * PT_TO_PX;
}

function applyZoom() {
  const pages = [...svgViewer.querySelectorAll('.svg-page')];
  if (pages.length === 0) return;
  if (zoomMode === 'fit') {
    zoomScale = Math.max(0.1, (svgViewer.clientWidth - 32) / pageWidthPx(pages[0]));
  }
  for (const page of pages) page.style.width = `${pageWidthPx(page) * zoomScale}px`;
  document.getElementById('pv-zoom-label').textContent = `${Math.round(zoomScale * 100)}%`;
}

function zoomStep(dir) {
  zoomScale =
    dir > 0
      ? (ZOOM_STEPS.find((s) => s > zoomScale + 0.01) ?? ZOOM_STEPS.at(-1))
      : ([...ZOOM_STEPS].reverse().find((s) => s < zoomScale - 0.01) ?? ZOOM_STEPS[0]);
  zoomMode = 'fixed';
  applyZoom();
}

document.getElementById('pv-zoom-in').addEventListener('click', () => zoomStep(1));
document.getElementById('pv-zoom-out').addEventListener('click', () => zoomStep(-1));
document.getElementById('pv-fit-width').addEventListener('click', () => {
  zoomMode = 'fit';
  applyZoom();
});
new ResizeObserver(() => {
  if (zoomMode === 'fit') applyZoom();
}).observe(svgViewer);

// Ctrl+scroll: accumulate deltaY so a trackpad gesture counts as one step.
let wheelAccum = 0;
svgViewer.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    wheelAccum += e.deltaY;
    if (Math.abs(wheelAccum) > 50) {
      zoomStep(wheelAccum < 0 ? 1 : -1);
      wheelAccum = 0;
    }
  },
  { passive: false },
);

// ── Live preview (Step 8b) ────────────────────────────────────────────────────
// One compile session in Rust: every edit goes to it at once (it debounces and
// compiles the latest), results come back as `editor:update` with only the
// changed pages. Diagnostics go to CodeMirror's lint, the vragen to the panel.

let session = null;
let lastSent = 0; // the newest generation handed to the session
let editSeq = 0; // edits sent, also those whose generation is not known yet
let previewGeneration = null;
let lastUpdate = null;

/** A live editor bridge method through the parent (allowlist in modals/editor.js). */
function callEditor(method, ...args) {
  return postToParent('maatwerk-editor', { method, args });
}

function sendText(file, text) {
  if (session === null) return;
  editSeq += 1;
  callEditor('editorUpdate', session, file, text)
    .then((g) => (lastSent = Math.max(lastSent, g)))
    .catch((err) => setStatus('Fout bij renderen', err.message));
}

const liveHost = {
  session: () => session,
  file: () => current,
  call: (method, ...args) => callEditor(method, ...args),
  reveal: (file, from, to) => reveal(file, from, to),
};

function applyDiagnostics() {
  if (!view || !lastUpdate) return;
  showDiagnostics(view, lastUpdate.diagnostics, current);
}

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg?.type !== 'maatwerk-editor-update' || msg.update?.session !== session) return;
  applyUpdate(msg.update);
});

function applyUpdate(u) {
  if (u.pages.length || u.pageCount !== svgViewer.querySelectorAll('.svg-page').length) {
    patchPages(svgViewer, u);
    if (u.pageCount > 0) {
      document.getElementById('pdf-placeholder').style.display = 'none';
      svgViewer.style.display = '';
    }
    applyZoom();
  }
  // No good compile yet (the opdracht had an error when it was opened).
  if (u.previewGeneration === null) {
    document.getElementById('pdf-placeholder').textContent = u.ok
      ? 'Bezig met renderen…'
      : 'Nog geen voorbeeld: de opdracht bevat een fout (zie "Fout bij renderen" bovenaan).';
  }
  previewGeneration = u.previewGeneration;
  // Positions refer to the text of this generation: newer edits are on their way.
  if (u.generation >= lastSent) showCompileResult(u);
  if (u.vragen) showVragen(u.vragen);
  if (u.ok && view?.hasFocus) syncPreviewToCursor();
}

// Compiles run without delay, so half-typed code (`#vraag(`) fails for a
// moment: new errors are shown only after ERROR_DELAY_MS without typing, while
// a good result clears them at once (user, 2026-11-01).
const ERROR_DELAY_MS = 500;
let errorTimer = null;
let lastEditAt = 0;

function showCompileResult(u) {
  clearTimeout(errorTimer);
  errorTimer = null;
  const show = () => {
    lastUpdate = u;
    applyDiagnostics();
    if (u.diagnostics.some((d) => d.severity === 'error')) {
      setStatus('Fout bij renderen', diagnosticsText(u.diagnostics));
    } else if (document.getElementById('btn-render-error')) {
      setStatus('');
    }
  };
  if (u.ok) {
    show();
    return;
  }
  errorTimer = setTimeout(show, Math.max(0, lastEditAt + ERROR_DELAY_MS - performance.now()));
}

// Cursor -> preview: the preview follows the cursor (replaces the old
// `<__maatwerk_cursor>` marker, ADR-0002 section 12).
let cursorTimer = null;

/**
 * A jump answer fits the text on screen only when no edit went out since the
 * question and the preview is of the newest text (review 8b m2).
 */
function jumpFits(j, seq) {
  return !!j && seq === editSeq && j.generation === previewGeneration && j.generation >= lastSent;
}

async function syncPreviewToCursor() {
  if (session === null || !view) return;
  const seq = editSeq;
  const j = await callEditor(
    'editorJumpFromCursor',
    session,
    current,
    view.state.selection.main.head,
  ).catch(() => null);
  if (jumpFits(j, seq) && j.points.length) showPoint(svgViewer, j.points[0]);
}

function scheduleCursorSync() {
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(syncPreviewToCursor, 250);
}

// Preview -> source: a click in the preview puts the cursor on what was clicked.
svgViewer.addEventListener('click', async (e) => {
  if (e.target.closest('a')) e.preventDefault(); // links must not navigate the frame
  const point = clickPoint(e);
  if (!point || session === null) return;
  const seq = editSeq;
  const j = await callEditor('editorJumpFromClick', session, point.page, point.x, point.y).catch(
    () => null,
  );
  if (!jumpFits(j, seq)) return;
  if (j.file !== null) reveal(j.file, j.offset);
  else if (j.point) showPoint(svgViewer, j.point, true);
});

// ── Vragen panel ──────────────────────────────────────────────────────────────

const vragenBtn = document.getElementById('pv-vragen');
const vragenPanel = document.getElementById('vragen-panel');

function showVragen(v) {
  vragenBtn.textContent = vragenSummary(v);
  vragenBtn.classList.toggle('has-checks', v.checks.length > 0);
  vragenBtn.style.display = '';
  renderVragen(vragenPanel, v, (item) =>
    showPoint(svgViewer, { page: item.page, x: 0, y: item.y }, true),
  );
}

vragenBtn.addEventListener('click', () => {
  const open = vragenPanel.style.display === 'none';
  vragenPanel.style.display = open ? '' : 'none';
  vragenBtn.setAttribute('aria-expanded', String(open));
});

// ── Save ──────────────────────────────────────────────────────────────────────

let saving = Promise.resolve(true); // the last write, so a close can wait for it
let lastSaveFailed = false;
let inConflict = false;
let conflictFile = null; // the file whose save hit the conflict
let replacingDoc = false; // "Hun versie laden" sets the text without saving it

const conflictBar = document.getElementById('conflict-bar');

function showConflict(on, file = null) {
  inConflict = on;
  conflictFile = on ? file : null;
  conflictBar.style.display = on ? '' : 'none';
  // A copy is a new opdracht with this text as its opdracht.typ.
  document.getElementById('btn-conflict-copy').style.display =
    on && file !== MAIN_FILE ? 'none' : '';
}

/** Writes the text of `file` (default: the one shown); resolves to true when saved. */
function saveNow(file = current) {
  const entry = files.get(file);
  const content = (file === current ? view.state : entry.state).doc.toString();
  saving = saving.then(async () => {
    if (inConflict) {
      setStatus('Niet opgeslagen: kies hierboven wat er moet gebeuren');
      return false;
    }
    try {
      const writeResult = await postToParent('maatwerk-write-text', {
        path: filePath(file),
        content,
        expectedHash: entry.baseHash,
      });
      if (writeResult?.reason === 'conflict') {
        showConflict(true, file);
        setStatus('Niet opgeslagen');
        lastSaveFailed = true;
        return false;
      }
      if (!writeResult?.ok) throw new Error('niet opgeslagen');
      entry.baseHash = writeResult.hash;
      // A compile error stays in view: saving does not fix it.
      if (!document.getElementById('btn-render-error')) setStatus('Opgeslagen');
      lastSaveFailed = false;
      return true;
    } catch (err) {
      setStatus('Fout bij opslaan', err.message);
      lastSaveFailed = true;
      return false;
    }
  });
  return saving;
}

/** Replaces the editor text without saving it (one undoable change). */
function replaceDoc(text) {
  replacingDoc = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: stripBom(text) } });
  replacingDoc = false;
}

/** Replaces the editor text with the version on disk (the colleague's). */
async function loadTheirs() {
  const file = conflictFile ?? current;
  await switchTo(file);
  const read = await postToParent('maatwerk-read-text-versioned', { path: filePath(file) });
  replaceDoc(read?.text ?? '');
  files.get(file).baseHash = read?.hash ?? '';
  lastSaveFailed = false;
  showConflict(false);
  setStatus('Versie van je collega geladen');
}

document.getElementById('btn-conflict-theirs').addEventListener('click', () => {
  loadTheirs().catch((err) => setStatus('Fout bij laden', err.message));
});

// "Mijn versie bewaren als kopie": a copy of the opdracht with this text; the
// editor then shows the colleague's version of the original.
document.getElementById('btn-conflict-copy').addEventListener('click', async () => {
  try {
    const copy = await postToParent('maatwerk-save-copy', { content: view.state.doc.toString() });
    await loadTheirs();
    setStatus(`Jouw versie staat in "${copy?.naam ?? 'de kopie'}"`);
  } catch (err) {
    setStatus('Fout bij kopiëren', err.message);
  }
});

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (view && dataDir !== null && opdrachtId) saveNow();
  }, 600);
}

/**
 * U9: saves a pending autosave right away and waits for writes in flight, so
 * closing the editor within the 600 ms autosave delay loses nothing. Resolves
 * to false when the last write failed (the editor then stays open).
 */
async function flushSave() {
  const pending = saveTimer !== null;
  clearTimeout(saveTimer);
  saveTimer = null;
  // A failed save is retried too, so a close after a passing hiccup saves.
  if ((pending || (await saving) === false || lastSaveFailed) && view && dataDir && opdrachtId) {
    return saveNow();
  }
  return saving;
}

// If saving still fails, the teacher may close anyway after confirming (review 3a M2:
// otherwise there was no way out of the editor).
async function closeAfterSave(type) {
  const saved = await flushSave();
  if (
    !saved &&
    !(await askConfirm(
      'De laatste wijzigingen zijn niet opgeslagen. Toch sluiten? Dan gaan ze verloren.',
      { okLabel: 'Toch sluiten', danger: true },
    ))
  ) {
    return;
  }
  window.parent.postMessage({ type }, '*');
}

const changeListener = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    lastEditAt = performance.now();
    // An error shown later would be of older text; the next result decides.
    clearTimeout(errorTimer);
    sendText(current, update.state.doc.toString());
    if (replacingDoc) return;
    setStatus('Niet opgeslagen…');
    scheduleSave();
  } else if (update.selectionSet) {
    scheduleCursorSync();
  }
});

/**
 * The shadow root CodeMirror is mounted in. In a shadow root CodeMirror styles
 * itself with constructable stylesheets; in the document it would add a
 * <style> element, which the strict CSP blocks. editor-cm.css holds our theme.
 */
function editorRoot() {
  const shadow = document.getElementById('cm-container').attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(editorCmCss);
  shadow.adoptedStyleSheets = [sheet];
  return shadow;
}

function createState(doc) {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(typstHighlightStyle),
      typstLanguage,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      liveExtensions(liveHost),
      changeListener,
      imagePasteHandler,
      EditorView.lineWrapping,
      wrapIndent,
    ],
  });
}

async function init() {
  let dir;
  try {
    [, dir] = await Promise.all([loadFile(MAIN_FILE), postToParent('maatwerk-get-data-dir')]);
  } catch (err) {
    // No editor view is created, so nothing can overwrite the file.
    setStatus('Fout bij laden', err.message);
    return;
  }
  dataDir = dir ?? '';
  view = new EditorView({ state: files.get(MAIN_FILE).state, parent: editorRoot() });
  renderTabs();
  renderBanner();

  try {
    const opened = await callEditor('editorOpen', opdrachtId, naam);
    session = opened.session;
    applyFileStatus(opened.files);
    // The session compiles the files on disk first; the editor's text (BOM
    // stripped) is the same, so this changes nothing unless it differs.
    sendText(MAIN_FILE, view.state.doc.toString());
  } catch (err) {
    setStatus('Fout bij renderen', err.message);
  }
}

init();

// ── Toolbar ───────────────────────────────────────────────────────────────────

// Symbol data: { char, name, typst }
const SYMBOLS = {
  letterlike: [
    { char: 'ℕ', name: 'natuurlijke getallen', typst: 'sym.NN' },
    { char: 'ℤ', name: 'gehele getallen', typst: 'sym.ZZ' },
    { char: 'ℚ', name: 'rationale getallen', typst: 'sym.QQ' },
    { char: 'ℝ', name: 'reële getallen', typst: 'sym.RR' },
    { char: 'ℂ', name: 'complexe getallen', typst: 'sym.CC' },
    { char: 'ℋ', name: 'hilbert ruimte', typst: 'sym.scr.H' },
    { char: 'ℓ', name: 'script l', typst: 'sym.ell' },
    { char: 'ℏ', name: 'h-balk', typst: 'sym.planck.reduce' },
    { char: 'ℐ', name: 'script I', typst: 'sym.scr.I' },
    { char: 'ℑ', name: 'imaginair deel', typst: 'sym.Im' },
    { char: 'ℜ', name: 'reëel deel', typst: 'sym.Re' },
    { char: 'ℬ', name: 'script B', typst: 'sym.scr.B' },
    { char: 'ℰ', name: 'script E', typst: 'sym.scr.E' },
    { char: 'ℱ', name: 'script F', typst: 'sym.scr.F' },
    { char: 'ℳ', name: 'script M', typst: 'sym.scr.M' },
    { char: '℘', name: 'weierstrass p', typst: 'sym.wp' },
  ],
  math: [
    { char: '∈', name: 'element van', typst: 'sym.in' },
    { char: '∉', name: 'geen element van', typst: 'sym.in.not' },
    { char: '⊂', name: 'deelverzameling', typst: 'sym.subset' },
    { char: '⊃', name: 'superverzameling', typst: 'sym.supset' },
    { char: '⊆', name: 'deelverzameling of gelijk', typst: 'sym.subset.eq' },
    { char: '⊇', name: 'superverzameling of gelijk', typst: 'sym.supset.eq' },
    { char: '∩', name: 'doorsnede', typst: 'sym.sect' },
    { char: '∪', name: 'vereniging', typst: 'sym.union' },
    { char: '±', name: 'plus of min', typst: 'sym.plus.minus' },
    { char: '∓', name: 'min of plus', typst: 'sym.minus.plus' },
    { char: '×', name: 'vermenigvuldigen', typst: 'sym.times' },
    { char: '÷', name: 'delen', typst: 'sym.div' },
    { char: '≤', name: 'kleiner of gelijk', typst: 'sym.lt.eq' },
    { char: '≥', name: 'groter of gelijk', typst: 'sym.gt.eq' },
    { char: '≠', name: 'ongelijk', typst: 'sym.eq.not' },
    { char: '≈', name: 'ongeveer gelijk', typst: 'sym.approx' },
    { char: '≡', name: 'identiek', typst: 'sym.equiv' },
    { char: '∝', name: 'evenredig met', typst: 'sym.prop' },
    { char: '∞', name: 'oneindig', typst: 'sym.infinity' },
    { char: '∑', name: 'som', typst: 'sym.sum' },
    { char: '∏', name: 'product', typst: 'sym.product' },
    { char: '∫', name: 'integraal', typst: 'sym.integral' },
    { char: '∂', name: 'partiële afgeleide', typst: 'sym.partial' },
    { char: '∇', name: 'nabla', typst: 'sym.nabla' },
    { char: '√', name: 'vierkantswortel', typst: 'sym.sqrt' },
    { char: '∀', name: 'voor alle', typst: 'sym.forall' },
    { char: '∃', name: 'er bestaat', typst: 'sym.exists' },
    { char: '¬', name: 'niet', typst: 'sym.not' },
    { char: '∧', name: 'en', typst: 'sym.and' },
    { char: '∨', name: 'of', typst: 'sym.or' },
    { char: '⊕', name: 'exclusief of', typst: 'sym.xor' },
    { char: '∅', name: 'lege verzameling', typst: 'sym.emptyset' },
  ],
  misc: [
    { char: '→', name: 'pijl rechts', typst: 'sym.arrow.r' },
    { char: '←', name: 'pijl links', typst: 'sym.arrow.l' },
    { char: '↑', name: 'pijl omhoog', typst: 'sym.arrow.t' },
    { char: '↓', name: 'pijl omlaag', typst: 'sym.arrow.b' },
    { char: '↔', name: 'dubbele pijl', typst: 'sym.arrow.l.r' },
    { char: '⇒', name: 'impliceert', typst: 'sym.arrow.r.double' },
    { char: '⇐', name: 'volgt uit', typst: 'sym.arrow.l.double' },
    { char: '⇔', name: 'dan en slechts dan', typst: 'sym.arrow.l.r.double' },
    { char: '↦', name: 'afbeelding pijl', typst: 'sym.arrow.r.bar' },
    { char: '★', name: 'ster', typst: 'sym.star.filled' },
    { char: '☆', name: 'ster (leeg)', typst: 'sym.star' },
    { char: '●', name: 'cirkel', typst: 'sym.circle.filled' },
    { char: '○', name: 'cirkel (leeg)', typst: 'sym.circle' },
    { char: '■', name: 'vierkant', typst: 'sym.square.filled' },
    { char: '□', name: 'vierkant (leeg)', typst: 'sym.square' },
    { char: '▲', name: 'driehoek', typst: 'sym.triangle.filled' },
    { char: '△', name: 'driehoek (leeg)', typst: 'sym.triangle' },
    { char: '♦', name: 'ruit', typst: 'sym.diamond.filled' },
    { char: '◇', name: 'ruit (leeg)', typst: 'sym.diamond' },
    { char: '†', name: 'kruis', typst: 'sym.dagger' },
    { char: '‡', name: 'dubbel kruis', typst: 'sym.dagger.double' },
    { char: '§', name: 'paragraaf', typst: 'sym.section' },
    { char: '¶', name: 'alinea', typst: 'sym.pilcrow' },
    { char: '©', name: 'copyright', typst: 'sym.copyright' },
    { char: '®', name: 'geregistreerd', typst: 'sym.trademark.registered' },
    { char: '™', name: 'handelsmerk', typst: 'sym.trademark' },
    { char: '°', name: 'graden', typst: 'sym.degree' },
    { char: '′', name: 'priemteken', typst: 'sym.prime' },
    { char: '″', name: 'dubbel priemteken', typst: 'sym.prime.double' },
    { char: '…', name: 'ellips', typst: 'sym.dots.h' },
    { char: '—', name: 'gedachtestreep', typst: 'sym.dash.em' },
    { char: '–', name: 'koppelteken', typst: 'sym.dash.en' },
  ],
  emoji: [
    { char: '😀', name: 'blij', typst: 'emoji.face.smile' },
    { char: '😊', name: 'glimlach', typst: 'emoji.face.smile.slight' },
    { char: '😄', name: 'lachen', typst: 'emoji.face.grin' },
    { char: '😂', name: 'tranen van het lachen', typst: 'emoji.face.joy' },
    { char: '🙂', name: 'enigszins blij', typst: 'emoji.face.smile.slight' },
    { char: '😎', name: 'coole zonnebril', typst: 'emoji.face.sunglasses' },
    { char: '🤔', name: 'nadenkend', typst: 'emoji.face.thinking' },
    { char: '😮', name: 'verrast', typst: 'emoji.face.surprise' },
    { char: '😢', name: 'bedroefd', typst: 'emoji.face.cry' },
    { char: '😡', name: 'boos', typst: 'emoji.face.angry' },
    { char: '👍', name: 'duim omhoog', typst: 'emoji.hand.thumbsup' },
    { char: '👎', name: 'duim omlaag', typst: 'emoji.hand.thumbsdown' },
    { char: '👋', name: 'zwaai', typst: 'emoji.hand.wave' },
    { char: '🙌', name: 'handen omhoog', typst: 'emoji.hand.raised.both' },
    { char: '✅', name: 'vinkje', typst: 'emoji.mark.check' },
    { char: '❌', name: 'kruis', typst: 'emoji.mark.cross' },
    { char: '⚠️', name: 'waarschuwing', typst: 'emoji.mark.warning' },
    { char: '💡', name: 'lamp', typst: 'emoji.object.bulb' },
    { char: '📌', name: 'punaise', typst: 'emoji.object.pin' },
    { char: '📝', name: 'notitie', typst: 'emoji.object.pencil' },
    { char: '📊', name: 'grafiek', typst: 'emoji.object.chart' },
    { char: '🔍', name: 'vergrootglas', typst: 'emoji.object.search' },
    { char: '🔑', name: 'sleutel', typst: 'emoji.object.key' },
    { char: '🎯', name: 'doel', typst: 'emoji.object.target' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function insertAtCursor(editorView, text) {
  const { from, to } = editorView.state.selection.main;
  editorView.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  editorView.focus();
}

function wrapSelection(editorView, before, after) {
  const { from, to } = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(from, to);
  if (selected) {
    editorView.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length + selected.length + after.length },
    });
  } else {
    const insert = before + after;
    editorView.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + before.length },
    });
  }
  editorView.focus();
}

function isCursorInMath(editorView) {
  const doc = editorView.state.doc.toString();
  const pos = editorView.state.selection.main.head;
  let inMath = false;
  let i = 0;
  while (i < pos) {
    if (doc[i] === '$') inMath = !inMath;
    i++;
  }
  return inMath;
}

function insertMath(editorView, snippet) {
  if (isCursorInMath(editorView)) {
    insertAtCursor(editorView, snippet);
  } else {
    // Wrap snippet in $…$ and place cursor after closing $
    const { from, to } = editorView.state.selection.main;
    const insert = `$${snippet}$`;
    editorView.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
    editorView.focus();
  }
}

function wrapWithFunction(editorView, fn) {
  const { from, to } = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(from, to);
  const inner = selected || '…';
  const insert = `#${fn}[${inner}]`;
  editorView.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
  editorView.focus();
}

// Labels in the document (<naam>; Typst allows letters, digits, _ - : and . in
// them, e.g. <eq:energie>), without the internal <__maatwerk_…> markers.
function extractLabels(editorView) {
  const doc = editorView.state.doc.toString();
  const matches = [...doc.matchAll(/<([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)>/gu)];
  return [...new Set(matches.map((m) => m[1]))].filter((l) => !l.startsWith('__'));
}

// ── Popup management ──────────────────────────────────────────────────────────

let _activePopup = null;
let _dismissHandler = null;

function closeActivePopup() {
  if (_activePopup) {
    _activePopup.style.display = 'none';
    _activePopup = null;
  }
  if (_dismissHandler) {
    document.removeEventListener('mousedown', _dismissHandler);
    _dismissHandler = null;
  }
}

function openPopup(triggerEl, popupEl) {
  if (_activePopup === popupEl) {
    closeActivePopup();
    return;
  }
  closeActivePopup();

  // Position popup below the trigger button
  const toolbarEl = document.getElementById('editor-toolbar');
  const triggerRect = triggerEl.getBoundingClientRect();
  const toolbarRect = toolbarEl.getBoundingClientRect();

  popupEl.style.display = '';
  popupEl.style.left = triggerRect.left - toolbarRect.left + 'px';
  popupEl.style.top = triggerRect.bottom - toolbarRect.top + 'px';

  // Prevent popup from going off right edge
  const popupWidth = popupEl.offsetWidth;
  const toolbarWidth = toolbarEl.offsetWidth;
  const leftPos = triggerRect.left - toolbarRect.left;
  if (leftPos + popupWidth > toolbarWidth - 4) {
    popupEl.style.left = Math.max(0, toolbarWidth - popupWidth - 4) + 'px';
  }

  _activePopup = popupEl;
  setTimeout(() => {
    _dismissHandler = (e) => {
      if (!popupEl.contains(e.target) && e.target !== triggerEl) {
        closeActivePopup();
      }
    };
    document.addEventListener('mousedown', _dismissHandler);
  }, 0);
}

// ── Symbol panel builder ──────────────────────────────────────────────────────

function buildSymbolPanel(popupEl, symbols) {
  if (popupEl.dataset.built) return;
  popupEl.dataset.built = '1';

  popupEl.innerHTML = '';
  popupEl.classList.add('tb-symbol-panel');

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Zoeken…';
  search.className = 'tb-symbol-search';
  popupEl.appendChild(search);

  const grid = document.createElement('div');
  grid.className = 'tb-symbol-grid';
  popupEl.appendChild(grid);

  const hint = document.createElement('div');
  hint.className = 'tb-symbol-hint';
  popupEl.appendChild(hint);

  function render(list) {
    grid.innerHTML = '';
    list.forEach((sym) => {
      const btn = document.createElement('button');
      btn.className = 'tb-symbol-btn';
      btn.textContent = sym.char;
      btn.addEventListener('mouseenter', () => {
        hint.textContent = `${sym.name} — ${sym.typst}`;
      });
      btn.addEventListener('mouseleave', () => {
        hint.textContent = '';
      });
      btn.addEventListener('click', () => {
        if (view) {
          const inMath = isCursorInMath(view);
          const insert = inMath ? sym.typst.replace(/^sym\./, '') : `#${sym.typst}`;
          insertAtCursor(view, insert);
        }
        closeActivePopup();
      });
      grid.appendChild(btn);
    });
  }

  render(symbols);

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    if (!q) {
      render(symbols);
      return;
    }
    render(symbols.filter((s) => s.name.includes(q) || s.typst.includes(q)));
  });
}

// ── Reference panel builder ───────────────────────────────────────────────────

function buildReferencePanel(popupEl) {
  if (!view) return;
  const labels = extractLabels(view);
  const listEl = popupEl.querySelector('#ref-list');
  listEl.innerHTML = '';

  if (labels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tb-ref-empty';
    empty.textContent = 'Geen verwijzingen gevonden in dit document.';
    listEl.appendChild(empty);
    return;
  }

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Zoeken…';
  search.className = 'tb-symbol-search';
  search.style.marginBottom = '4px';
  popupEl.querySelector('.tb-ref-panel').insertBefore(search, listEl);

  function render(list) {
    listEl.innerHTML = '';
    list.forEach((label) => {
      const btn = document.createElement('button');
      btn.className = 'tb-ref-item';
      btn.textContent = `@${label}`;
      btn.addEventListener('click', () => {
        if (view) insertAtCursor(view, `@${label}`);
        closeActivePopup();
      });
      listEl.appendChild(btn);
    });
  }

  render(labels);
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    render(q ? labels.filter((l) => l.toLowerCase().includes(q)) : labels);
  });
}

// ── Insert helpers ────────────────────────────────────────────────────────────

function cellLabel(i) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (i < 26) return alpha[i];
  return alpha[Math.floor(i / 26) - 1] + alpha[i % 26];
}

function genTable(cols, rows) {
  const rowLines = [];
  for (let r = 0; r < rows; r++) {
    const cells = Array.from({ length: cols }, (_, c) => `[${cellLabel(r * cols + c)}]`).join(', ');
    rowLines.push('  ' + cells + ',');
  }
  return [
    'table(',
    `  columns: (1fr,) * ${cols},`,
    '  align: center,',
    '  fill: (x, y) => if calc.odd(y) { luma(240) } else { white },',
    ...rowLines,
    ')',
  ].join('\n');
}

const GRID_PRESETS = [
  { label: '50 – 50', cols: [1, 1] },
  { label: '33 – 33 – 33', cols: [1, 1, 1] },
  { label: '33 – 67', cols: [1, 2] },
  { label: '67 – 33', cols: [2, 1] },
  { label: '25 – 25 – 25 – 25', cols: [1, 1, 1, 1] },
  { label: '50 – 25 – 25', cols: [2, 1, 1] },
  { label: '25 – 50 – 25', cols: [1, 2, 1] },
  { label: '25 – 25 – 50', cols: [1, 1, 2] },
  { label: '75 – 25', cols: [3, 1] },
  { label: '25 – 75', cols: [1, 3] },
];

const LOREM = '#lorem(20)';

function genGrid(cols) {
  const colDef = cols.map((c) => `${c}fr`).join(', ');
  const cells = cols.map(() => `  [${LOREM}]`).join(',\n');
  return `#grid(\n  columns: (${colDef}),\n  gutter: 1em,\n${cells},\n)`;
}

function withIndent(v, snippet) {
  const line = v.state.doc.lineAt(v.state.selection.main.from);
  const indent = line.text.match(/^(\s*)/)[1];
  if (!indent) return snippet;
  return snippet
    .split('\n')
    .map((l, i) => (i === 0 ? l : indent + l))
    .join('\n');
}

const CONTENT_BLOCKS = {
  formule: [
    '#formule_blok(name: "Formule van Einstein")[',
    '  Volgens Einstein zijn massa en energie uitwisselbaar:',
    '  #align(center)[$E = m dot c^2$]',
    '  Energie $E$ in J;\\',
    '  Massa $m$ in kg;\\',
    '  Lichtsnelheid $c$ in m/s.',
    ']',
  ].join('\n'),
  voorbeeld: '#voorbeeld_blok(name: "Lorem ipsum")[\n  #lorem(20)\n]',
  context: '#context_blok(name: "Lorem ipsum")[\n  #lorem(20)\n]',
  belangrijk: '#belangrijk_blok[\n  #lorem(20)\n]',
};

function insertContentBlock(v, kind) {
  insertAtCursor(v, withIndent(v, CONTENT_BLOCKS[kind]));
}

// ── Opgaven ───────────────────────────────────────────────────────────────────
// Exercises are free content in #opgave[…]; only the questions are marked with
// #vraag(…)[…] (see lib.typ). Both are inserted at the cursor; the placeholder
// to type over first is selected.

const OPGAVE_SNIPPET = [
  '#opgave(titel: "Titel van de opgave")[',
  '  Inleidende tekst van de opgave.',
  '',
  '  #vraag(punten: 1, antwoord: [Het antwoord.])[De vraag.]',
  ']',
].join('\n');

const VRAAG_SNIPPET = '#vraag(punten: 1, antwoord: [Het antwoord.])[De vraag.]';

function insertSelecting(v, snippet, placeholder) {
  const text = withIndent(v, snippet);
  const { from, to } = v.state.selection.main;
  const at = from + text.indexOf(placeholder);
  v.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: at, head: at + placeholder.length },
    scrollIntoView: true,
  });
  v.focus();
}

// ── Figures / images ──────────────────────────────────────────────────────────
// Images live in the opdracht's folder, opdrachten/<id>/images/ (C14). The figure
// popup offers the opdracht's existing images, a file from disk and the
// clipboard; Ctrl+V of an image in the editor works too. A new image is first
// given a name, then a #figure referring to it is inserted at the cursor.
// Image paths are relative to the opdracht folder: images/<name>.<ext> (C14).

const IMAGE_MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const FIGURE_CAPTION = 'Onderschrift hier';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Label for a new figure: the image name, made unique within the document.
function figureLabel(name) {
  let base = name.replace(/[^A-Za-z0-9_-]/g, '-');
  if (!/^[A-Za-z]/.test(base)) base = 'fig-' + base;
  const used = new Set(extractLabels(view));
  let label = base;
  for (let n = 2; used.has(label); n++) label = `${base}-${n}`;
  return label;
}

function insertFigure(file, name) {
  insertCaptioned(`image("${file}", width: 80%)`, figureLabel(name));
}

// Insert #figure(body, caption: […]) <label> at the cursor, with the
// placeholder caption selected so it can be typed over.
function insertCaptioned(body, label) {
  const snippet = withIndent(
    view,
    `#figure(\n  ${body.replace(/\n/g, '\n  ')},\n  caption: [${FIGURE_CAPTION}],\n) <${label}>`,
  );
  const { from, to } = view.state.selection.main;
  const at = from + snippet.indexOf(FIGURE_CAPTION);
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: { anchor: at, head: at + FIGURE_CAPTION.length },
    scrollIntoView: true,
  });
  view.focus();
}

const figPopup = () => document.getElementById('popup-figure');
const figPanel = () => figPopup().querySelector('.tb-fig-panel');

function showFigurePopup() {
  if (_activePopup !== figPopup()) {
    openPopup(document.querySelector('[data-action="figure"]'), figPopup());
  }
}

// First free "afbeelding-N" for a pasted image.
async function nextImageName() {
  const images = (await askParent('maatwerk-list-images', { opdrachtId }, [])) ?? [];
  const taken = new Set(images.map((i) => i.name));
  let n = 1;
  while (taken.has(`afbeelding-${n}`)) n++;
  return `afbeelding-${n}`;
}

// Step 1: existing images + ways to add a new one.
async function showFigureMenu() {
  showFigurePopup();
  const panel = figPanel();
  panel.innerHTML = '<div class="tb-fig-hint">Laden…</div>';
  const images = (await askParent('maatwerk-list-images', { opdrachtId }, [])) ?? [];
  const items = images
    .map(
      (img) => `
      <button class="tb-fig-item" data-fig="use" data-file="${esc(img.file)}" data-name="${esc(img.name)}">
        ${img.thumb ? `<img src="${esc(img.thumb)}" alt="" />` : '<span class="tb-fig-noimg">🖼️</span>'}
        <span>${esc(img.name)}</span>
      </button>`,
    )
    .join('');
  panel.innerHTML = `
    <div class="tb-fig-title">Afbeeldingen in deze opdracht</div>
    <div class="tb-fig-list">${items || '<div class="tb-fig-empty">Nog geen afbeeldingen.</div>'}</div>
    <div class="tb-fig-actions">
      <button class="tb-fig-btn" data-fig="pick">📂 Van schijf kiezen…</button>
      <button class="tb-fig-btn" data-fig="clipboard">📋 Plakken van klembord</button>
    </div>
    <div class="tb-fig-error" hidden></div>
    <div class="tb-fig-hint">Tip: Ctrl+V in de tekst plakt een afbeelding ook direct.</div>`;
}

// Step 2: name a new image. source: { kind: 'paste', base64, ext } | { kind: 'file', token }
function showNameForm(source, defaultName) {
  showFigurePopup();
  const panel = figPanel();
  panel.innerHTML = `
    <div class="tb-fig-title">Naam van de afbeelding</div>
    <input class="tb-symbol-search" id="fig-name" value="${esc(defaultName)}" spellcheck="false" />
    <div class="tb-fig-error" hidden></div>
    <div class="tb-fig-actions tb-fig-actions-end">
      <button class="tb-fig-btn" data-fig="cancel">Annuleren</button>
      <button class="tb-fig-btn" data-fig="overwrite" hidden>Overschrijven</button>
      <button class="tb-fig-btn tb-fig-primary" data-fig="save">Invoegen</button>
    </div>`;
  panel._source = source;
  const input = panel.querySelector('#fig-name');
  input.focus();
  input.select();
  input.addEventListener('input', () => {
    panel.querySelector('[data-fig="overwrite"]').hidden = true;
    panel.querySelector('.tb-fig-error').hidden = true;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveNamedImage(false);
    if (e.key === 'Escape') {
      closeActivePopup();
      view.focus();
    }
  });
}

function showFigError(message) {
  const el = figPanel().querySelector('.tb-fig-error');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

async function saveNamedImage(overwrite) {
  const panel = figPanel();
  const source = panel._source;
  const name = panel.querySelector('#fig-name').value.trim();
  const result =
    source.kind === 'paste'
      ? await askParent(
          'maatwerk-save-image',
          {
            opdrachtId,
            name,
            ext: source.ext,
            base64: source.base64,
            overwrite,
          },
          (err) => ({ ok: false, error: err.message }),
        )
      : await askParent(
          'maatwerk-import-image',
          {
            opdrachtId,
            token: source.token,
            name,
            overwrite,
          },
          (err) => ({ ok: false, error: err.message }),
        );
  if (result?.ok) {
    closeActivePopup();
    // An overwritten image may keep its size and time stamp: read it again (review 8a m3).
    if (session !== null) callEditor('editorRefresh', session).catch(() => {});
    insertFigure(result.file, result.name);
  } else if (result?.exists) {
    showFigError(
      `Er bestaat al een afbeelding "${result.name}". Kies een andere naam of overschrijf hem.`,
    );
    panel.querySelector('[data-fig="overwrite"]').hidden = false;
  } else {
    showFigError(result?.error ?? 'De afbeelding kon niet worden opgeslagen.');
  }
}

async function pasteImage(base64, ext) {
  showNameForm({ kind: 'paste', base64, ext }, await nextImageName());
}

async function pasteImageFromClipboard() {
  const base64 = await askParent('maatwerk-clipboard-image', {}, null);
  if (base64) await pasteImage(base64, 'png');
  else showFigError('Er staat geen afbeelding op het klembord.');
}

function setupFigurePopup() {
  figPanel().addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fig]');
    if (!btn) return;
    switch (btn.dataset.fig) {
      case 'use':
        closeActivePopup();
        insertFigure(btn.dataset.file, btn.dataset.name);
        break;
      case 'pick': {
        const picked = await askParent('maatwerk-pick-image', {}, null);
        if (picked) showNameForm({ kind: 'file', token: picked.token }, picked.name);
        break;
      }
      case 'clipboard':
        await pasteImageFromClipboard();
        break;
      case 'save':
        await saveNamedImage(false);
        break;
      case 'overwrite':
        await saveNamedImage(true);
        break;
      case 'cancel':
        closeActivePopup();
        view.focus();
        break;
    }
  });
}

// Ctrl+V of an image (and nothing textual) in the editor.
const imagePasteHandler = EditorView.domEventHandlers({
  paste(event) {
    const data = event.clipboardData;
    if (!data || data.getData('text/plain')) return false;
    const item = [...data.items].find((i) => i.kind === 'file' && IMAGE_MIME_EXT[i.type]);
    if (!item) return false;
    event.preventDefault();
    // The clipboard items are only valid during the event: read type and file now.
    const ext = IMAGE_MIME_EXT[item.type];
    const reader = new FileReader();
    reader.onload = () => pasteImage(String(reader.result).split(',')[1], ext);
    reader.readAsDataURL(item.getAsFile());
    return true;
  },
});

// ── Action map ────────────────────────────────────────────────────────────────

const ACTIONS = {
  // Content blocks group
  'blok-formule': (v) => insertContentBlock(v, 'formule'),
  'blok-voorbeeld': (v) => insertContentBlock(v, 'voorbeeld'),
  'blok-context': (v) => insertContentBlock(v, 'context'),
  'blok-belangrijk': (v) => insertContentBlock(v, 'belangrijk'),

  // Exercises group
  'opgave-add': (v) => insertSelecting(v, OPGAVE_SNIPPET, 'Titel van de opgave'),
  'vraag-add': (v) => insertSelecting(v, VRAAG_SNIPPET, 'De vraag.'),

  // Group 1
  bold: (v) => wrapSelection(v, '*', '*'),
  italic: (v) => wrapSelection(v, '_', '_'),
  underline: (v) => wrapWithFunction(v, 'underline'),
  overline: (v) => wrapWithFunction(v, 'overline'),
  strike: (v) => wrapWithFunction(v, 'strike'),
  highlight: (v) => wrapWithFunction(v, 'highlight'),
  lower: (v) => wrapWithFunction(v, 'lower'),
  upper: (v) => wrapWithFunction(v, 'upper'),
  smallcaps: (v) => wrapWithFunction(v, 'smallcaps'),
  sub: (v) => wrapWithFunction(v, 'sub'),
  super: (v) => wrapWithFunction(v, 'super'),
  quote: (v) => wrapWithFunction(v, 'quote'),

  // Group 2
  list: (v) => {
    const { from } = v.state.selection.main;
    const line = v.state.doc.lineAt(from);
    v.dispatch({ changes: { from: line.from, to: line.from, insert: '- ' } });
    v.focus();
  },
  enumerate: (v) => {
    const { from } = v.state.selection.main;
    const line = v.state.doc.lineAt(from);
    v.dispatch({ changes: { from: line.from, to: line.from, insert: '+ ' } });
    v.focus();
  },
  math: (v) => wrapSelection(v, '$', '$'),
  codeblock: (v) => {
    const { from, to } = v.state.selection.main;
    const insert = '```\n' + (v.state.sliceDoc(from, to) || '') + '\n```';
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + 4 } });
    v.focus();
  },

  // Group 3 – math elements
  'math-accent': (v) => insertMath(v, 'accent(x, hat)'),
  'math-binom': (v) => insertMath(v, 'binom(n, k)'),
  'math-cancel': (v) => insertMath(v, 'cancel(x)'),
  'math-cases': (v) => insertMath(v, 'cases(a "als" x > 0, b "anders")'),
  'math-numeq': (v) => {
    const insert = '$ x = y $ <eq1>';
    insertAtCursor(v, insert);
  },
  'math-frac': (v) => insertMath(v, 'frac(a, b)'),
  'math-lr': (v) => insertMath(v, 'lr([x])'),
  'math-mat': (v) => insertMath(v, 'mat(a, b; c, d)'),
  'math-primes': (v) => insertMath(v, "x'"),
  'math-root': (v) => insertMath(v, 'root(n, x)'),
  'math-sizes': (v) => insertMath(v, 'display(x)'),
  'math-op': (v) => insertMath(v, 'op("sin")'),
  'math-variants': (v) => insertMath(v, 'bb(A)'),
  'math-vec': (v) => insertMath(v, 'vec(a, b)'),
};

// ── Table picker builder ──────────────────────────────────────────────────────

function buildTablePicker(popupEl) {
  if (popupEl.dataset.built) return;
  popupEl.dataset.built = '1';

  const COLS = 10,
    ROWS = 10;
  let hoverCol = -1,
    hoverRow = -1;

  const grid = document.createElement('div');
  grid.className = 'tb-table-grid';

  const label = document.createElement('div');
  label.className = 'tb-table-label';

  function updateHighlight() {
    for (let i = 0; i < COLS * ROWS; i++) {
      const r = Math.floor(i / COLS),
        c = i % COLS;
      grid.children[i].classList.toggle('active', c <= hoverCol && r <= hoverRow);
    }
    label.textContent = hoverCol >= 0 ? `${hoverCol + 1} × ${hoverRow + 1}` : '';
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'tb-table-cell';
      cell.addEventListener('mousemove', () => {
        hoverCol = c;
        hoverRow = r;
        updateHighlight();
      });
      cell.addEventListener('click', () => {
        // Tables go in a figure, so they get a (numbered, referable) caption.
        if (view) insertCaptioned(genTable(hoverCol + 1, hoverRow + 1), figureLabel('tabel'));
        closeActivePopup();
      });
      grid.appendChild(cell);
    }
  }

  grid.addEventListener('mouseleave', () => {
    hoverCol = -1;
    hoverRow = -1;
    updateHighlight();
  });

  popupEl.appendChild(grid);
  popupEl.appendChild(label);
}

// ── Grid picker builder ───────────────────────────────────────────────────────

function buildGridPicker(popupEl) {
  if (popupEl.dataset.built) return;
  popupEl.dataset.built = '1';

  GRID_PRESETS.forEach((preset) => {
    const item = document.createElement('button');
    item.className = 'tb-grid-item';

    const visual = document.createElement('div');
    visual.className = 'tb-grid-visual';
    preset.cols.forEach((w) => {
      const col = document.createElement('div');
      col.className = 'tb-grid-col';
      col.style.flex = w;
      visual.appendChild(col);
    });

    const lbl = document.createElement('span');
    lbl.className = 'tb-grid-label';
    lbl.textContent = preset.label;

    item.appendChild(visual);
    item.appendChild(lbl);
    item.addEventListener('click', () => {
      if (view) insertAtCursor(view, withIndent(view, genGrid(preset.cols)));
      closeActivePopup();
    });

    popupEl.appendChild(item);
  });
}

// ── Setup toolbar ─────────────────────────────────────────────────────────────

function setupToolbar() {
  // Pre-build symbol panels
  buildSymbolPanel(document.getElementById('popup-sym-letterlike'), SYMBOLS.letterlike);
  buildSymbolPanel(document.getElementById('popup-sym-math'), SYMBOLS.math);
  buildSymbolPanel(document.getElementById('popup-sym-misc'), SYMBOLS.misc);
  buildSymbolPanel(document.getElementById('popup-sym-emoji'), SYMBOLS.emoji);
  buildTablePicker(document.getElementById('popup-tabel'));
  buildGridPicker(document.getElementById('popup-grid'));

  const toolbar = document.getElementById('editor-toolbar');

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();

    const action = btn.dataset.action;
    const popupId = btn.dataset.popup;

    // Figure popup is rebuilt each time (lists the opdracht's images)
    if (action === 'figure') {
      if (_activePopup === figPopup()) closeActivePopup();
      else showFigureMenu();
      return;
    }

    // Handle reference popup separately (needs live label scan)
    if (action === 'reference') {
      const popupEl = document.getElementById('popup-reference');
      // Rebuild each time so labels are fresh
      const listEl = popupEl.querySelector('#ref-list');
      listEl.innerHTML = '';
      // Remove old search input if present
      const oldSearch = popupEl.querySelector('.tb-symbol-search');
      if (oldSearch) oldSearch.remove();
      buildReferencePanel(popupEl);
      openPopup(btn, popupEl);
      return;
    }

    // Handle popup-opening buttons
    if (popupId) {
      const popupEl = document.getElementById(popupId);
      if (popupEl) openPopup(btn, popupEl);
      return;
    }

    // Handle direct actions (including buttons inside open popups)
    if (action && ACTIONS[action] && view) {
      ACTIONS[action](view);
      closeActivePopup();
    }
  });
}

setupToolbar();
setupFigurePopup();

// ── Context menu ──────────────────────────────────────────────────────────────

function setupContextMenu() {
  const menu = document.getElementById('cm-context-menu');

  document.getElementById('cm-container').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hasSel = view && !view.state.selection.main.empty;
    menu.querySelector('[data-cm-action="cut"]').disabled = !hasSel;
    menu.querySelector('[data-cm-action="copy"]').disabled = !hasSel;

    // Position — avoid going off-screen
    const mw = 190,
      mh = 130;
    const x = Math.min(e.clientX, window.innerWidth - mw - 4);
    const y = Math.min(e.clientY, window.innerHeight - mh - 4);
    menu.style.left = Math.max(0, x) + 'px';
    menu.style.top = Math.max(0, y) + 'px';
    menu.style.display = '';

    setTimeout(() => {
      document.addEventListener('mousedown', function dismiss(ev) {
        if (!menu.contains(ev.target)) {
          menu.style.display = 'none';
          document.removeEventListener('mousedown', dismiss);
        }
      });
    }, 0);
  });

  menu.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-cm-action]')?.dataset.cmAction;
    if (!action || !view) return;
    menu.style.display = 'none';

    const { from, to } = view.state.selection.main;

    if (action === 'copy') {
      await navigator.clipboard.writeText(view.state.sliceDoc(from, to)).catch(() => {});
    } else if (action === 'cut') {
      await navigator.clipboard.writeText(view.state.sliceDoc(from, to)).catch(() => {});
      view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } });
      view.focus();
    } else if (action === 'paste') {
      const text = await navigator.clipboard.readText().catch(() => '');
      if (text) {
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      } else {
        const image = await askParent('maatwerk-clipboard-image', {}, null);
        if (image) await pasteImage(image, 'png');
      }
    } else if (action === 'comment') {
      toggleComment(view);
      view.focus();
    }
  });
}

// ── Math group responsive layout ──────────────────────────────────────────────
// The extra math buttons collapse into a "more" button when the full toolbar
// would wrap onto a second row. Measured instead of a fixed width, so adding or
// removing toolbar buttons needs no adjustment here.

setupContextMenu();

(function setupMathLayout() {
  const toolbar = document.getElementById('editor-toolbar');
  const items = [...toolbar.children].filter((el) => !el.classList.contains('tb-popup'));
  let lastWidth = -1;
  function update() {
    if (toolbar.offsetWidth === lastWidth) return; // height changes come from this toggle
    lastWidth = toolbar.offsetWidth;
    toolbar.classList.remove('tb-math-compact');
    const top = items[0].offsetTop;
    const wraps = items.some((el) => el.offsetTop > top + el.offsetHeight / 2);
    toolbar.classList.toggle('tb-math-compact', wraps);
  }
  new ResizeObserver(update).observe(toolbar);
  update();
})();
