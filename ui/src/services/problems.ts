// SPDX-License-Identifier: AGPL-3.0-or-later

// Unexpected failures (PLAN Step 10): an error the UI did not handle goes to
// the log file through the bridge, and the teacher sees one Dutch message that
// points to "Over Maatwerk > Probleem melden" (screens/about.ts), which shows
// where the log files are. Save conflicts have their own handler in app.js.

import type { MaatwerkApi } from '../bridge/api';

export const UNEXPECTED_TEXT =
  'Er ging iets onverwachts mis. Probeer het opnieuw; blijft het misgaan, kies dan ' +
  'Over Maatwerk (de titel linksboven) > Probleem melden.';

/** Browser noise that is not a failure of the app. */
const IGNORED = [/ResizeObserver loop/];

/** The text to log for an error or rejection reason: message and stack, no data. */
export function errorText(reason: unknown): string {
  if (reason instanceof Error) {
    const stack = reason.stack ?? '';
    return stack.includes(reason.message) ? stack : `${reason.name}: ${reason.message}\n${stack}`;
  }
  if (reason && typeof reason === 'object') {
    const { code, message } = reason as { code?: unknown; message?: unknown };
    if (typeof code === 'string' || typeof message === 'string')
      return `${String(code ?? 'error')}: ${String(message ?? '')}`;
  }
  return String(reason);
}

/**
 * Removes student data from a logged text (review 10 m5): score files are named after the
 * leerlingnummer (`<year>/scores/<vak>/<id>.json`) and photos after the student.
 */
export function redact(text: string): string {
  return text
    .replace(/(scores[\\/][^\\/\s"'`]+[\\/])[^\\/\s"'`]+/g, '$1<leerling>')
    .replace(/(fotos[\\/])[^\\/"'`\n]+?\.(png|jpe?g|gif|svg|webp)\b/gi, '$1<foto>');
}

/** Logs `reason` and shows the message, unless it is noise or a save conflict. */
export function reportUnexpected(
  api: Pick<MaatwerkApi, 'logUiError'>,
  show: (message: string) => void,
  kind: 'error' | 'rejection',
  reason: unknown,
): boolean {
  if ((reason as { code?: unknown } | null)?.code === 'conflict') return false;
  const text = errorText(reason);
  if (IGNORED.some((re) => re.test(text))) return false;
  api.logUiError(`${kind}: ${redact(text)}`).catch(() => {});
  show(UNEXPECTED_TEXT);
  return true;
}

/** Installs the window handlers; `show` displays the message (persistentError). */
export function installErrorReporting(
  api: Pick<MaatwerkApi, 'logUiError'>,
  show: (message: string) => void,
  target: Window = window,
): void {
  target.addEventListener('error', (e) =>
    reportUnexpected(api, show, 'error', e.error ?? e.message),
  );
  target.addEventListener('unhandledrejection', (e) =>
    reportUnexpected(api, show, 'rejection', e.reason),
  );
}
