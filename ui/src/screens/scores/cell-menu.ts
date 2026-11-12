// SPDX-License-Identifier: AGPL-3.0-or-later

// A small context menu at a point, with the look of the exam card menus (the Cijfer cell's
// "Berekend cijfer herstellen").

import { escHtml, onModalCleanup } from '../../app.js';

export interface CellMenuItem {
  icon: string;
  label: string;
  run: () => unknown;
}

export function showCellMenu(x: number, y: number, items: CellMenuItem[]): void {
  const menu = document.createElement('div');
  menu.className = 'exam-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map(
      (it, i) =>
        `<button class="exam-menu-item" role="menuitem" data-idx="${i}"><span class="exam-menu-icon">${escHtml(it.icon)}</span><span>${escHtml(it.label)}</span></button>`,
    )
    .join('');
  document.body.appendChild(menu);
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;

  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
  };
  const onDocDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); // handled: the score modal stays open
    e.stopPropagation();
    close();
  };
  menu.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.exam-menu-item');
    if (!el) return;
    close();
    void items[Number(el.dataset.idx)]?.run();
  });
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  onModalCleanup(close);
}
