// SPDX-License-Identifier: AGPL-3.0-or-later

// The grade tooltip (design spec 3.10, PLAN-2 decision 29): hovering (or focusing) a grade or
// score cell with `data-tip="<key>"` shows a title, a sub line and the observaties (icon and
// name) or "Geen observaties", under the cell: aligned left in the left columns, right in the
// right ones (`data-tip-align="right"`). Dark in the light theme, light in the dark theme (CSS).
// One floating element per root, positioned with the CSSOM (the CSP allows that). It always stays
// on screen (step 37, user): under the cell, else above it, else beside it; one taller than the
// window puts its rows in two columns first.

import { esc } from '../utils/html';

export interface TipContent {
  head: string;
  sub?: string;
  /** Extra lines before the observaties (a grade build-up). */
  extra?: string[];
  /** null: no observaties line at all (a cell without a grade). */
  obs: { icon?: string; naam?: string }[] | null;
  /** Label and value rows after the observaties (a PO's category scores), under a line. */
  rows?: [string, string][];
}

export function tipHtml(t: TipContent): string {
  const obs =
    t.obs === null
      ? ''
      : t.obs.length
        ? t.obs
            .map(
              (o) =>
                `<div class="ov-tip__obs"><span class="ov-tip__icon" aria-hidden="true">${esc(o.icon ?? '')}</span><span>${esc(o.naam ?? '')}</span></div>`,
            )
            .join('')
        : '<span class="ov-tip__mute">Geen observaties</span>';
  return (
    `<b class="ov-tip__head">${esc(t.head)}</b>` +
    (t.sub ? `<span class="ov-tip__mute">${esc(t.sub)}</span>` : '') +
    (t.extra ?? []).map((l) => `<span>${esc(l)}</span>`).join('') +
    obs +
    (t.rows?.length
      ? `<div class="ov-tip__rows">${t.rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div>`
      : '')
  );
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const MARGIN = 8;
const GAP = 4;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * Where a `w` x `h` tooltip goes for `cell` in a `vw` x `vh` window: under the cell, else above
 * it, else beside it (left of a right-aligned cell, right of a left-aligned one, whichever fits),
 * vertically centred on the cell and kept on screen. Pure.
 */
export function placeTip(
  cell: Box,
  w: number,
  h: number,
  vw: number,
  vh: number,
  alignRight: boolean,
): { left: number; top: number } {
  const maxLeft = Math.max(MARGIN, vw - w - MARGIN);
  const maxTop = Math.max(MARGIN, vh - h - MARGIN);
  const left = clamp(alignRight ? cell.right - w : cell.left, MARGIN, maxLeft);
  if (cell.bottom + GAP + h <= vh - MARGIN) return { left, top: cell.bottom + GAP };
  if (cell.top - GAP - h >= MARGIN) return { left, top: cell.top - GAP - h };
  const before = cell.left - GAP - w;
  const after = cell.right + GAP;
  const fitsBefore = before >= MARGIN;
  const fitsAfter = after + w <= vw - MARGIN;
  const side = alignRight
    ? fitsBefore || !fitsAfter
      ? before
      : after
    : fitsAfter || !fitsBefore
      ? after
      : before;
  const middle = (cell.top + cell.bottom) / 2 - h / 2;
  return { left: clamp(side, MARGIN, maxLeft), top: clamp(middle, MARGIN, maxTop) };
}

/**
 * Shows tooltips for the `[data-tip]` cells in `root`; `lookup` gives the content of a key.
 * Returns a function that removes the tooltip and the listeners.
 */
export function installGradeTips(
  root: HTMLElement,
  lookup: (key: string) => TipContent | null,
): () => void {
  const tip = document.createElement('div');
  tip.className = 'ov-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  // On the modal's backdrop (fixed, viewport coordinates): above the sticky header and footer,
  // and not clipped by the dialog's rounded box.
  (root.closest('.dlg-backdrop') ?? document.body).appendChild(tip);
  let current: HTMLElement | null = null;

  const hide = () => {
    tip.hidden = true;
    current?.removeAttribute('aria-describedby');
    current = null;
  };
  const show = (cell: HTMLElement) => {
    const content = lookup(cell.dataset.tip ?? '');
    if (!content) return hide();
    current = cell;
    tip.innerHTML = tipHtml(content);
    tip.classList.remove('ov-tip--wide');
    tip.hidden = false;
    // Taller than the window (a rubric with many categories): the rows go in two columns.
    // scrollHeight: the content's height; the CSS cap keeps offsetHeight under the window.
    if (tip.scrollHeight > window.innerHeight - 2 * MARGIN) tip.classList.add('ov-tip--wide');
    const { left, top } = placeTip(
      cell.getBoundingClientRect(),
      tip.offsetWidth,
      tip.offsetHeight,
      window.innerWidth,
      window.innerHeight,
      cell.dataset.tipAlign === 'right',
    );
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };
  const cellOf = (e: Event) =>
    (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
  const over = (e: Event) => {
    const cell = cellOf(e);
    if (cell && root.contains(cell) && cell !== current) show(cell);
  };
  const out = (e: MouseEvent | FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (current && (!to || !current.contains(to))) hide();
  };
  root.addEventListener('mouseover', over);
  root.addEventListener('mouseout', out);
  root.addEventListener('focusin', over);
  root.addEventListener('focusout', out);
  root.addEventListener('scroll', hide, true);
  return () => {
    root.removeEventListener('mouseover', over);
    root.removeEventListener('mouseout', out);
    root.removeEventListener('focusin', over);
    root.removeEventListener('focusout', out);
    root.removeEventListener('scroll', hide, true);
    tip.remove();
  };
}
