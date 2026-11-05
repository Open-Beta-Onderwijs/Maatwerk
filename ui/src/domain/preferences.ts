// SPDX-License-Identifier: AGPL-3.0-or-later

// A teacher's own settings, stored in their user file (`gebruikers/<id>.json`)
// so they follow them to every PC (PLAN-2 decisions 3 and 15, F-18, F-21):
//
//   "preferences": { "theme": "dark", "accent": "groen", "activeYear": "2025-2026" }
//
// Additive: an app before 0.6 keeps the field when it saves the user (the
// Gebruikers form spreads the loaded record; the PIN commands edit the JSON
// object), and ignores it. Unknown or invalid values read as "not set".
// The editor divider position joins later (step 27).

import { isAccent, isTheme, type Look } from './look';

export interface Preferences {
  theme?: string;
  accent?: string;
  activeYear?: string;
}

const YEAR = /^(\d{4})-(\d{4})$/;

/** `2025-2026` with consecutive years. */
export function isSchoolYear(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = YEAR.exec(v);
  return !!m && Number(m[2]) === Number(m[1]) + 1;
}

function prefsOf(user: unknown): Record<string, unknown> {
  const p = (user as { preferences?: unknown } | null)?.preferences;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

/** The user's saved look, or null when they never chose one (both parts must be valid). */
export function savedLook(user: unknown): Look | null {
  const p = prefsOf(user);
  if (!isTheme(p.theme) && !isAccent(p.accent)) return null;
  return {
    theme: isTheme(p.theme) ? p.theme : 'light',
    accent: isAccent(p.accent) ? p.accent : 'blauw',
  };
}

/** The user's active school year, or null (then the current school year applies). */
export function savedActiveYear(user: unknown): string | null {
  const y = prefsOf(user).activeYear;
  return isSchoolYear(y) ? y : null;
}

/**
 * The user record with `patch` merged into its preferences; every other field
 * (also unknown ones from a newer app) is kept. Does not change `user`.
 */
export function withPreferences<U extends object>(user: U, patch: Preferences): U {
  const current = prefsOf(user);
  return { ...user, preferences: { ...current, ...patch } };
}
