// SPDX-License-Identifier: AGPL-3.0-or-later

// The startup error screen (review 4b m5): when the data folder cannot be
// opened, the app shows why, where, and a retry instead of an empty app. Not
// in the reference (it started on whatever it could read).

import type { DataFolderStatus, MaatwerkApi } from '../bridge/api';

/** The status error, or a rejection of the first reads (code `unknown` when it has none). */
type FolderError = Omit<NonNullable<DataFolderStatus['error']>, 'code'> & { code: string };

export interface StartupErrorText {
  title: string;
  advice: string;
}

/**
 * The Dutch title and advice for an error from `dataFolderStatus` or the first
 * reads. A corrupt `config.json` does not get here: the schema check skips an
 * unreadable file and the compat `readJson` reads it as missing (review 6 n2).
 */
export function startupErrorText(error: FolderError): StartupErrorText {
  const title = 'Maatwerk kan de gegevensmap niet openen';
  switch (error.code) {
    case 'unsupported_schema': {
      const found = error.details.found ? ` (schemaversie ${error.details.found})` : '';
      return {
        title,
        advice:
          `Deze gegevensmap is gemaakt met een nieuwere versie van Maatwerk${found}. ` +
          'Gebruik de nieuwste versie van Maatwerk.',
      };
    }
    default:
      return {
        title,
        advice:
          'Controleer of de map bestaat, of OneDrive klaar is met synchroniseren en of je ' +
          'toegang hebt tot de map. Probeer het daarna opnieuw.',
      };
  }
}

/** Turns a rejection from the first reads into the status shape. */
export function asFolderError(e: unknown): FolderError {
  const err = e as {
    code?: unknown;
    message?: unknown;
    details?: { found?: string | null };
  } | null;
  return {
    code: typeof err?.code === 'string' ? err.code : 'unknown',
    message: typeof err?.message === 'string' ? err.message : String(e),
    details: err?.details ?? {},
  };
}

/** Replaces the startup screen's content with the message and a retry button. */
export function renderStartupError(
  container: HTMLElement,
  dataDir: string,
  error: FolderError,
  api: Pick<MaatwerkApi, 'restartApp'>,
): void {
  const text = startupErrorText(error);
  const el = (tag: string, className: string, content = ''): HTMLElement => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = content;
    return node;
  };
  const box = el('div', 'startup-error');
  box.setAttribute('role', 'alert');
  box.append(
    el('h2', 'startup-error-title', text.title),
    el('p', 'startup-error-advice', text.advice),
  );
  if (dataDir) {
    const folder = el('p', 'startup-error-folder', 'Map: ');
    folder.append(el('code', '', dataDir));
    box.append(folder);
  }
  const detail = el('p', 'startup-error-detail', `Technische melding: ${error.message}`);
  box.append(detail);
  const retry = el('button', 'btn-primary startup-error-retry', 'Opnieuw proberen');
  retry.addEventListener('click', () => {
    (retry as HTMLButtonElement).disabled = true;
    api.restartApp().catch((e: unknown) => {
      (retry as HTMLButtonElement).disabled = false;
      detail.textContent = `Technische melding: ${asFolderError(e).message}`;
    });
  });
  box.append(retry);
  container.replaceChildren(box);
}
