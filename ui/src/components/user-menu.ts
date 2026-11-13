// SPDX-License-Identifier: AGPL-3.0-or-later

// The user menu (F-17, design spec 3.6): a dropdown under the avatar in the
// top bar instead of the old account modal. Name and role, Thema (Licht /
// Donker), Accentkleur (21 swatches, 7x3), Foto wijzigen (F-19),
// Pincode wijzigen, Nieuwe herstelcodes (admin) and Uitloggen. A look change
// applies at once; `onLook` saves it for the user.
//
// Not modal: no backdrop. It closes on Escape, a click outside, Tab out of it,
// or after an action; focus goes back to the avatar.

import { ACCENTS, ACCENT_FILL, type Accent, type Look, type Theme } from '../domain/look';
import { avatarHtml, loadAvatarPhotos, type AvatarUser } from './avatar';

export interface UserMenuOptions {
  /** The avatar button in the top bar. */
  anchor: HTMLElement;
  user: AvatarUser;
  name: string;
  /** "Docent · Natuurkunde", "Sectievoorzitter Natuurkunde", "Beheerder". */
  subtitle: string;
  /** Square avatar (admin, sectievoorzitter). */
  square: boolean;
  look: Look;
  onLook: (look: Look) => void;
  onChangePin: () => void;
  /** "Foto wijzigen" (F-19). */
  onChangePhoto: () => void;
  /** Only for the admin. */
  onRenewCodes?: () => void;
  onLogout: () => void;
  readPhoto: (relPath: string) => Promise<string | null>;
}

const ACCENT_LABEL = (a: Accent) => a.charAt(0).toUpperCase() + a.slice(1);
const THEMES: [Theme, string][] = [
  ['light', 'Licht'],
  ['dark', 'Donker'],
];

let open: { el: HTMLElement; close: (focusAnchor: boolean) => void } | null = null;

export function isUserMenuOpen(): boolean {
  return open !== null;
}

export function closeUserMenu(focusAnchor = false): void {
  open?.close(focusAnchor);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Opens the menu, or closes it when it is open. */
export function toggleUserMenu(opts: UserMenuOptions): void {
  if (open) {
    closeUserMenu(true);
    return;
  }
  const el = document.createElement('div');
  el.id = 'user-menu';
  el.className = 'user-menu';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Gebruikersmenu');
  el.innerHTML = `
    <div class="user-menu__who">
      ${avatarHtml(opts.user, { size: 40, ring: 'accent', square: opts.square })}
      <div class="user-menu__names">
        <span class="user-menu__name">${esc(opts.name)}</span>
        <span class="user-menu__role">${esc(opts.subtitle)}</span>
      </div>
    </div>
    <div class="user-menu__sep"></div>
    <div class="user-menu__row">
      <span id="user-menu-theme">Thema</span>
      <div class="segmented" role="group" aria-labelledby="user-menu-theme">
        ${THEMES.map(
          ([t, label]) =>
            `<button type="button" class="segmented__opt" data-theme-choice="${t}">${label}</button>`,
        ).join('')}
      </div>
    </div>
    <div class="user-menu__accents">
      <span id="user-menu-accent">Accentkleur</span>
      <div class="user-menu__grid" role="group" aria-labelledby="user-menu-accent">
        ${ACCENTS.map(
          (a) =>
            `<button type="button" class="accent-swatch" data-accent-choice="${a}" aria-label="${ACCENT_LABEL(a)}" title="${ACCENT_LABEL(a)}"></button>`,
        ).join('')}
      </div>
    </div>
    <div class="user-menu__sep"></div>
    <button type="button" class="user-menu__item" id="acc-photo">Foto wijzigen</button>
    <button type="button" class="user-menu__item" id="acc-pin">Pincode wijzigen</button>
    ${opts.onRenewCodes ? `<button type="button" class="user-menu__item" id="acc-codes">Nieuwe herstelcodes</button>` : ''}
    <div class="user-menu__sep"></div>
    <button type="button" class="user-menu__item user-menu__item--danger" id="acc-logout">Uitloggen</button>`;

  // Swatch fills through the CSSOM (no style attribute: strict CSP).
  for (const b of el.querySelectorAll<HTMLElement>('[data-accent-choice]')) {
    b.style.background = ACCENT_FILL[b.dataset.accentChoice as Accent];
  }

  let look = { ...opts.look };
  const sync = () => {
    for (const b of el.querySelectorAll<HTMLElement>('[data-theme-choice]'))
      b.setAttribute('aria-pressed', String(b.dataset.themeChoice === look.theme));
    for (const b of el.querySelectorAll<HTMLElement>('[data-accent-choice]'))
      b.setAttribute('aria-pressed', String(b.dataset.accentChoice === look.accent));
  };
  sync();

  const close = (focusAnchor: boolean) => {
    if (!open || open.el !== el) return;
    open = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    opts.anchor.setAttribute('aria-expanded', 'false');
    if (focusAnchor) opts.anchor.focus();
  };
  const onOutside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!el.contains(t) && !opts.anchor.contains(t)) close(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // A dialog that opened meanwhile (a reload notice) is on top: Escape is
    // its; the menu just goes (review 15 m4).
    if (document.querySelector('.dlg-backdrop')) {
      close(false);
      return;
    }
    // Only the menu closes, not a dialog under it (n8).
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };
  // Tab out of the menu (focus to something outside it) closes it (review 15 m4).
  el.addEventListener('focusout', (e) => {
    const next = e.relatedTarget as Node | null;
    // Not to the avatar: its click toggles the menu itself.
    if (next && !el.contains(next) && !opts.anchor.contains(next)) close(false);
  });
  /** Runs an action after the menu is gone (it may open a dialog). */
  const act = (fn: () => void) => () => {
    close(false);
    fn();
  };

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b || !el.contains(b)) return;
    const theme = b.dataset.themeChoice as Theme | undefined;
    const accent = b.dataset.accentChoice as Accent | undefined;
    if (!theme && !accent) return;
    const next = { theme: theme ?? look.theme, accent: accent ?? look.accent };
    if (next.theme === look.theme && next.accent === look.accent) return; // nothing to save
    look = next;
    sync();
    opts.onLook({ ...look });
  });
  el.querySelector('#acc-photo')!.addEventListener('click', act(opts.onChangePhoto));
  el.querySelector('#acc-pin')!.addEventListener('click', act(opts.onChangePin));
  if (opts.onRenewCodes)
    el.querySelector('#acc-codes')!.addEventListener('click', act(opts.onRenewCodes));
  el.querySelector('#acc-logout')!.addEventListener('click', act(opts.onLogout));

  document.body.append(el);
  open = { el, close };
  opts.anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  void loadAvatarPhotos(el, opts.readPhoto);
  // Focus the selected theme: the first control in the menu.
  el.querySelector<HTMLElement>('[data-theme-choice][aria-pressed="true"]')?.focus();
}
