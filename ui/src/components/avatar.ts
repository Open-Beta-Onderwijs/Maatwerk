// SPDX-License-Identifier: AGPL-3.0-or-later

// One avatar for a user everywhere (B-04, B-08, spec 3.6): the photo when
// there is one, else the initials (afkorting, or the first letter of the first
// name), inside a ring. Round for teachers, square for the admin and for a
// sectievoorzitter login. The ring is the user's colour, or the accent (the
// top bar and the user menu, spec 3.6), or a presence state.
//
// The markup is static HTML (no style attribute: strict CSP); the ring colour
// goes through `data-badge-color` (legacy/style-data.ts). Photos are loaded
// afterwards with `loadAvatarPhotos`, as an <img> over the initials.

/** HTML-escapes text (kept here: the editor iframe imports this file without the dialog). */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface AvatarUser {
  id?: string;
  voornaam?: string | null;
  achternaam?: string | null;
  afkorting?: string | null;
  kleur?: string | null;
  foto?: string | null;
  isAdmin?: boolean;
}

/** Sizes in px used by the design: presence 24, notices 30, top bar 38, menu 40, lists 56. */
export type AvatarSize = 24 | 30 | 38 | 40 | 56;

export interface AvatarOptions {
  size: AvatarSize;
  /** Square instead of round (admin, sectievoorzitter); default: square for an admin. */
  square?: boolean;
  /** Ring colour: the user's own (default), the accent, or none (presence sets its own). */
  ring?: 'user' | 'accent' | 'none';
  /** Extra classes on the avatar element. */
  className?: string;
  /** Tooltip. */
  title?: string;
  /** Load the photo (default true); false shows only the initials. */
  photo?: boolean;
}

export const FALLBACK_RING = '#888888';

/** The text in an avatar without a photo: the afkorting, else the first letters of the names. */
export function avatarInitials(user: AvatarUser): string {
  const afk = user.afkorting?.trim();
  if (afk) return afk;
  const letters = (user.voornaam?.trim()?.[0] ?? '') + (user.achternaam?.trim()?.[0] ?? '');
  return letters || '?';
}

/** Classes and data attributes shared by `avatarHtml` and `renderAvatar`. */
function parts(user: AvatarUser, opts: AvatarOptions) {
  const initials = avatarInitials(user);
  const square = opts.square ?? !!user.isAdmin;
  const ring = opts.ring ?? 'user';
  const cls = [
    'avatar',
    `avatar--${opts.size}`,
    square ? 'avatar--square' : 'avatar--round',
    `avatar--ring-${ring}`,
    opts.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const len = Math.min(initials.length, 5);
  return { initials, cls, len, color: user.kleur || FALLBACK_RING };
}

/** The avatar as HTML; call `loadAvatarPhotos` on its container afterwards for the photo. */
export function avatarHtml(user: AvatarUser, opts: AvatarOptions): string {
  const { initials, cls, len, color } = parts(user, opts);
  const photo =
    opts.photo !== false && user.foto ? ` data-avatar-foto="${escHtml(user.foto)}"` : '';
  const title = opts.title ? ` title="${escHtml(opts.title)}"` : '';
  return (
    `<span class="${cls}" data-len="${len}" data-badge-color="${escHtml(color)}"${photo}${title}>` +
    `<span class="avatar-initials">${escHtml(initials)}</span></span>`
  );
}

/**
 * Turns an existing element (a button) into the avatar: same classes and
 * content as `avatarHtml`. Returns a promise for the photo.
 */
export function renderAvatar(
  el: HTMLElement,
  user: AvatarUser,
  opts: AvatarOptions,
  readPhoto: (relPath: string) => Promise<string | null>,
): Promise<void> {
  const { initials, cls, len, color } = parts(user, opts);
  // Keep classes that are not the avatar's own (`hidden`, the element's role).
  const keep = [...el.classList].filter((c) => !c.startsWith('avatar'));
  el.className = [...keep, ...cls.split(' ')].join(' ');
  el.dataset.len = String(len);
  el.style.setProperty('--badge-color', color);
  el.replaceChildren();
  const text = document.createElement('span');
  text.className = 'avatar-initials';
  text.textContent = initials;
  el.append(text);
  if (opts.photo !== false && user.foto) {
    el.dataset.avatarFoto = user.foto;
    return loadAvatarPhoto(el, readPhoto);
  }
  delete el.dataset.avatarFoto;
  return Promise.resolve();
}

/**
 * Photos read in the last few seconds: presence avatars redraw on every
 * heartbeat and a list may show the same user twice. Short, so a photo the
 * admin replaced under the same name shows up soon.
 */
const PHOTO_TTL_MS = 30_000;
const photoCache = new Map<string, { at: number; url: Promise<string | null> }>();

function cachedPhoto(
  rel: string,
  readPhoto: (relPath: string) => Promise<string | null>,
): Promise<string | null> {
  const now = Date.now();
  const hit = photoCache.get(rel);
  if (hit && now - hit.at < PHOTO_TTL_MS) return hit.url;
  const url = readPhoto(rel).catch((e) => {
    console.warn('[avatar]', e);
    return null;
  });
  photoCache.set(rel, { at: now, url });
  return url;
}

/** Forgets cached photos (after this app saved a new photo). */
export function forgetAvatarPhotos(): void {
  photoCache.clear();
}

async function loadAvatarPhoto(
  el: HTMLElement,
  readPhoto: (relPath: string) => Promise<string | null>,
): Promise<void> {
  const rel = el.dataset.avatarFoto;
  if (!rel) return;
  const url = await cachedPhoto(rel, readPhoto);
  // Gone, or reused for someone else meanwhile: leave it.
  if (!url || !el.isConnected || el.dataset.avatarFoto !== rel) return;
  el.querySelector('.avatar-photo')?.remove();
  const img = document.createElement('img');
  img.className = 'avatar-photo';
  img.alt = '';
  img.src = url;
  el.append(img);
  el.classList.add('avatar--photo');
}

/** Loads the photo of every avatar under `root`. */
export function loadAvatarPhotos(
  root: ParentNode,
  readPhoto: (relPath: string) => Promise<string | null>,
): Promise<void[]> {
  const els = [...root.querySelectorAll<HTMLElement>('[data-avatar-foto]')];
  return Promise.all(els.map((el) => loadAvatarPhoto(el, readPhoto)));
}
