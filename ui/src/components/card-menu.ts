// SPDX-License-Identifier: AGPL-3.0-or-later

// The ⋮ menu of a card (Toetsen, Observaties, Opdrachten): a list of actions under its button,
// right-aligned, flipped up when there is no room; Escape, a click outside, scrolling or a resize
// closes it. One menu is open at a time.

import { ICONS } from '../utils/icons.js';
import { esc } from './dialog';

export interface MenuAction {
  icon: string;
  label: string;
  danger?: boolean;
  /** Why it cannot be used now; shown as its tooltip. */
  disabled?: string | null;
  run?: () => unknown;
}
export type MenuItem = MenuAction | 'sep';

let openMenu: { el: HTMLElement; btn: HTMLElement; cleanup: () => void } | null = null;

export function closeCardMenu(): void {
  if (!openMenu) return;
  openMenu.cleanup();
  openMenu.el.remove();
  openMenu.btn.setAttribute('aria-expanded', 'false');
  openMenu.btn.classList.remove('active');
  openMenu = null;
}

/** Whether the menu of this button is the open one. */
export function isCardMenuOpen(btn: HTMLElement): boolean {
  return openMenu?.btn === btn;
}

/** Opens the menu under `btn` (closing any other); `items` may be built asynchronously. */
export async function showCardMenu(
  btn: HTMLElement,
  items: readonly MenuItem[] | Promise<readonly MenuItem[]>,
): Promise<void> {
  closeCardMenu();
  const list = await items;
  if (!btn.isConnected) return;
  closeCardMenu(); // another menu may have opened while awaiting

  const menu = document.createElement('div');
  menu.className = 'exam-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = list
    .map((it, i) =>
      it === 'sep'
        ? '<div class="exam-menu-sep" role="separator"></div>'
        : `<button class="exam-menu-item${it.danger ? ' exam-menu-item--danger' : ''}" role="menuitem" data-idx="${i}"${it.disabled ? ` aria-disabled="true" title="${esc(it.disabled)}"` : ''}><span class="exam-menu-icon">${it.icon}</span><span>${esc(it.label)}</span></button>`,
    )
    .join('');
  document.body.appendChild(menu);

  // Position below the button, right-aligned; flip up if there's no room below
  const r = btn.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const top = r.bottom + 4 + mh > window.innerHeight - 8 ? r.top - 4 - mh : r.bottom + 4;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;

  menu.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.exam-menu-item');
    if (!el || el.getAttribute('aria-disabled') === 'true') return;
    const item = list[Number(el.dataset.idx)];
    closeCardMenu();
    if (item && item !== 'sep') item.run?.();
  });

  const onDocDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!menu.contains(target) && !btn.contains(target)) closeCardMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCardMenu();
      btn.focus();
    }
  };
  const onScrollResize = () => closeCardMenu();
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onScrollResize);
  window.addEventListener('scroll', onScrollResize, true);

  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('active');
  openMenu = {
    el: menu,
    btn,
    cleanup: () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScrollResize);
      window.removeEventListener('scroll', onScrollResize, true);
    },
  };
}

/** The ⋮ button of a card; `data-*` attributes tell the list's click handler which card. */
export function cardMenuButton(data: Record<string, string>, label = 'Meer acties'): string {
  const attrs = Object.entries(data)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join('');
  return `<button type="button" class="btn btn--icon card-menu-btn"${attrs} title="${esc(label)}" aria-label="${esc(label)}" aria-haspopup="menu" aria-expanded="false">${ICONS.dots}</button>`;
}
