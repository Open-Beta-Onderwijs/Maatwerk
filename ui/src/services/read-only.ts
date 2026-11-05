// SPDX-License-Identifier: AGPL-3.0-or-later

// Minimum app version (PLAN-2 decision 5). When `school.json` asks for a newer
// Maatwerk (`minAppVersion`), the backend refuses every write with the error
// code `read_only`. The app still opens, shows a banner, and a refused save
// gets this message instead of the "something unexpected" text.

export const READ_ONLY_CODE = 'read_only';

/** The banner under the tab bar while the app is read-only. */
export function readOnlyBannerText(minVersion: string, appVersion: string): string {
  return (
    `Alleen lezen: deze gegevens zijn bijgewerkt voor Maatwerk ${minVersion} of nieuwer ` +
    `(deze versie: ${appVersion}). Je kunt alles bekijken, maar niets opslaan. ` +
    `Installeer de nieuwe versie van Maatwerk.`
  );
}

/** A save that was refused because the app is read-only. */
export const READ_ONLY_SAVE_TEXT =
  'Niet opgeslagen: deze versie van Maatwerk is te oud voor deze gegevens. ' +
  'Installeer de nieuwe versie van Maatwerk.';

/**
 * The error a Store write throws when the backend refused it as read-only. Its
 * message is the Dutch text, so a screen that shows `e.message` reads well
 * (review 15 M1).
 */
export function readOnlyError(): Error & { code: string } {
  return Object.assign(new Error(READ_ONLY_SAVE_TEXT), { code: READ_ONLY_CODE });
}

// ── Read-only state of this app ────────────────────────────────────────────
// Known at start (dataFolderStatus) or from the first refused write, when a
// colleague's newer app raised the minimum while this one runs.

let readOnly = false;
let listener: (() => void) | null = null;

export function isReadOnly(): boolean {
  return readOnly;
}

/** Called by app.js: shows the banner the first time the app turns read-only. */
export function onReadOnly(fn: () => void): void {
  listener = fn;
}

/** A write was refused as read-only (or the start status said so). */
export function noteReadOnly(): void {
  if (readOnly) return;
  readOnly = true;
  listener?.();
}

/** Whether a thrown value or rejection reason is a read-only refusal. */
export function isReadOnlyError(reason: unknown): boolean {
  if (reason === READ_ONLY_CODE) return true;
  return (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { code?: unknown }).code === READ_ONLY_CODE
  );
}

/** `major.minor.patch` as numbers (a `-rc.1` or `+build` suffix ignored); null if not a version. */
export function parseVersion(version: string): [number, number, number] | null {
  const core = version.trim().replace(/^v/, '').split(/[-+]/)[0] ?? '';
  const parts = core.split('.');
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0];
}

/**
 * The `minAppVersion` of a school when `appVersion` is older than it, else null; a value that
 * is not a version also counts as newer (as `maatwerk-core::app_version::required_version`).
 */
export function requiredVersion(school: unknown, appVersion: string): string | null {
  const raw = (school as { minAppVersion?: unknown } | null)?.minAppVersion;
  if (raw === undefined || raw === null) return null;
  // Not a version string (a number, an object): refused, as in maatwerk-core.
  if (typeof raw !== 'string') return JSON.stringify(raw);
  const min = raw.trim();
  if (min === '') return null;
  const a = parseVersion(appVersion);
  const m = parseVersion(min);
  if (!a || !m) return min;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== m[i]!) return a[i]! < m[i]! ? min : null;
  }
  return null;
}
