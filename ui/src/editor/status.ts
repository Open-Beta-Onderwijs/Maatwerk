// SPDX-License-Identifier: AGPL-3.0-or-later

// The editor's status pill (F-05, design spec 4.8): "Compileren…" with a spinner while a compile
// runs (accent tint), "Opgeslagen · PDF bijgewerkt" with a check when the text is saved and
// compiled (green tint), errors in danger tint. An error with details is a button that opens them
// in a popover (`#btn-render-error`).
//
// Three separate inputs (review 30-31 M1): an action message (`setStatus`: "Fout bij opslaan",
// "Staat in lib.typ"), the compile error of the current text (`setRenderError`), and whether the
// text has unsaved edits (`setDirty`). "Opgeslagen" only shows when nothing is unsaved.

export type PillKind = 'busy' | 'ok' | 'info' | 'error';

interface Message {
  text: string;
  /** Details behind an error (open in the popover). */
  details: string | null;
  error: boolean;
}

/** A compile shorter than this shows no spinner (no flicker on every keystroke). */
const BUSY_DELAY_MS = 200;

const OK_TEXT = 'Opgeslagen · PDF bijgewerkt';
const DIRTY_TEXT = 'Niet opgeslagen…';
const RENDER_ERROR_TEXT = 'Fout bij renderen';

const SPINNER =
  '<svg class="status-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9"></path></svg>';
const CHECK =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"></path></svg>';

let pill: HTMLElement | null = null;
let popover: HTMLElement;
let popoverOpen = false;
let message: Message = { text: 'Laden…', details: null, error: false };
let renderError: string | null = null;
let dirty = false;
let compiling = false;
let busyTimer: ReturnType<typeof setTimeout> | null = null;
/** What the pill shows now; a render of the same state changes nothing (review m6). */
let shownKey = '';

export function initStatus(pillEl: HTMLElement, popoverEl: HTMLElement): void {
  pill = pillEl;
  popover = popoverEl;
  render();
}

function openPopover(anchor: HTMLElement): void {
  popoverOpen = true;
  popover.style.display = '';
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(560, window.innerWidth - 20);
  // Right-aligned under the pill (the pill sits at the right of the header).
  const left = Math.min(rect.right - width, window.innerWidth - width - 10);
  popover.style.left = `${Math.max(10, left)}px`;
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.maxWidth = `${width}px`;
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

function closePopover(): void {
  popoverOpen = false;
  popover.style.display = 'none';
  document.removeEventListener('mousedown', dismiss);
}

function dismiss(e: MouseEvent): void {
  if (!popover.contains(e.target as Node)) closePopover();
}

function errorButton(el: HTMLElement, text: string, details: string): void {
  popover.textContent = details;
  const btn = document.createElement('button');
  btn.id = 'btn-render-error';
  btn.type = 'button';
  btn.textContent = text;
  btn.title = 'Toon de melding';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popoverOpen) closePopover();
    else openPopover(el);
  });
  el.replaceChildren(btn);
}

/** The state to show, in order of importance. */
function state(): { kind: PillKind; text: string; details: string | null } {
  if (message.details !== null)
    return { kind: 'error', text: message.text, details: message.details };
  if (renderError !== null) return { kind: 'error', text: RENDER_ERROR_TEXT, details: renderError };
  if (compiling && busyTimer === null) return { kind: 'busy', text: 'Compileren…', details: null };
  if (message.error) return { kind: 'error', text: message.text, details: null };
  if (dirty) return { kind: 'info', text: DIRTY_TEXT, details: null };
  if (message.text === '' || message.text === 'Opgeslagen')
    return { kind: 'ok', text: OK_TEXT, details: null };
  return { kind: 'info', text: message.text, details: null };
}

function render(): void {
  if (!pill) return;
  const s = state();
  const key = JSON.stringify(s);
  if (key === shownKey) return;
  shownKey = key;
  closePopover();
  pill.dataset.kind = s.kind;
  if (s.details !== null) errorButton(pill, s.text, s.details);
  else if (s.kind === 'busy') pill.innerHTML = `${SPINNER}<span>${s.text}</span>`;
  else if (s.kind === 'ok') pill.innerHTML = `${CHECK}<span>${s.text}</span>`;
  else pill.textContent = s.text;
}

/**
 * A message from an action (load, save, restore, image). `details` makes it an error with a
 * popover; `error` a danger message without one. `''` and "Opgeslagen" show the all-done state
 * once nothing is unsaved.
 */
export function setStatus(text: string, details: string | null = null, error = false): void {
  message = { text, details, error: error || details !== null };
  render();
}

/** Whether the last action message is an error (a failed save stays until the next save). */
export function hasActionError(): boolean {
  return message.error;
}

/** The compile error of the current text (`null`: it compiles). */
export function setRenderError(details: string | null): void {
  renderError = details;
  render();
}

/** Whether a compile error is shown. */
export function hasRenderError(): boolean {
  return renderError !== null;
}

/** The text has edits that are not saved yet. */
export function setDirty(on: boolean): void {
  dirty = on;
  render();
}

/** A compile is running (or edits are on their way to it). */
export function setCompiling(on: boolean): void {
  if (on === compiling) return;
  compiling = on;
  if (busyTimer !== null) clearTimeout(busyTimer);
  busyTimer = null;
  if (on) {
    busyTimer = setTimeout(() => {
      busyTimer = null;
      render();
    }, BUSY_DELAY_MS);
    return;
  }
  render();
}
