// SPDX-License-Identifier: AGPL-3.0-or-later

// First run (step 16a): no data folder is set, chosen or beside the program, so the teacher
// chooses it. The choice is stored on this PC only (local-config.json), then the app restarts
// and opens the folder. A macOS .app cannot keep its data beside itself, so on a Mac this is
// how every PC starts. Not in the reference (it always used data/ beside the exe).

import type { MaatwerkApi } from '../bridge/api';

type ChooseApi = Pick<MaatwerkApi, 'chooseDataFolder' | 'restartApp'>;

export const CHOOSE_TEXT = {
  title: 'Kies de gegevensmap',
  intro:
    'Maatwerk bewaart toetsen, scores en leerlingen in een gedeelde gegevensmap, meestal in ' +
    'OneDrive of een andere map die de sectie deelt. Kies die map: de map met config.json ' +
    'erin, of de map waarin de map data staat.',
  firstUse: 'Begint de sectie net met Maatwerk? Kies dan een lege map; Maatwerk vult hem.',
  local: 'Deze keuze geldt alleen voor deze computer.',
  button: 'Map kiezen…',
  restarting: (dir: string) => `Gegevensmap: ${dir}. Maatwerk start opnieuw…`,
} as const;

/**
 * Opens the folder dialog; after a valid choice shows the folder and restarts the app. A
 * refused folder (`invalid_argument`, Dutch text from the backend) is shown under the button.
 * Exported for the startup error screen's "Andere map kiezen…".
 */
export async function chooseAndRestart(api: ChooseApi, status: HTMLElement): Promise<boolean> {
  let dir: string | null;
  try {
    dir = await api.chooseDataFolder();
  } catch (e) {
    // Not `asFolderError`: startup-error.ts imports this module.
    const err = e as { code?: unknown; message?: unknown } | null;
    const message = typeof err?.message === 'string' ? err.message : String(e);
    status.textContent =
      err?.code === 'invalid_argument' ? message : `Technische melding: ${message}`;
    status.classList.add('is-error');
    return false;
  }
  if (dir === null) return false;
  status.classList.remove('is-error');
  status.textContent = CHOOSE_TEXT.restarting(dir);
  await api.restartApp();
  return true;
}

/** Replaces the startup screen's content with the first-run folder choice. */
export function renderChooseFolder(container: HTMLElement, api: ChooseApi): void {
  const el = (tag: string, className: string, content = ''): HTMLElement => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = content;
    return node;
  };
  const box = el('section', 'startup-error choose-folder');
  box.setAttribute('aria-labelledby', 'choose-folder-title');
  const title = el('h2', 'startup-error-title', CHOOSE_TEXT.title);
  title.id = 'choose-folder-title';
  const status = el('p', 'choose-folder-status');
  status.setAttribute('role', 'status');
  const choose = el('button', 'btn btn--primary', CHOOSE_TEXT.button) as HTMLButtonElement;
  choose.type = 'button';
  choose.addEventListener('click', () => {
    choose.disabled = true;
    void chooseAndRestart(api, status).then((restarting) => {
      if (!restarting) choose.disabled = false;
    });
  });
  box.append(
    title,
    el('p', 'startup-error-advice', CHOOSE_TEXT.intro),
    el('p', 'startup-error-advice', CHOOSE_TEXT.firstUse),
    el('p', 'startup-error-detail', CHOOSE_TEXT.local),
    choose,
    status,
  );
  container.replaceChildren(box);
  choose.focus();
}
