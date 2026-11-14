// SPDX-License-Identifier: AGPL-3.0-or-later

// The grade tooltip (design spec 3.10, PLAN-2 decision 29): hovering (or focusing) a grade or
// score cell with `data-tip="<key>"` shows a title, a sub line and the observaties (icon and
// name) or "Geen observaties", under the cell: aligned left in the left columns, right in the
// right ones (`data-tip-align="right"`). Dark in the light theme, light in the dark theme (CSS).
// One floating element per root, positioned with the CSSOM (the CSP allows that).

import { esc } from '../utils/html';

export interface TipContent {
  head: string;
  sub?: string;
  /** Extra lines before the observaties (a grade build-up). */
  extra?: string[];
  /** null: no observaties line at all (a cell without a grade). */
  obs: { icon?: string; naam?: string }[] | null;
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
    obs
  );
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
  // In the dialog, so it is above the sticky header and footer and inside the top layer.
  (root.closest('dialog') ?? document.body).appendChild(tip);
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
    tip.hidden = false;
    const host = tip.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const r = cell.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const right = cell.dataset.tipAlign === 'right';
    let left = right ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = r.top - h - 4;
    tip.style.left = `${Math.round(left - host.left)}px`;
    tip.style.top = `${Math.round(top - host.top)}px`;
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
