// SPDX-License-Identifier: AGPL-3.0-or-later

// A teacher's own settings, stored in their user file (`gebruikers/<id>.json`)
// so they follow them to every PC (PLAN-2 decisions 3 and 15, F-18, F-21):
//
//   "preferences": { "theme": "dark", "accent": "groen", "activeYear": "2025-2026" }
//
// Additive: an app before 0.6 keeps the field when it saves the user (the
// Gebruikers form spreads the loaded record; the PIN commands edit the JSON
// object), and ignores it. Unknown or invalid values read as "not set".
// The editor divider position (`editorSplit`: the editor's share of the width, 0,25-0,75) joined
// in step 31 (F-16); the AI panel's width in pixels (`aiPanelWidth`, 380 or more) after step 32.

import { isAccent, isTheme, type Look } from './look';

export interface Preferences {
  theme?: string;
  accent?: string;
  activeYear?: string;
  editorSplit?: number;
  aiPanelWidth?: number;
}

/** The editor divider's range and default (spec 4.8). */
export const EDITOR_SPLIT = { min: 0.25, max: 0.75, initial: 0.5 } as const;

/** `v` within the divider's range, to two decimals. */
export function clampEditorSplit(v: number): number {
  const c = Math.min(EDITOR_SPLIT.max, Math.max(EDITOR_SPLIT.min, v));
  return Math.round(c * 100) / 100;
}

/** The user's saved editor divider position, or null (then 50%). */
export function savedEditorSplit(user: unknown): number | null {
  const v = prefsOf(user).editorSplit;
  return typeof v === 'number' && Number.isFinite(v) ? clampEditorSplit(v) : null;
}

/** The AI panel's width in px (board 59: 380 px, the minimum; wider by dragging its edge). */
export const AI_PANEL_WIDTH = { min: 380, max: 1200, initial: 380 } as const;

/** `v` within the panel's range, in whole pixels. */
export function clampAiPanelWidth(v: number): number {
  return Math.round(Math.min(AI_PANEL_WIDTH.max, Math.max(AI_PANEL_WIDTH.min, v)));
}

/** The user's saved AI panel width, or null (then 380 px). */
export function savedAiPanelWidth(user: unknown): number | null {
  const v = prefsOf(user).aiPanelWidth;
  return typeof v === 'number' && Number.isFinite(v) ? clampAiPanelWidth(v) : null;
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

/** The user's saved look, or null when neither part is valid; a missing part takes its default. */
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
