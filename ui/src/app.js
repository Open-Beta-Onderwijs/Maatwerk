// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * app.js — Renderer process entry point.
 * Shared services (modal, toast, nav, SEL) + orchestration of all screens.
 * CSP: NO inline event handlers. All cancel buttons use data-close-modal="1".
 */

// ── Screen imports ────────────────────────────────────────────────────────────
import { renderStartup } from './screens/startup.js';
import { asFolderError, renderStartupError } from './screens/startup-error';
import { renderMigration } from './screens/migration';
import { watchTopbar } from './shell/topbar-fit';
import { renderChooseFolder } from './screens/choose-folder';
import { renderLeerlingen, renderStudentList, leerlingenState } from './screens/leerlingen.js';
import { renderGroepen, renderGroepenForYear } from './screens/groepen.js';
import { renderToetsen, renderToetsenList } from './screens/toetsen';
import { renderObservaties } from './screens/observaties.js';
import { renderRubrics } from './screens/rubrics';
import { renderOpdrachten } from './screens/opdrachten.js';
import { openEditor } from './modals/editor.js';
import { renderGebruikers } from './screens/gebruikers.js';
import { renderSchool } from './screens/school.js';
import { needsAttention, renderGegevens } from './screens/gegevens';
import { changePinFlow, renewCodesFlow } from './screens/pin';
import { closeUserMenu, toggleUserMenu } from './components/user-menu';
import { renderInstellingen } from './screens/instellingen';
import { avatarHtml, loadAvatarPhotos, renderAvatar } from './components/avatar';
import * as Sync from './sync.js';
import * as Presence from './presence.js';
import { applyStyleData } from './legacy/style-data';
import { showAbout } from './screens/about';
import { afterPaint, perfSpan } from './utils/perf';
import { alertDialog, confirmDialog, openDialog } from './components/dialog';
import {
  READ_ONLY_SAVE_TEXT,
  isReadOnlyError,
  noteReadOnly,
  onReadOnly,
} from './services/read-only';
import { showReadOnlyBanner } from './components/read-only-banner';
import { applyLook, baseLook, currentLook } from './theme';
import {
  filterBar,
  filterGeneration,
  initFilterBar,
  resetFilterBar,
  updateEigenLabel,
} from './shell/filter-bar.js';
export {
  getAdminSubjectFilter,
  getEigenOnly,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getObservatieFilter,
  getSchoolsoortFilter,
  matchesJaarlaagFilter,
  setObservatieFilterOptions,
} from './shell/filter-bar.js';

// ── Navigation ────────────────────────────────────────────────────────────────
const topbar = document.getElementById('topbar');
// On a narrow window the wordmark makes way for the tabs (user 2026-11-10).
watchTopbar();
const screens = {};
document.querySelectorAll('.screen').forEach((el) => {
  screens[el.id.replace('screen-', '')] = el;
});
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
});

export function navigateTo(name) {
  document.querySelectorAll('.nav-btn').forEach((b) => {
    const on = b.dataset.screen === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  if (name === 'startup') {
    topbar.classList.add('hidden');
  } else {
    topbar.classList.remove('hidden');
  }
  // Gray out admin vakken filter on leerlingen (doesn't apply there)
  const adminFilterDisabled = Store.isAdminActive() && name === 'leerlingen';
  document
    .getElementById('admin-vak-wrap')
    ?.classList.toggle('admin-filter-disabled', adminFilterDisabled);

  // Sync eigen button label for the new screen
  updateEigenLabel(name);

  // Opdrachten: replace the eigen toggle with the observatie filter
  document
    .getElementById('obs-filter-wrap')
    .classList.toggle('filter-screen-hidden', name !== 'opdrachten');
  // Rubrics: shared per vak, not per group, so no eigen toggle either.
  document
    .getElementById('btn-filter-eigen')
    .classList.toggle('filter-screen-hidden', name === 'opdrachten' || name === 'rubrics');

  _screenRefreshPending = false;
  if (screens[name]) {
    const end = perfSpan(`tab:${name}`);
    if (needsRender(name)) {
      // Render content (may be async; screen shows immediately).
      void Promise.resolve(renderScreen(name)).finally(() => afterPaint().then(end));
    } else {
      void afterPaint().then(end);
    }
    screens[name].classList.add('active');
    window.scrollTo(0, 0);
    const targetRow = document.getElementById(`filter-row-${name}`);
    if (targetRow) targetRow.appendChild(filterBar);
  }
}

// ── Kept screens (Step 7c) ────────────────────────────────────────────────────
// A list screen keeps its DOM between visits and is rendered again only when
// what it shows may have changed: cached data (Store.generation: own writes and
// colleagues' changes), the filter bar, or who is logged in. The other screens
// (forms, checks, the startup screen) render on every visit, as before.
const KEPT_SCREENS = new Set([
  'leerlingen',
  'groepen',
  'toetsen',
  'rubrics',
  'observaties',
  'opdrachten',
  'gebruikers',
]);
const _renderedAs = {}; // screen -> view key of its last render

function viewKey() {
  const user = Store.getActiveUser();
  return JSON.stringify([
    Store.generation(),
    filterGeneration(),
    user?.id ?? null,
    Store.getActiveRole(),
    Store.getActiveSubject(),
  ]);
}

function needsRender(name) {
  return !KEPT_SCREENS.has(name) || _renderedAs[name] !== viewKey();
}

export function renderScreen(name) {
  // Taken before rendering: a change while an async render runs renders again next visit.
  _renderedAs[name] = viewKey();
  switch (name) {
    case 'startup':
      return renderStartup();
    case 'leerlingen':
      return renderLeerlingen();
    case 'groepen':
      return renderGroepen();
    case 'toetsen':
      return renderToetsen();
    case 'rubrics':
      return renderRubrics();
    case 'observaties':
      return renderObservaties();
    case 'opdrachten':
      return renderOpdrachten();
    case 'gebruikers':
      return renderGebruikers();
    case 'school':
      return renderSchool();
    case 'gegevens':
      return renderGegevens(
        document.getElementById('screen-gegevens'),
        window.maatwerk,
        confirmDialog,
        (path) => {
          // Own writes are not echoed by the watcher (review 7b M2).
          Store.forgetFile(path);
          toast('Hersteld uit de snapshot.', 'success');
        },
      );
    case 'instellingen':
      return renderInstellingen(
        document.getElementById('screen-instellingen'),
        window.maatwerk,
        Store,
        toast,
      );
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// Every modal is a dialog (components/dialog.ts), opened through openModal().
// The helpers below act on the current modal: the top one opened that way
// (confirms and notices do not count).

/** Open the full-screen Typst editor for an assignment. Imported from modals/editor.js. */
export { openEditor };
export { confirmDialog, alertDialog };

/** Modals opened through openModal, bottom first. */
let _modals = [];

function currentModal() {
  return _modals[_modals.length - 1] ?? null;
}

/** True while any modal is open. */
export function modalOpen() {
  return _modals.length > 0;
}

/**
 * Structured modal (see DialogOptions in components/dialog.ts); stacks on
 * whatever is open, except that it replaces a current modal with the same
 * `key` (a refresh re-opens the modal in place).
 */
export function openModal({ onShow, ...opts }) {
  const prev = currentModal();
  // U15: the replaced modal closes properly (cleanups, charts, its onClose).
  if (opts.key && prev?.key === opts.key) prev.close();
  const d = openDialog({
    ...opts,
    onClose: () => {
      _modals = _modals.filter((m) => m !== d);
      opts.onClose?.();
      if (_screenRefreshPending && !_modals.length) scheduleScreenRefresh();
      // The modal underneath is on top again: deliver what it missed.
      queueMicrotask(flushHeldSync);
    },
  });
  _modals.push(d);
  // Before any measuring (charts): see src/legacy/style-data.ts.
  applyStyleData(d.el);
  // After the push, so guardModalClose/onModalSync inside act on this modal.
  onShow?.(d.el, d);
  return d;
}

/** Close the current modal without its guard (after saving, Annuleren). */
export function closeModal() {
  currentModal()?.close();
}

/** Close the current modal through its close guard (like ✕). */
export function requestCloseModal() {
  return currentModal()?.requestClose() ?? Promise.resolve(false);
}

/** Register a Chart.js instance to be destroyed when the current modal closes. */
export function pushModalChart(chart) {
  const d = currentModal();
  const destroy = () => {
    try {
      chart.destroy();
    } catch (_) {}
  };
  if (d) d.onCleanup(destroy);
  else destroy();
}

// ── Unsaved changes ───────────────────────────────────────────────────────────
// A modal with a form registers guardModalClose(isDirty); closing it with ✕,
// Escape or a click next to it then asks for confirmation while isDirty() is
// true. Annuleren and closing after saving (closeModal()) are not guarded.

/** `text`: optional `{ message, title, okLabel }` instead of the unsaved-changes question. */
export function guardModalClose(isDirty, text = null) {
  currentModal()?.setGuard(isDirty, text);
}

/**
 * The state of every form control in `root` as a string, to compare against a
 * snapshot taken when the modal opened: input values, toggle buttons
 * (.selected / data-checked) and CustomSelect labels.
 */
export function formSnapshot(root) {
  const parts = [];
  root.querySelectorAll('input, textarea, select').forEach((f) => {
    parts.push(f.type === 'checkbox' || f.type === 'radio' ? f.checked : f.value);
  });
  root.querySelectorAll('button').forEach((b) => {
    parts.push(`${b.classList.contains('selected')}${b.dataset.checked ?? ''}`);
  });
  root.querySelectorAll('.csel-trigger').forEach((t) => parts.push(t.textContent));
  return JSON.stringify(parts);
}

// ── Background changes while a modal is open ──────────────────────────────────
// Subscriptions made with onModalSync() end automatically when the modal closes
// or is replaced by another one, so modals never react to changes after they
// are gone.

// Background changes for a modal that has another modal stacked on it (a
// profile over a group overview) wait until it is on top again. Its handlers
// may show a reload notice whose OK closes or re-opens "the current modal";
// that must be this one, not the one on top of it (review 14 M1).
const _heldSync = new Map(); // Dialog -> [() => void]

function flushHeldSync() {
  const top = currentModal();
  const held = top && _heldSync.get(top);
  if (!held) return;
  _heldSync.delete(top);
  held.forEach((run) => run());
}

/** Subscribe to background changes of `type` for as long as the current modal is open. */
export function onModalSync(type, handler) {
  const d = currentModal();
  if (!d) return;
  const off = Sync.on(type, (ev) => {
    if (!d.isOpen) return;
    if (currentModal() === d) return handler(ev);
    if (!_heldSync.has(d)) _heldSync.set(d, []);
    _heldSync.get(d).push(() => handler(ev));
  });
  d.onCleanup(() => {
    off();
    _heldSync.delete(d);
  });
}

/** Run fn when the current modal closes or is replaced by another one. */
export function onModalCleanup(fn) {
  const d = currentModal();
  if (d) d.onCleanup(fn);
  else fn();
}

/**
 * Returns a function that runs `reopen` (re-running the modal's open function)
 * at most once per `ms`, keeping the modal's scroll position. Does nothing if
 * the modal has been closed or replaced in the meantime; waits while another
 * modal is stacked on it. Used for modals that
 * only display data, so they can refresh silently.
 */
export function modalRefresher(reopen, ms = 500) {
  const d = currentModal();
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(async function run() {
      if (!d?.isOpen) return;
      // Covered by a stacked modal (a profile over a group overview) or a
      // notice: try again once it is on top.
      if (currentModal() !== d || document.getElementById('reload-notice')) {
        timer = setTimeout(run, ms);
        return;
      }
      const y = d.body.scrollTop;
      await reopen();
      const now = currentModal();
      if (now) now.body.scrollTop = y;
    }, ms);
  };
}

/** Full name of the user who made a background change, or 'een collega' if unknown. */
export async function changedByName(ev) {
  const id = ev.meta?.updatedBy ?? ev.after?._meta?.updatedBy;
  const user = id ? (await Store.loadUsers()).find((u) => u.id === id) : null;
  return user ? Store.fullName(user) : 'een collega';
}

/**
 * Blocking notice on top of an open modal whose data changed in the background.
 * OK calls onOk (typically: close and reopen the modal). Only one notice is
 * shown at a time; the reload that follows picks up any later changes too.
 */
export function showReloadNotice(message, onOk) {
  if (document.getElementById('reload-notice')) return;
  const d = openDialog({
    role: 'alertdialog',
    size: 'sm',
    className: 'dlg--confirm',
    dialogId: 'reload-notice',
    closeButton: false,
    backdropCloses: false,
    dismissible: false, // only OK: the modal underneath must be reloaded first
    body: `<h2 class="dlg-confirm-title">Gewijzigd door een collega</h2>
      <p class="dlg-confirm-msg">${escHtml(message)}</p>`,
    footer: [
      {
        label: 'OK',
        variant: 'primary',
        id: 'ok',
        onClick: async (dlg) => {
          dlg.close();
          await onOk?.();
        },
      },
    ],
  });
  // No Escape: the modal underneath must be reloaded first.
  d.el.addEventListener('keydown', (e) => e.stopPropagation());
  d.el.querySelector('[data-action="ok"]').focus();
}

// ── Notifications ─────────────────────────────────────────────────────────────
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

export function persistentError(message) {
  const container = document.getElementById('toast-container');
  for (const existing of container.querySelectorAll('.toast-persistent')) {
    if (existing.dataset.msg === message) return;
  }
  const el = document.createElement('div');
  el.className = 'toast toast-error toast-persistent show';
  el.dataset.msg = message;
  el.innerHTML = `<span>${escHtml(message)}</span><button class="toast-dismiss">✕</button>`;
  el.querySelector('.toast-dismiss').addEventListener('click', () => el.remove());
  container.appendChild(el);
}

// ── Shared utilities ──────────────────────────────────────────────────────────
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── CustomSelect instances (created once at init, reused every render) ─────────
/** @type {Record<string, any>} */
export const SEL = {}; // populated by initSelects(); exported as live object

// F-21: the school year chosen on any screen is the teacher's active year, on
// every screen and (saved in their user file) on every PC.
function chooseYear(year) {
  for (const sel of [SEL.studentYear, SEL.groupsYear, SEL.toetsenYear]) {
    if (sel.getValue() !== year) sel.setValue(year);
  }
  leerlingenState.year = year;
  if (Store.getActiveUser() && Store.getConfigSync().activeYear !== year) {
    void Store.savePreferences({ activeYear: year });
  }
}

/** After logout: the next teacher starts in their own active year. */
function forgetYear() {
  for (const sel of [SEL.studentYear, SEL.groupsYear, SEL.toetsenYear]) sel?.setValue(null);
  leerlingenState.year = null;
}

function initSelects() {
  SEL.studentYear = new CustomSelect(document.getElementById('student-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: async (v) => {
      chooseYear(v);
      void window.maatwerk.setWatchYear(v);
      await Store.loadYear(v);
      leerlingenState.year = v;
      renderStudentList();
    },
  });
  SEL.groupsYear = new CustomSelect(document.getElementById('groups-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: async (v) => {
      chooseYear(v);
      void window.maatwerk.setWatchYear(v);
      await Store.loadYear(v);
      renderGroepenForYear(v);
    },
  });
  SEL.toetsenYear = new CustomSelect(document.getElementById('toetsen-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: async (v) => {
      chooseYear(v);
      void window.maatwerk.setWatchYear(v);
      await Store.loadYear(v);
      void Store.preloadScores(v).catch(() => {}); // before the statistics (Step 7c)
      renderToetsenList();
    },
  });
}

// ── User badge (topbar) ───────────────────────────────────────────────────────
document.getElementById('btn-about').addEventListener('click', showAbout);

const userBadgeBtn = document.getElementById('user-badge-btn');
const readPhoto = (rel) => window.maatwerk.readPhotoAsDataUrl(rel);

export async function showUserBadge(user, subject) {
  const role = Store.getActiveRole();
  // Spec 3.6: 38 px, accent ring; square for the admin and a sectievoorzitter login.
  userBadgeBtn.dataset.userId = user.id;
  void renderAvatar(
    userBadgeBtn,
    user,
    { size: 38, ring: 'accent', square: user.isAdmin || !!role },
    readPhoto,
  );
  userBadgeBtn.title = `${Store.fullName(user)}${role ? ` (${roleLabel(role)})` : ''}: gebruikersmenu`;
  userBadgeBtn.setAttribute('aria-label', 'Gebruikersmenu');
  userBadgeBtn.classList.remove('hidden');

  // Admin sees vakken popover; teacher sees eigen toggle
  document.getElementById('admin-vak-wrap').classList.toggle('hidden', !user.isAdmin);
  document.getElementById('btn-filter-eigen').classList.toggle('hidden', user.isAdmin);

  await initFilterBar(user, subject);
  applyRoleVisibility(user);
  Presence.start(user.id);
  if (user.isAdmin) void checkDataInBackground();
}

// validate-data at start (Step 7a, C19): the admin hears about files changed
// outside Maatwerk and broken data without having to look. Never blocks.
async function checkDataInBackground() {
  try {
    const check = await window.maatwerk.validateDataFolder();
    if (!needsAttention(check)) return;
    const changed = check.issues.filter((i) => i.kind === 'stamp').length;
    const errors = check.issues.filter((i) => i.severity === 'error').length;
    const parts = [
      changed
        ? `${changed} ${changed === 1 ? 'bestand' : 'bestanden'} buiten Maatwerk gewijzigd`
        : '',
      errors ? `${errors} ${errors === 1 ? 'fout' : 'fouten'}` : '',
    ].filter(Boolean);
    persistentError(`Gegevenscontrole: ${parts.join(', ')}. Zie het tabblad Gegevenscontrole.`);
  } catch (e) {
    console.warn('[gegevens]', e);
  }
}

function applyRoleVisibility(user) {
  const adminOnly = ['gebruikers', 'school', 'gegevens', 'instellingen'];
  // Rubrics: teachers and sectievoorzitters, not the admin (decision 25).
  const teacherOnly = ['toetsen', 'rubrics', 'observaties'];
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    const screen = btn.dataset.screen;
    if (user.isAdmin) {
      btn.classList.toggle('hidden', teacherOnly.includes(screen));
    } else {
      btn.classList.toggle('hidden', adminOnly.includes(screen));
    }
  });
}

function roleLabel(role) {
  return role?.voorzitter
    ? `Sectievoorzitter ${Store.SUBJECT_DISPLAY[role.voorzitter] ?? role.voorzitter}`
    : '';
}

/** The line under the name in the user menu (spec 3.6). */
function menuSubtitle(user, role) {
  if (role) return roleLabel(role);
  if (user.isAdmin) return 'Beheerder';
  const vak = Store.getActiveSubject();
  return vak ? `Docent · ${Store.SUBJECT_DISPLAY[vak] ?? vak}` : 'Docent';
}

// F-17: the avatar opens the user menu (look, PIN, uitloggen).
userBadgeBtn.addEventListener('click', () => {
  const user = Store.getActiveUser();
  if (!user) return;
  const role = Store.getActiveRole();
  const api = window.maatwerk;
  const onUserChanged = (saved) => Store.cacheUser(saved);
  toggleUserMenu({
    anchor: userBadgeBtn,
    user,
    name: Store.fullName(user),
    subtitle: menuSubtitle(user, role),
    square: user.isAdmin || !!role,
    look: currentLook(),
    // Applied at once; saved in the teacher's own file (F-18, decision 3).
    onLook: (look) => {
      applyLook(look);
      void Store.savePreferences({ theme: look.theme, accent: look.accent });
    },
    onChangePin: () => void changePinFlow(api, onUserChanged),
    onRenewCodes: user.isAdmin ? () => void renewCodesFlow(user, api, onUserChanged) : undefined,
    onLogout: () => {
      void api.logout().catch((e) => console.warn('[pin]', e));
      logOut();
    },
    readPhoto,
  });
});

function logOut() {
  closeUserMenu();
  Presence.stop();
  userBadgeBtn.classList.add('hidden');
  userBadgeBtn.replaceChildren();
  delete userBadgeBtn.dataset.userId;
  delete userBadgeBtn.dataset.avatarFoto;
  forgetYear();
  applyLook(baseLook());
  resetFilterBar();
  navigateTo('startup');
}

// ── Watermerk ─────────────────────────────────────────────────────────────────
async function applyWatermerk() {
  const dataUrl = await window.maatwerk.readPhotoAsDataUrl('afbeeldingen/school-watermerk.svg');
  if (dataUrl) document.documentElement.style.setProperty('--watermerk-url', `url("${dataUrl}")`);
}

// ── Save conflicts ────────────────────────────────────────────────────────────
// Store throws { code: 'conflict' } when saving something another teacher changed
// after it was opened here. The save is aborted, so the open modal stays as it is.
window.addEventListener('unhandledrejection', async (e) => {
  if (e.reason?.code !== 'conflict') return;
  e.preventDefault();
  const users = await Store.loadUsers();
  const other = users.find((u) => u.id === e.reason.updatedBy);
  const door = other ? ` door ${Store.fullName(other)}` : '';
  persistentError(
    `Niet opgeslagen: dit is intussen${door} gewijzigd. Sluit het venster en open het opnieuw.`,
  );
});

// A save refused because school.json asks for a newer app (PLAN-2 decision 5).
window.addEventListener('unhandledrejection', (e) => {
  if (!isReadOnlyError(e.reason)) return;
  e.preventDefault();
  noteReadOnly();
  persistentError(READ_ONLY_SAVE_TEXT);
});

// The banner, also when a colleague's newer app raised the minimum while this
// app runs (review 15 M1): the start status has the versions.
onReadOnly(async () => {
  try {
    const status = await window.maatwerk.dataFolderStatus();
    showReadOnlyBanner(status.readOnly ?? '?', status.appVersion);
  } catch (e) {
    console.warn('[read-only]', e);
  }
});

// ── Background changes (other teachers) ──────────────────────────────────────
// The visible list is redrawn when data it shows changes in the background.
// Filters, the selected year and the scroll position are kept. While a modal or
// an exam menu is open the redraw waits, so nothing moves under the user's hands.
// The school screen is left alone: it is edited inline.
const SCREEN_REFRESH = {
  leerlingen: {
    types: ['students', 'group'],
    year: () => leerlingenState.year,
    render: () => renderStudentList({ staged: false }),
  },
  groepen: {
    types: ['group', 'students', 'exam', 'scores'],
    year: () => SEL.groupsYear.getValue(),
    render: () => renderGroepenForYear(SEL.groupsYear.getValue()),
  },
  toetsen: {
    types: ['exam', 'scores', 'group'],
    year: () => SEL.toetsenYear.getValue(),
    render: () => renderToetsenList(),
  },
  // An exam change can change a rubric's use (step 22 writes `rubric_id`).
  rubrics: { types: ['rubric', 'observatie', 'exam'], render: () => renderRubrics() },
  observaties: {
    types: ['observatie', 'group', 'rubric'],
    year: () => Store.getConfigSync().activeYear,
    render: () => renderObservaties(),
  },
  opdrachten: { types: ['opdracht', 'observatie'], render: () => renderOpdrachten() },
  gebruikers: { types: ['gebruikers'], render: () => renderGebruikers() },
};

const SCREEN_REFRESH_DELAY_MS = 750;
let _screenRefreshPending = false;
let _screenRefreshTimer = null;

function activeScreenName() {
  return document.querySelector('.screen.active')?.id.replace('screen-', '') ?? null;
}

function scheduleScreenRefresh() {
  _screenRefreshPending = true;
  clearTimeout(_screenRefreshTimer);
  _screenRefreshTimer = setTimeout(runScreenRefresh, SCREEN_REFRESH_DELAY_MS);
}

async function runScreenRefresh() {
  _screenRefreshTimer = null;
  if (!_screenRefreshPending) return;
  if (modalOpen()) return; // closing the last modal picks it up
  if (document.querySelector('.exam-menu')) {
    _screenRefreshTimer = setTimeout(runScreenRefresh, 2000);
    return;
  }
  _screenRefreshPending = false;
  const name = activeScreenName();
  const cfg = SCREEN_REFRESH[name];
  if (!cfg) return;
  const pageScroller = document.scrollingElement;
  const pageY = pageScroller.scrollTop;
  const screenY = screens[name].scrollTop;
  _renderedAs[name] = viewKey();
  await cfg.render();
  pageScroller.scrollTop = pageY;
  screens[name].scrollTop = screenY;
}

Sync.on('*', (ev) => {
  const cfg = SCREEN_REFRESH[activeScreenName()];
  if (!cfg || !cfg.types.includes(ev.type)) return;
  const shownYear = cfg.year?.();
  if (ev.year && shownYear && ev.year !== shownYear) return;
  const subject = Store.getActiveSubject();
  if (ev.subject && subject && ev.subject !== subject) return;
  scheduleScreenRefresh();
});

// ── "Nieuwe toets" popover ────────────────────────────────────────────────────
// A colleague added an exam in the active subject and year: show who added
// what in a card at the top right. It stays until it is clicked.
Sync.on('exam', (ev) => {
  if (ev.kind !== 'added' || !ev.after || !ev.inScope) return;
  const me = Store.getActiveUser();
  if (!me || ev.after._meta?.createdBy === me.id) return;
  showExamAddedNotice(ev.after, ev.year);
});

async function showExamAddedNotice(exam, year) {
  const creatorId = exam._meta?.createdBy;
  const creator = creatorId ? (await Store.loadUsers()).find((u) => u.id === creatorId) : null;
  let container = document.getElementById('bg-notices');
  if (!container) {
    container = document.createElement('div');
    container.id = 'bg-notices';
    document.body.appendChild(container);
  }
  const schoolsoort = (exam.schoolsoort ?? []).join(' / ');
  const details = [
    `Klas ${exam.jaarlaag}${schoolsoort ? ` ${schoolsoort}` : ''}`,
    exam.periode ? `periode ${exam.periode}` : null,
    year,
  ]
    .filter(Boolean)
    .join(' · ');
  const card = document.createElement('div');
  card.className = 'bg-notice';
  card.setAttribute('role', 'status');
  card.title = 'Klik om te sluiten';
  card.innerHTML = `
    ${avatarHtml(creator ?? {}, { size: 30, className: 'bg-notice-avatar' })}
    <div class="bg-notice-body">
      <div class="bg-notice-title">Nieuwe toets toegevoegd</div>
      <div class="bg-notice-exam">${escHtml(exam.title)}</div>
      <div class="bg-notice-meta">${escHtml(details)}</div>
      <div class="bg-notice-meta">door ${escHtml(creator ? Store.fullName(creator) : 'een collega')}</div>
    </div>
    <button class="bg-notice-close" aria-label="Melding sluiten">✕</button>`;
  card.addEventListener('click', () => card.remove());
  container.appendChild(card);
  void loadAvatarPhotos(card, readPhoto);
}

Sync.start();

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // An unusable data folder gets its own screen instead of an empty app (review 4b m5).
  const container = document.getElementById('screen-startup');
  let status;
  try {
    status = await window.maatwerk.dataFolderStatus();
    if (!status.error) await Store.preload();
  } catch (e) {
    status = { dataDir: status?.dataDir ?? '', source: status?.source, error: asFolderError(e) };
  }
  if (status.error?.code === 'no_data_folder') {
    // First run on this PC (step 16a): choose the shared data folder.
    renderChooseFolder(container, window.maatwerk);
    return;
  }
  if (status.error?.code === 'needs_migration') {
    // A v1 folder: offer the one-time conversion (ADR-0003 C1).
    renderMigration(container, status.dataDir, window.maatwerk);
    return;
  }
  if (status.error) {
    console.error('[startup]', status.error.code, status.error.message);
    renderStartupError(container, status.dataDir, status.error, window.maatwerk, status.source);
    return;
  }
  // An older app on data that needs a newer one: read-only, with a banner.
  if (status.readOnly) noteReadOnly();
  applyWatermerk();
  initSelects();
  navigateTo('startup');
}

init();
