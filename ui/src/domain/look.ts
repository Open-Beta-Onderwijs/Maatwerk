// SPDX-License-Identifier: AGPL-3.0-or-later

// Theme and accent values (design spec 2.1-2.2, F-18), without the DOM. The
// tokens in styles/tokens.css switch on <html data-theme data-accent>
// (ui/src/theme.ts).

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Fill colours (spec 2.2); the full token set is in styles/tokens.css. */
export const ACCENT_FILL = {
  rood: '#c93636',
  oranje: '#c2540f',
  geel: '#e5ae0b',
  groen: '#24804e',
  blauw: '#2f6fd6',
  indigo: '#4f46c8',
  paars: '#8a3fc2',
  koraal: '#c8492f',
  koper: '#ae611c',
  oker: '#9a6a12',
  mint: '#13866e',
  turquoise: '#0f7f86',
  leisteen: '#4a5568',
  roze: '#c2387a',
  bordeaux: '#8e2340',
  bruin: '#8b5a2b',
  olijf: '#5a7a12',
  bos: '#1e5e3a',
  marine: '#1f3a93',
  zwart: '#111418',
  magenta: '#a3248f',
} as const;

/** The 7x3 grid of the user menu: the rainbow, then two rows of neighbours. */
export const ACCENTS = Object.keys(ACCENT_FILL) as (keyof typeof ACCENT_FILL)[];
export type Accent = keyof typeof ACCENT_FILL;

export const DEFAULT_THEME: Theme = 'light';
export const DEFAULT_ACCENT: Accent = 'blauw';

export interface Look {
  theme: Theme;
  accent: Accent;
}

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

export function isAccent(v: unknown): v is Accent {
  return typeof v === 'string' && (ACCENTS as readonly string[]).includes(v);
}

/** Unknown values fall back to the defaults (light, blauw). */
export function normaliseLook(v: unknown): Look {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    theme: isTheme(o.theme) ? o.theme : DEFAULT_THEME,
    accent: isAccent(o.accent) ? o.accent : DEFAULT_ACCENT,
  };
}
