// SPDX-License-Identifier: AGPL-3.0-or-later

// The editor's status pill (F-05, design spec 4.8): "Compileren…" with a spinner while a compile
// runs (accent tint), "Opgeslagen · PDF bijgewerkt" with a check when all is done (green tint),
// errors in danger tint. A render error is a button that opens the full diagnostics in a
// popover (`#btn-render-error`). Other messages ("Niet opgeslagen…", "Staat in lib.typ") show
// as they are, neutral.

export type PillKind = 'busy' | 'ok' | 'info' | 'error';

interface Message {
  text: string;
  /** The diagnostics behind a render error (opens the popover). */
  details: string | null;
  error: boolean;
}

/** A compile shorter than this shows no spinner (no flicker on every keystroke). */
const BUSY_DELAY_MS = 200;

const OK_TEXT = 'Opgeslagen · PDF bijgewerkt';

const SPINNER =
  '<svg class="status-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9"></path></svg>';
const CHECK =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"></path></svg>';

let pill: HTMLElement;
let popover: HTMLElement;
let popoverOpen = false;
let message: Message = { text: '', details: null, error: false };
let compiling = false;
let busyTimer: ReturnType<typeof setTimeout> | null = null;

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

function setKind(kind: PillKind): void {
  pill.dataset.kind = kind;
}

function render(): void {
  if (!pill) return;
  closePopover();
  if (message.details !== null) {
    setKind('error');
    popover.textContent = message.details;
    const btn = document.createElement('button');
    btn.id = 'btn-render-error';
    btn.type = 'button';
    btn.textContent = message.text;
    btn.title = 'Toon de melding';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (popoverOpen) closePopover();
      else openPopover(pill);
    });
    pill.replaceChildren(btn);
    return;
  }
  if (compiling && busyTimer === null) {
    setKind('busy');
    pill.innerHTML = `${SPINNER}<span>Compileren…</span>`;
    return;
  }
  if (message.error) {
    setKind('error');
    pill.textContent = message.text;
    return;
  }
  if (message.text === '' || message.text === 'Opgeslagen') {
    setKind('ok');
    pill.innerHTML = `${CHECK}<span>${OK_TEXT}</span>`;
    return;
  }
  setKind('info');
  pill.textContent = message.text;
}

/**
 * A message in the pill. `details` makes it a render error with a popover; `error` a danger
 * message without one. `''` and "Opgeslagen" show the all-done state.
 */
export function setStatus(text: string, details: string | null = null, error = false): void {
  message = { text, details, error: error || details !== null };
  render();
}

/** Whether a render error is shown (saving does not clear it). */
export function hasRenderError(): boolean {
  return message.details !== null;
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
