// SPDX-License-Identifier: AGPL-3.0-or-later

// Theme and accent on <html data-theme data-accent> (design spec 2.1-2.2,
// F-18). Each teacher's choice is stored in their user file (step 15,
// domain/preferences.ts) and applied at login; the user menu changes it.
// Before login (and after logout) the base look applies: light/blauw, or in
// dev and mock builds the choice of a small dev menu (Ctrl+Alt+T, kept in
// localStorage; the visual tests use it).

import {
  ACCENTS,
  ACCENT_FILL,
  isAccent,
  isTheme,
  normaliseLook,
  type Accent,
  type Look,
} from './domain/look';
import { savedLook } from './domain/preferences';

const DEV_KEY = 'maatwerk.dev.look';

/** Token values read by cssToken; cleared when the look changes. */
const tokenCache = new Map<string, string>();

export function applyLook(look: Look, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = look.theme;
  root.dataset.accent = look.accent;
  tokenCache.clear();
  root.dispatchEvent(new CustomEvent('maatwerk:look', { detail: look }));
}

export function currentLook(root: HTMLElement = document.documentElement): Look {
  return normaliseLook({ theme: root.dataset.theme, accent: root.dataset.accent });
}

function readDevLook(): Look {
  try {
    return normaliseLook(JSON.parse(localStorage.getItem(DEV_KEY) ?? 'null'));
  } catch {
    return normaliseLook(null);
  }
}

function writeDevLook(look: Look): void {
  try {
    localStorage.setItem(DEV_KEY, JSON.stringify(look));
  } catch {
    // Storage unavailable: the choice lasts until the window closes.
  }
}

const ACCENT_LABEL = (a: Accent) => a.charAt(0).toUpperCase() + a.slice(1);

/** The dev-only theme menu: two theme buttons and the accent grid. */
function devMenu(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'dev-look';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Thema (ontwikkeling)');
  panel.hidden = true;

  const seg = document.createElement('div');
  seg.className = 'segmented';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Thema');
  for (const [theme, label] of [
    ['light', 'Licht'],
    ['dark', 'Donker'],
  ] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'segmented__opt';
    b.dataset.theme = theme;
    b.textContent = label;
    seg.append(b);
  }

  const grid = document.createElement('div');
  grid.className = 'dev-look__grid';
  for (const accent of ACCENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'accent-swatch';
    b.dataset.accentChoice = accent;
    b.setAttribute('aria-label', ACCENT_LABEL(accent));
    b.title = ACCENT_LABEL(accent);
    b.style.background = ACCENT_FILL[accent];
    grid.append(b);
  }

  const sync = () => {
    const look = currentLook();
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-pressed', String(b.dataset.theme === look.theme));
    for (const b of grid.querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-pressed', String(b.dataset.accentChoice === look.accent));
  };

  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const look = currentLook();
    if (isTheme(b.dataset.theme)) look.theme = b.dataset.theme;
    if (isAccent(b.dataset.accentChoice)) look.accent = b.dataset.accentChoice;
    applyLook(look);
    writeDevLook(look);
    sync();
  });

  panel.append(seg, grid);
  sync();
  return panel;
}

let devBuild = false;

/** The look before login: the default, or the dev menu's choice in dev and mock builds. */
export function baseLook(): Look {
  return devBuild ? readDevLook() : normaliseLook(null);
}

/**
 * The look of a teacher who logs in: their saved one, else the base look.
 * Called before the main screen is shown, so it never flashes the old look.
 */
export function applyUserLook(user: unknown): Look {
  const look = savedLook(user) ?? baseLook();
  applyLook(look);
  return look;
}

/** Sets the initial look; in dev and mock builds also installs the menu. */
export function installLook(dev: boolean): void {
  devBuild = dev;
  if (!dev) {
    applyLook(normaliseLook(null));
    return;
  }
  applyLook(readDevLook());
  const panel = devMenu();
  document.body.append(panel);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      panel.hidden = !panel.hidden;
    } else if (e.key === 'Escape' && !panel.hidden) {
      e.preventDefault(); // n8: closes the menu, not an open dialog
      panel.hidden = true;
    }
  });
}

/** Colours for text and grid lines drawn on a chart canvas (follow the theme). */
export function chartInk() {
  return {
    text: cssToken('--text'),
    muted: cssToken('--muted'),
    disabled: cssToken('--disabled'),
    grid: cssToken('--border'),
    gridMinor: cssToken('--line'),
  };
}

/** The current value of a colour token, for canvases (Chart.js) that cannot use var(). */
export function cssToken(name: string, root: HTMLElement = document.documentElement): string {
  if (root !== document.documentElement)
    return getComputedStyle(root).getPropertyValue(name).trim();
  let v = tokenCache.get(name);
  if (v === undefined) {
    v = getComputedStyle(root).getPropertyValue(name).trim();
    tokenCache.set(name, v);
  }
  return v;
}
