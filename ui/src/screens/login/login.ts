// SPDX-License-Identifier: AGPL-3.0-or-later

// The login screen (V-04, design spec 4.2, board 5). Three stages on one
// screen, no overlay:
//   start: the wordmark, "Kies je vak" and four large vak tiles;
//   vak:   the tiles move up and shrink, the vak's users fade in per group;
//   user:  the chosen avatar flies to the left of the PIN block (FLIP), the
//          rest fades out. "Andere gebruiker" plays it in reverse.
// Under prefers-reduced-motion the movement becomes a fade.

import { escHtml, navigateTo, showUserBadge } from '../../app.js';
import { avatarHtml, loadAvatarPhotos } from '../../components/avatar';
import {
  loginGroups,
  vakTiles,
  type LoginGroup,
  type LoginRole,
  type LoginUser,
  type VakTile,
} from '../../domain/login';
import { hideSplash } from '../../shell/splash';
import { Store } from '../../store.js';
import { applyUserLook } from '../../theme';
import { showAbout } from '../about';
import { scoreSavesDone } from '../scores/session';
import { mountPinPanel } from './pin-panel';

type Stage = 'start' | 'vak' | 'user';

// store.js is untyped: its default parameter reads as `null`.
const setActiveUser = Store.setActiveUser as (
  user: LoginUser,
  role: { voorzitter: string } | null,
) => void;

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const FLIGHT_MS = 600;

const asset = (name: string) => new URL(`../../assets/brand/${name}`, import.meta.url).href;

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function tileHtml(t: VakTile): string {
  const off = t.disabled ? ' disabled title="Nog geen gebruikers voor dit vak"' : '';
  return `
    <button type="button" class="subject-card login-tile" data-subject="${escHtml(t.key)}"
            aria-pressed="false"${off}>
      <span class="subject-emoji" aria-hidden="true">${t.emoji}</span>
      <span class="subject-label">${escHtml(t.name)}</span>
      ${t.disabled ? '<span class="login-tile-none">nog geen gebruikers</span>' : ''}
    </button>`;
}

function userHtml(u: LoginUser, role: LoginRole): string {
  // `data-voorzitter-id` (not data-user-id) keeps the teacher's own badge the
  // only one with their id.
  const idAttr =
    role === 'voorzitter'
      ? `class="user-badge badge-voorzitter login-user" data-voorzitter-id="${escHtml(u.id)}"`
      : `class="user-badge login-user" data-user-id="${escHtml(u.id)}"`;
  return `
    <button type="button" ${idAttr} data-role="${role}">
      ${avatarHtml(u, { size: 80, square: role !== 'docent' })}
      <span class="badge-name">${escHtml(u.voornaam)}</span>
    </button>`;
}

function groupHtml(g: LoginGroup): string {
  return `
    <section class="login-group" data-role="${g.role}">
      <h2 class="login-group-label">${g.label}</h2>
      <div class="login-group-users">${g.users.map((u) => userHtml(u, g.role)).join('')}</div>
    </section>`;
}

function shellHtml(tiles: VakTile[]): string {
  return `
    <div class="login" data-stage="start">
      <div class="login-brand" aria-hidden="true">
        <img class="login-brand-icon theme-light-only" src="${asset('maatwerk-icon.svg')}" alt="" />
        <img class="login-brand-icon theme-dark-only" src="${asset('maatwerk-icon-dark.svg')}" alt="" />
        <img class="login-brand-word theme-light-only" src="${asset('maatwerk-tabbalk.svg')}" alt="" />
        <img class="login-brand-word theme-dark-only" src="${asset('maatwerk-tabbalk-dark.svg')}" alt="" />
      </div>
      <div class="login-mark">
        <img class="login-wordmark theme-light-only" src="${asset('maatwerk-wordmark.svg')}" alt="Maatwerk" />
        <img class="login-wordmark theme-dark-only" src="${asset('maatwerk-wordmark-dark.svg')}" alt="Maatwerk" />
        <p class="login-mark-hint">Kies je vak</p>
      </div>
      <div class="login-tiles" role="group" aria-label="Vak">${tiles.map(tileHtml).join('')}</div>
      <div class="login-users"></div>
      <div class="login-pin" hidden>
        <div class="login-hero-slot"></div>
        <form class="login-pin-form" aria-label="Inloggen"></form>
      </div>
      <button type="button" class="login-about" data-action="about">Over Maatwerk</button>
    </div>`;
}

/** Waits two frames, so a style set now is the start of a transition. */
function nextFrames(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/** translate + scale that puts a box of rect `to` on rect `from` (origin top left). */
function flipTransform(from: DOMRect, to: DOMRect): string {
  const s = to.width ? from.width / to.width : 1;
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`;
}

export async function renderStartup(): Promise<void> {
  const container = document.getElementById('screen-startup') as HTMLElement;
  try {
    const [users, session] = (await Promise.all([
      Store.loadUsers(),
      Store.loadLastSession(),
      Store.loadSchool(),
    ])) as [LoginUser[], { lastSubject?: string } | null, unknown];
    mountLogin(container, users, session?.lastSubject ?? null);
  } finally {
    hideSplash();
  }
}

function mountLogin(container: HTMLElement, users: LoginUser[], remembered: string | null): void {
  const display = Store.SUBJECT_DISPLAY as Record<string, string>;
  const tiles = vakTiles(users, display);
  container.innerHTML = shellHtml(tiles);

  const root = container.querySelector('.login') as HTMLElement;
  const panel = root.querySelector('.login-users') as HTMLElement;
  const pin = root.querySelector('.login-pin') as HTMLElement;
  const slot = root.querySelector('.login-hero-slot') as HTMLElement;
  const form = root.querySelector('.login-pin-form') as HTMLFormElement;
  const readPhoto = (rel: string) => window.maatwerk.readPhotoAsDataUrl(rel);

  let vak: string | null = null;
  /** The badge the hero flew from, while a user is chosen. */
  let source: HTMLButtonElement | null = null;
  let busy = false;

  const setStage = (s: Stage) => (root.dataset.stage = s);

  function selectVak(key: string | null, focusUsers = false): void {
    vak = key;
    root
      .querySelectorAll<HTMLButtonElement>('.login-tile')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.subject === key)));
    if (!key) {
      setStage('start');
      return;
    }
    const groups = loginGroups(users, key, Store.voorzitterOf(key) as string | null);
    // The new users start hidden, then fade in group by group (stagger).
    panel.classList.add('login-users--enter');
    panel.innerHTML = groups.map(groupHtml).join('');
    panel.querySelectorAll<HTMLElement>('.login-user').forEach((b, i) => {
      b.style.setProperty('--i', String(i));
      b.addEventListener('click', () => void pickUser(b as HTMLButtonElement));
    });
    void loadAvatarPhotos(panel, readPhoto);
    setStage('vak');
    void nextFrames().then(() => panel.classList.remove('login-users--enter'));
    if (focusUsers) panel.querySelector<HTMLElement>('.login-user')?.focus({ preventScroll: true });
  }

  function userFor(badge: HTMLElement): { user: LoginUser; role: LoginRole } | null {
    const role = badge.dataset.role as LoginRole;
    const id = badge.dataset.userId ?? badge.dataset.voorzitterId;
    const user = users.find((u) => u.id === id);
    return user ? { user, role } : null;
  }

  async function pickUser(badge: HTMLButtonElement): Promise<void> {
    if (busy || !vak) return;
    const picked = userFor(badge);
    if (!picked) return;
    busy = true;
    source = badge;
    const from = badge.querySelector('.avatar')!.getBoundingClientRect();

    slot.innerHTML = avatarHtml(picked.user, {
      size: 152,
      square: picked.role !== 'docent',
      className: 'login-hero',
    });
    void loadAvatarPhotos(slot, readPhoto);
    const panelApi = mountPinPanel(form, {
      user: picked.user,
      role: picked.role,
      vakName: (Store.SUBJECT_DISPLAY as Record<string, string>)[vak] ?? vak,
      api: window.maatwerk,
      onBack: () => void back(),
      onLoggedIn: (fresh) => logIn(fresh, picked.role),
    });
    pin.hidden = false;
    badge.classList.add('is-flying');
    setStage('user');

    const hero = slot.firstElementChild as HTMLElement;
    const opts = { duration: FLIGHT_MS, easing: EASE };
    let flight: Animation;
    if (reducedMotion()) {
      flight = hero.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
      form.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    } else {
      const to = hero.getBoundingClientRect();
      flight = hero.animate(
        [{ transform: flipTransform(from, to), boxShadow: 'none' }, { transform: 'none' }],
        opts,
      );
      form.animate(
        [
          { opacity: 0, transform: 'translateX(24px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 500, delay: 200, easing: EASE, fill: 'backwards' },
      );
    }
    panelApi.focus();
    // "Andere gebruiker" waits until the avatar has landed (review 26-28 m1).
    await flight.finished.catch(() => undefined);
    busy = false;
  }

  /** "Andere gebruiker": the flight in reverse, then the users again. */
  async function back(): Promise<void> {
    const badge = source;
    const hero = slot.firstElementChild as HTMLElement | null;
    if (busy || !badge || !hero) return;
    busy = true;
    setStage('vak');
    if (reducedMotion()) {
      await Promise.all([
        hero.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })
          .finished,
        form.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })
          .finished,
      ]).catch(() => undefined);
    } else {
      const to = badge.querySelector('.avatar')!.getBoundingClientRect();
      const at = hero.getBoundingClientRect();
      form.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translateX(24px)' },
        ],
        { duration: 250, easing: 'ease', fill: 'forwards' },
      );
      await hero
        .animate([{ transform: 'none' }, { transform: flipTransform(to, at), boxShadow: 'none' }], {
          duration: FLIGHT_MS,
          easing: EASE,
          fill: 'forwards',
        })
        .finished.catch(() => undefined);
    }
    pin.hidden = true;
    slot.replaceChildren();
    form.getAnimations().forEach((a) => a.cancel());
    form.replaceChildren();
    badge.classList.remove('is-flying');
    badge.focus({ preventScroll: true });
    source = null;
    busy = false;
  }

  async function logIn(fresh: LoginUser, role: LoginRole): Promise<void> {
    const subject = vak!;
    Store.cacheUser(fresh);
    // Score saves still queued belong to the previous user (review 3b M1).
    await scoreSavesDone();
    setActiveUser(fresh, role === 'voorzitter' ? { voorzitter: subject } : null);
    // The teacher's own look (F-18) before the main screen is shown.
    applyUserLook(fresh);
    await Store.initSubject(subject);
    await Store.saveLastSession(subject, fresh.id);
    await showUserBadge(fresh, subject);
    navigateTo('leerlingen');
    // The PIN fields would clash with the ids of the "Pincode wijzigen" dialog.
    container.replaceChildren();
  }

  root.querySelector('[data-action="about"]')!.addEventListener('click', () => showAbout());
  root.querySelectorAll<HTMLButtonElement>('.login-tile').forEach((b) => {
    b.addEventListener('click', (e) => {
      if (busy || root.dataset.stage === 'user') return;
      const key = b.dataset.subject!;
      // Clicking the chosen tile again goes back (spec 4.2 step 2).
      // A keyboard click (detail 0) moves the focus on to the users.
      selectVak(vak === key ? null : key, e.detail === 0 && vak !== key);
    });
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || root.dataset.stage !== 'vak') return;
    if (!root.contains(document.activeElement)) return;
    e.preventDefault();
    const tile = root.querySelector<HTMLElement>(`.login-tile[data-subject="${vak}"]`);
    selectVak(null);
    tile?.focus({ preventScroll: true });
  });

  // The last vak on this PC is chosen already, without animation.
  const start = tiles.find((t) => t.key === remembered && !t.disabled);
  if (start) {
    root.classList.add('login--instant');
    selectVak(start.key);
    void nextFrames().then(() => root.classList.remove('login--instant'));
  }
}
