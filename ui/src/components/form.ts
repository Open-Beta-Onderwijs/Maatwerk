// SPDX-License-Identifier: AGPL-3.0-or-later

// Form layout (design spec 3.7) and tick boxes (3.9).
//
// - A form row aligns its fields on their labels: every label (12/700
//   uppercase) at the same height, every control starting at the same height
//   below it. A control narrower than its column (swatches, a tick box, a
//   segmented control) is centred in its column at the row's control height.
// - A single yes/no field is a 36×36 tick box under its label, with a tooltip
//   that spells out the short label.

import { esc } from './dialog';

export interface FieldOptions {
  /** `for` of the label (the control's id). */
  for?: string;
  /** Flex sizing of the column: a number (share), 'none' (content width) or 'fill'. */
  grow?: number | 'none' | 'fill';
  /** Centre a control that is narrower than its column (3.7). */
  center?: boolean;
  /** Muted line under the control. */
  hint?: string;
  /** Extra classes on the field. */
  className?: string;
}

/** One labelled field. `control` is HTML; the caller escapes every text in it. */
export function field(label: string, control: string, opts: FieldOptions = {}): string {
  const cls = ['form-group', 'form-field'];
  if (opts.grow === 'none') cls.push('form-field--none');
  else if (opts.grow === 'fill') cls.push('form-field--fill');
  else if (typeof opts.grow === 'number') cls.push(`form-field--grow-${opts.grow}`);
  if (opts.center) cls.push('form-field--center');
  if (opts.className) cls.push(opts.className);
  return `<div class="${cls.join(' ')}">
    <label${opts.for ? ` for="${esc(opts.for)}"` : ''}>${esc(label)}</label>
    <div class="form-control">${control}</div>
    ${opts.hint ? `<span class="form-hint muted">${esc(opts.hint)}</span>` : ''}
  </div>`;
}

/** Fields that share a row, aligned on their labels. */
export function formRow(...fields: string[]): string {
  return `<div class="form-row">${fields.join('')}</div>`;
}

export interface TickBoxOptions {
  checked?: boolean;
  disabled?: boolean;
  /** Tooltip spelling out the short label ("D" = "Diagnostisch: …"). */
  title?: string;
  /** Accessible name; defaults to the title. */
  ariaLabel?: string;
}

/** A 36×36 tick box (a toggle button: `data-checked` and `aria-pressed`). */
export function tickBox(id: string, opts: TickBoxOptions = {}): string {
  const on = opts.checked ? 'true' : 'false';
  const name = opts.ariaLabel ?? opts.title;
  return `<button type="button" class="tick-box" id="${esc(id)}" data-checked="${on}" aria-pressed="${on}"${
    opts.title ? ` title="${esc(opts.title)}"` : ''
  }${name ? ` aria-label="${esc(name)}"` : ''}${opts.disabled ? ' disabled' : ''}><span aria-hidden="true">✓</span></button>`;
}

/** Whether a tick box is ticked. */
export function isTicked(box: HTMLElement): boolean {
  return box.dataset.checked === 'true';
}

/** Flip a tick box; returns the new state. */
export function toggleTick(box: HTMLElement): boolean {
  const on = !isTicked(box);
  box.dataset.checked = String(on);
  box.setAttribute('aria-pressed', String(on));
  return on;
}
