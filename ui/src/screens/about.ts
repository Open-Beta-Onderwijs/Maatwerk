// SPDX-License-Identifier: AGPL-3.0-or-later

// "Over Maatwerk": the licence notice every user must be able to see (AGPL-3.0
// sections 0 and 5(d), "Appropriate Legal Notices"), where the source is, and
// the full licence texts. Not in the reference. Opened from the startup screen
// and from the title in the top bar.

import { escHtml, openModal, toast } from '../app.js';
import type { DataFolderStatus, MaatwerkApi } from '../bridge/api';
import { chooseAndRestart } from './choose-folder';
import { canChooseOther } from './startup-error';

export const SOURCE_URL = 'https://github.com/Open-Beta-Onderwijs/Maatwerk';
export const COPYRIGHT = 'Copyright © 2026 Open Beta Onderwijs - Matthias Kortleven';

// Loaded on demand: THIRD_PARTY_NOTICES.txt is about 0,5 MB.
const TEXTS = {
  licence: () => import('../../../LICENSE?raw'),
  notices: () => import('../../../THIRD_PARTY_NOTICES.txt?raw'),
} as const;

export function aboutHtml(version: string, build: string): string {
  return `
    <div class="about-modal">
    <p class="about-version"><strong>Maatwerk</strong> versie ${escHtml(version)} (build ${escHtml(build)})</p>
    <p>${escHtml(COPYRIGHT)}</p>
    <p>
      Maatwerk is vrije software: je mag het verspreiden en/of aanpassen onder de voorwaarden van
      de GNU Affero General Public License, versie 3 of (naar keuze) een latere versie, zoals
      gepubliceerd door de Free Software Foundation.
    </p>
    <p>
      Maatwerk wordt verspreid in de hoop dat het nuttig is, maar ZONDER ENIGE GARANTIE; zelfs
      zonder de impliciete garantie van VERKOOPBAARHEID of GESCHIKTHEID VOOR EEN BEPAALD DOEL.
      Zie de licentietekst voor details.
    </p>
    <p>Broncode: <span class="about-url">${escHtml(SOURCE_URL)}</span></p>
    <p class="small muted">
      Maatwerk bevat software, lettertypen en Typst-pakketten van derden, elk onder een eigen
      licentie (zie "Licenties van derden").
    </p>
    <h3>Gegevensmap</h3>
    <p>Map: <span class="about-url about-datadir">Laden…</span></p>
    <p class="small muted about-datasource"></p>
    <div class="about-actions">
      <button class="btn btn--secondary hidden" data-about-action="choose-folder">Andere map kiezen…</button>
    </div>
    <p class="choose-folder-status" role="status"></p>
    <h3>Probleem melden</h3>
    <p>
      Ging er iets mis? Beschrijf wat je deed en wat er gebeurde, en stuur het logbestand van
      die dag mee naar de beheerder. De logbestanden staan op deze computer, niet in de gedeelde
      map, en bevatten alleen technische meldingen.
    </p>
    <p>Map met logbestanden: <span class="about-url about-logdir">Laden…</span></p>
    <div class="about-actions">
      <button class="btn btn--secondary" data-about-action="open-logs">Map met logbestanden openen</button>
    </div>
    <div class="about-actions">
      <button class="btn btn--secondary" data-about-text="licence">Licentietekst (AGPL-3.0)</button>
      <button class="btn btn--secondary" data-about-text="notices">Licenties van derden</button>
    </div>
    <pre class="about-text hidden" tabindex="0"></pre>
    </div>`;
}

export function showAbout(): void {
  openModal({
    title: 'Over Maatwerk',
    key: 'about',
    body: aboutHtml(__MAATWERK_VERSION__, __MAATWERK_BUILD__),
    onShow: (root: HTMLElement) => wireAbout(root),
  });
}

function wireAbout(root: HTMLElement): void {
  {
    const pre = root.querySelector<HTMLPreElement>('.about-text')!;
    root.querySelectorAll<HTMLButtonElement>('[data-about-text]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const key = btn.dataset.aboutText as keyof typeof TEXTS;
        pre.textContent = 'Laden…';
        pre.classList.remove('hidden');
        try {
          pre.textContent = (await TEXTS[key]()).default;
        } catch {
          pre.textContent = 'De licentietekst kon niet worden geladen.';
        }
        pre.scrollTop = 0;
      }),
    );
    wireProblemReport(root, window.maatwerk);
    wireDataFolder(root, window.maatwerk);
  }
}

/** "Probleem melden": the log folder on this PC and a button that opens it. */
export function wireProblemReport(
  root: HTMLElement,
  api: Pick<MaatwerkApi, 'problemInfo' | 'openLogFolder'>,
): void {
  const dir = root.querySelector<HTMLElement>('.about-logdir')!;
  const open = root.querySelector<HTMLButtonElement>('[data-about-action="open-logs"]')!;
  api.problemInfo().then(
    (info) => {
      dir.textContent = info.logDir ?? 'geen (deze computer heeft geen map voor app-gegevens)';
      open.disabled = !info.logDir;
    },
    () => {
      dir.textContent = 'onbekend';
      open.disabled = true;
    },
  );
  open.addEventListener('click', () => {
    api.openLogFolder().catch(() => toast('De map kon niet worden geopend.', 'error'));
  });
}

/** Where the data folder came from, for "Over Maatwerk" (review 16 M2). */
export const SOURCE_TEXT: Record<DataFolderStatus['source'] & string, string> = {
  env: 'Ingesteld met MAATWERK_DATA_DIR.',
  dev: 'De projectmap (ontwikkelversie).',
  chosen: 'Gekozen op deze computer.',
  besideApp: 'De map data naast het programma.',
};

/**
 * "Gegevensmap": the folder in use, why, and "Andere map kiezen…" where the startup error
 * screen offers it too (a choice on this PC, or the folder beside the program). A wrong choice
 * is then visible and can be undone without deleting files by hand (review 16 M2).
 */
export function wireDataFolder(
  root: HTMLElement,
  api: Pick<MaatwerkApi, 'dataFolderStatus' | 'chooseDataFolder' | 'restartApp'>,
): void {
  const dir = root.querySelector<HTMLElement>('.about-datadir')!;
  const why = root.querySelector<HTMLElement>('.about-datasource')!;
  const choose = root.querySelector<HTMLButtonElement>('[data-about-action="choose-folder"]')!;
  const status = root.querySelector<HTMLElement>('.choose-folder-status')!;
  api.dataFolderStatus().then(
    (s) => {
      dir.textContent = s.dataDir || 'onbekend';
      why.textContent = s.source ? SOURCE_TEXT[s.source] : '';
      choose.classList.toggle('hidden', !canChooseOther(s.source ?? undefined));
    },
    () => {
      dir.textContent = 'onbekend';
    },
  );
  choose.addEventListener('click', () => {
    choose.disabled = true;
    void chooseAndRestart(api, status).then((restarting) => {
      if (!restarting) choose.disabled = false;
    });
  });
}
