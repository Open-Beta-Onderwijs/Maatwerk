// SPDX-License-Identifier: AGPL-3.0-or-later

// The RTTI uitleg and leeradvies texts per jaarlaag (`templates/rtti/`, C11), opened from the
// Toetsen screen. Moved out of modals/rapport.js (step 24, R-05).

import {
  toast,
  openModal,
  closeModal,
  escHtml,
  guardModalClose,
  requestCloseModal,
} from '../app.js';
import { GRADE_BAR } from '../domain/grade-colors';
import { setBusy } from '../components/button';
import { defaultTabData, rttiExplFilePath, type AdviesData } from '../domain/rapport';

interface Tab {
  label: string;
  fileKey: string;
  jaar: number;
}

type Bracket = 'laag' | 'midden' | 'hoog';

/** An element of the dialog that is always there (built by buildTabHtml). */
function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  return root.querySelector(selector) as T;
}
import { Store } from '../store.js';

const RTTI_CATS = ['R', 'T1', 'T2', 'I'] as const;

const RTTI_PLACEHOLDERS: Record<(typeof RTTI_CATS)[number], Record<'uitleg' | Bracket, string>> = {
  R: {
    uitleg:
      'Bijvoorbeeld: Reproductievragen zijn vragen die je kunt beantwoorden door de tekst in het boek en de aantekeningen te leren en goed op te letten in de les.',
    laag: 'Bijvoorbeeld: Je hebt veel punten laten liggen op Reproductie. Maak tijdens de les nauwkeurigere aantekeningen en leer deze goed voor de volgende toets. Neem ook het boek nog een keer extra door. Zet hem op!',
    midden:
      "Bijvoorbeeld: Je laat nog wat punten liggen op Reproductie. Leer voor de volgende toets goed de aantekeningen en neem het boek nog eens door. Let's go!",
    hoog: 'Bijvoorbeeld: Je hebt goed gescoord op Reproductie! Ga zo door met de aantekeningen en het bestuderen van de tekst!',
  },
  T1: {
    uitleg:
      'Bijvoorbeeld: Toepassen-1-vragen zijn vragen die erg lijken op de huiswerkopgaven, maar dan bijvoorbeeld met andere getallen. Je oefent door het huiswerk bij te houden.',
    laag: 'Bijvoorbeeld: Je hebt veel punten laten liggen op Toepassen 1. Zorg dat je het huiswerk bijhoudt en oefen de standaardopgaven goed. Je kunt het!',
    midden:
      'Bijvoorbeeld: Je laat nog wat punten liggen op Toepassen 1. Maak de oefenopgaven zorgvuldig en controleer je antwoorden. Tandje erbij!',
    hoog: 'Bijvoorbeeld: Je hebt goed gescoord op Toepassen 1! Lekker blijven oefenen!',
  },
  T2: {
    uitleg:
      'Bijvoorbeeld: Toepassen-2-vragen zijn lastigere vragen waarvoor je iets dat je hebt geleerd in een nieuwe context toe moet passen of twee dingen die je hebt geleerd samen moet gebruiken om een oplossing te vinden. Je oefent doordat je veel oefenopgaven maakt, zodat je je de stof echt eigen hebt gemaakt.',
    laag: 'Bijvoorbeeld: Je hebt veel punten laten liggen op Toepassen 2. Maak extra oefenopgaven en probeer de stof vanuit verschillende invalshoeken te bekijken. Ga ervoor!',
    midden:
      'Bijvoorbeeld: Je laat nog wat punten liggen op Toepassen 2. Oefen met gevarieerde opgaven om de stof echt eigen te maken. Ga ervoor!',
    hoog: 'Bijvoorbeeld: Je hebt goed gescoord op Toepassen 2! Lekker bezig en scherp blijven!',
  },
  I: {
    uitleg:
      'Bijvoorbeeld: Inzichtvragen zijn lastige vragen in een nieuwe context, die je alleen kunt beantwoorden als je echt begrepen hebt hoe de stof werkt. Vaak kun je de vraag pas plaatsen nadat je uitvoerig met de stof hebt geoefend en goed hebt opgelet in de les.',
    laag: 'Bijvoorbeeld: Je hebt veel punten laten liggen op Inzicht. Let extra goed op in de les en probeer te begrijpen waarom dingen werken zoals ze werken. Je kunt meer dan je denkt!',
    midden:
      'Bijvoorbeeld: Je laat nog wat punten liggen op Inzicht. Probeer verbanden te leggen tussen de verschillende onderdelen van de stof. Goed bezig!',
    hoog: 'Bijvoorbeeld: Je hebt goed gescoord op Inzicht! Dat laat zien dat je de stof echt begrijpt. Ga zo door!',
  },
};

function buildTabs(subject: string): Tab[] {
  if (subject === 'wi') {
    return [
      { label: '1', fileKey: 'wi', jaar: 1 },
      { label: '2', fileKey: 'wi', jaar: 2 },
      { label: '3', fileKey: 'wi', jaar: 3 },
      { label: 'A4', fileKey: 'wisa', jaar: 4 },
      { label: 'A5', fileKey: 'wisa', jaar: 5 },
      { label: 'A6', fileKey: 'wisa', jaar: 6 },
      { label: 'B4', fileKey: 'wisb', jaar: 4 },
      { label: 'B5', fileKey: 'wisb', jaar: 5 },
      { label: 'B6', fileKey: 'wisb', jaar: 6 },
      { label: 'C4', fileKey: 'wisc', jaar: 4 },
      { label: 'C5', fileKey: 'wisc', jaar: 5 },
      { label: 'C6', fileKey: 'wisc', jaar: 6 },
      { label: 'D4', fileKey: 'wisd', jaar: 4 },
      { label: 'D5', fileKey: 'wisd', jaar: 5 },
      { label: 'D6', fileKey: 'wisd', jaar: 6 },
    ];
  }
  return [1, 2, 3, 4, 5, 6].map((j) => ({ label: String(j), fileKey: subject, jaar: j }));
}

function buildTabHtml(data: AdviesData, tabs: Tab[], activeTab: number): string {
  function copyBtnHtml(block: string): string {
    const targets = tabs
      .map((t, i) =>
        i !== activeTab ? `<button class="tog-btn" data-copy-tab="${i}">${t.label}</button>` : '',
      )
      .join('');
    return `
      <div class="rtti-copy-wrap">
        <button class="btn btn--secondary btn--sm" data-copy-open="${block}">Kopi\u00ebren naar\u2026</button>
        <div class="rtti-copy-popover hidden" data-copy-popover="${block}">
          <div class="rtti-copy-tab-grid">${targets}</div>
          <button class="btn btn--primary btn--sm" data-copy-confirm="${block}">Kopi\u00ebren</button>
        </div>
      </div>`;
  }

  const uitlegRows = RTTI_CATS.map(
    (cat) => `
    <tr>
      <td>${cat}</td>
      <td><textarea rows="3" data-uitleg="${cat}" placeholder="${RTTI_PLACEHOLDERS[cat].uitleg}">${escHtml(data.uitleg[cat])}</textarea></td>
    </tr>`,
  ).join('');

  const adviesRows = RTTI_CATS.filter((cat) => cat !== 'I')
    .map(
      (cat) => `
    <tr>
      <td>${cat}</td>
      <td><textarea rows="5" data-adv="${cat}-laag" placeholder="${RTTI_PLACEHOLDERS[cat].laag}">${escHtml(data.leeradvies[cat]?.laag)}</textarea></td>
      <td><textarea rows="5" data-adv="${cat}-midden" placeholder="${RTTI_PLACEHOLDERS[cat].midden}">${escHtml(data.leeradvies[cat]?.midden)}</textarea></td>
      <td><textarea rows="5" data-adv="${cat}-hoog" placeholder="${RTTI_PLACEHOLDERS[cat].hoog}">${escHtml(data.leeradvies[cat]?.hoog)}</textarea></td>
    </tr>`,
    )
    .join('');

  const sliderRows = RTTI_CATS.filter((cat) => cat !== 'I')
    .map((cat) => {
      const low = data.grenswaarden[cat]!.laag_midden;
      const high = data.grenswaarden[cat]!.midden_hoog;
      return `
    <div class="slider-row">
      <span class="slider-row-cat">${cat}</span>
      <div class="dual-slider-wrap" data-slider-group="${cat}">
        <div class="dual-slider-track" data-slider-track="${cat}"></div>
        <input type="range" min="0" max="100" step="5" value="${low}" data-slider="${cat}-low">
        <input type="range" min="0" max="100" step="5" value="${high}" data-slider="${cat}-high">
      </div>
      <span class="slider-labels" data-slider-labels="${cat}">${low}% / ${high}%</span>
    </div>`;
    })
    .join('');

  return `
    <div class="rtti-uitleg-section-header">
      <h4 class="rtti-uitleg-section-title">Uitleg RTTI-categorieën</h4>
      ${copyBtnHtml('uitleg')}
    </div>
    <p class="rtti-uitleg-hint">Geef hieronder aan wat de uitleg van de verschillende RTTI-categorieën voor de leerlingen is. Deze uitleg wordt ook geprint op de toetsanalyseformulieren.</p>
    <table class="rtti-uitleg-table">
      <thead><tr><th>Cat.</th><th>Tekst</th></tr></thead>
      <tbody>${uitlegRows}</tbody>
    </table>

    <div class="rtti-uitleg-section-header">
      <h4 class="rtti-uitleg-section-title">Leeradvies RTTI-categorieën</h4>
      ${copyBtnHtml('leeradvies')}
    </div>
    <p class="rtti-uitleg-hint">Geef hieronder aan wat de tekst bij de leeradviezen per RTTI-categorie is bij verschillende scoregroepen. Bij lage scores is het advies waarschijnlijk anders dan bij hoge scores.</p>
    <table class="rtti-uitleg-table">
      <thead><tr><th>Cat.</th><th>Lage score</th><th>Middelmatige score</th><th>Hoge score</th></tr></thead>
      <tbody>${adviesRows}</tbody>
    </table>

    <div class="rtti-uitleg-section-header">
      <h4 class="rtti-uitleg-section-title">Grenswaarden leeradvies</h4>
      ${copyBtnHtml('grenswaarden')}
    </div>
    <p class="rtti-uitleg-hint">Geef hieronder aan vanaf welke score de bovenstaande leeradviezen aan een leerling moeten worden gegeven. Beide grenswaarden worden op dezelfde slider aangegeven.</p>
    ${sliderRows}
  `;
}

function updateSliderTrack(track: HTMLElement, labels: HTMLElement, low: number, high: number) {
  // Three-zone gradient: danger (low) → warning (mid) → success (high)
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  track.style.background = `linear-gradient(to right,
    ${GRADE_BAR.fail} 0%, ${GRADE_BAR.fail} ${lo}%,
    ${GRADE_BAR.passLow} ${lo}%, ${GRADE_BAR.passLow} ${hi}%,
    ${GRADE_BAR.passHigh} ${hi}%, ${GRADE_BAR.passHigh} 100%)`;
  labels.textContent = `${lo}% / ${hi}%`;
}

function initDualSliders(el: HTMLElement) {
  for (const cat of RTTI_CATS.filter((c) => c !== 'I')) {
    const lowInput = q<HTMLInputElement>(el, `[data-slider="${cat}-low"]`);
    const highInput = q<HTMLInputElement>(el, `[data-slider="${cat}-high"]`);
    const track = q(el, `[data-slider-track="${cat}"]`);
    const labels = q(el, `[data-slider-labels="${cat}"]`);

    updateSliderTrack(track, labels, Number(lowInput.value), Number(highInput.value));

    lowInput.addEventListener('input', () => {
      updateSliderTrack(track, labels, Number(lowInput.value), Number(highInput.value));
    });
    highInput.addEventListener('input', () => {
      updateSliderTrack(track, labels, Number(lowInput.value), Number(highInput.value));
    });
  }
}

export async function openRttiUitlegModal() {
  const subject = (Store.getActiveSubject() as string | null) ?? 'nat';
  const tabs = buildTabs(subject);

  // Each tab remembers the version it was loaded from, so saving cannot
  // overwrite a change another teacher made meanwhile (ADR-0003 C6). An
  // unreadable file shows the defaults and then conflicts on save.
  const tabData: Record<number, AdviesData> = {};
  const tabHash: Record<number, string> = {};
  const tabSaved: Record<number, string | null> = {}; // JSON of the version on disk, to skip unchanged tabs

  await Promise.all(
    tabs.map(async (t, i) => {
      const relPath = rttiExplFilePath(t.fileKey, t.jaar);
      try {
        const { data, hash } = (await Store.loadVersioned(relPath)) as {
          data: AdviesData | null;
          hash: string;
        };
        tabData[i] = data ?? defaultTabData();
        tabHash[i] = hash;
        tabSaved[i] = data ? JSON.stringify(data) : null;
      } catch {
        tabData[i] = defaultTabData();
        tabHash[i] = 'onleesbaar';
      }
    }),
  );

  let activeTab = 0;

  let selectTab: ((idx: number) => void) | null = null; // set in onShow; the dialog calls onTab on open
  openModal({
    title: 'Leerlingrapport RTTI uitleg en leeradvies',
    key: 'rtti-uitleg',
    size: 'lg',
    fixedHeight: true,
    tabs: tabs.map((t, i) => ({ id: String(i), label: t.label })),
    onTab: (id: string) => selectTab?.(Number(id)),
    body: '<div id="rtti-uitleg-tab-content"></div>',
    footerHtml: `
      <button class="btn btn--secondary" id="btn-rtti-uitleg-cancel">Annuleren</button>
      <button class="btn btn--primary" id="btn-rtti-uitleg-save">Opslaan</button>`,
    onShow: (el: HTMLElement) => {
      let _dirty = false;

      function markDirty() {
        _dirty = true;
      }

      // Unsaved changes: the shared close guard (✕, Escape, backdrop and
      // Annuleren all ask first; U14).
      guardModalClose(() => _dirty);

      function renderTab(idx: number) {
        q(el, '#rtti-uitleg-tab-content').innerHTML = buildTabHtml(tabData[idx]!, tabs, idx);
        initDualSliders(el);
        initCopyButtons(el, idx);
        // Mark dirty on any input change
        q(el, '#rtti-uitleg-tab-content').addEventListener('input', markDirty);
      }

      function initCopyButtons(el: HTMLElement, srcIdx: number) {
        for (const block of ['uitleg', 'leeradvies', 'grenswaarden']) {
          const openBtn = q(el, `[data-copy-open="${block}"]`);
          const popover = q(el, `[data-copy-popover="${block}"]`);
          const confirmBtn = q(el, `[data-copy-confirm="${block}"]`);

          openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other popovers first
            el.querySelectorAll('.rtti-copy-popover').forEach((p) => {
              if (p !== popover) p.classList.add('hidden');
            });
            popover.classList.toggle('hidden');
          });

          confirmBtn.addEventListener('click', () => {
            readCurrentTabIntoData(srcIdx);
            const selected = [...popover.querySelectorAll<HTMLElement>('.tog-btn.selected')].map(
              (b) => Number(b.dataset.copyTab),
            );
            for (const destIdx of selected) {
              const dest = tabData[destIdx]!;
              const src = tabData[srcIdx]!;
              if (block === 'uitleg') {
                dest.uitleg = structuredClone(src.uitleg);
              } else if (block === 'leeradvies') {
                dest.leeradvies = structuredClone(src.leeradvies);
              } else {
                dest.grenswaarden = structuredClone(src.grenswaarden);
              }
            }
            // Deselect all and close
            popover.querySelectorAll('.tog-btn').forEach((b) => b.classList.remove('selected'));
            popover.classList.add('hidden');
            if (selected.length > 0) {
              toast(
                `${block === 'uitleg' ? 'Uitleg' : block === 'leeradvies' ? 'Leeradvies' : 'Grenswaarden'} gekopieerd naar ${selected.length} tab${selected.length > 1 ? 's' : ''}.`,
                'success',
              );
            }
          });

          // Toggle selection on tab buttons
          popover.querySelectorAll('.tog-btn[data-copy-tab]').forEach((b) => {
            b.addEventListener('click', () => b.classList.toggle('selected'));
          });
        }

        // Close popovers when clicking outside
        q(el, '#rtti-uitleg-tab-content').addEventListener('click', (e) => {
          if (!(e.target as Element).closest('.rtti-copy-wrap')) {
            el.querySelectorAll('.rtti-copy-popover').forEach((p) => p.classList.add('hidden'));
          }
        });
      }

      function readCurrentTabIntoData(idx: number) {
        const content = q(el, '#rtti-uitleg-tab-content');
        const value = (selector: string) => q<HTMLInputElement>(content, selector).value;
        const data = tabData[idx]!;
        for (const cat of RTTI_CATS) {
          data.uitleg[cat] = value(`[data-uitleg="${cat}"]`);
          if (cat !== 'I') {
            for (const score of ['laag', 'midden', 'hoog'] as const) {
              data.leeradvies[cat]![score] = value(`[data-adv="${cat}-${score}"]`);
            }
            data.grenswaarden[cat]!.laag_midden = Number(value(`[data-slider="${cat}-low"]`));
            data.grenswaarden[cat]!.midden_hoog = Number(value(`[data-slider="${cat}-high"]`));
          }
        }
      }

      selectTab = (idx) => {
        readCurrentTabIntoData(activeTab);
        activeTab = idx;
        renderTab(activeTab);
      };

      q(el, '#btn-rtti-uitleg-cancel').addEventListener('click', () => requestCloseModal());

      q(el, '#btn-rtti-uitleg-save').addEventListener('click', async () => {
        readCurrentTabIntoData(activeTab);
        const saveBtn = q<HTMLButtonElement>(el, '#btn-rtti-uitleg-save');
        setBusy(saveBtn, true);
        // Unchanged tabs whose file exists are skipped, so they cannot conflict.
        // A missing file is still written, as in the reference: the rapport
        // falls back from a missing variant file to the subject file.
        const results = await Promise.allSettled(
          tabs.map(async (t, i) => {
            const json = JSON.stringify(tabData[i]);
            if (tabSaved[i] !== null && tabSaved[i] === json) return;
            const relPath = rttiExplFilePath(t.fileKey, t.jaar);
            tabHash[i] = (await Store.saveVersioned(relPath, tabData[i], tabHash[i])) as string;
            tabSaved[i] = json;
          }),
        );
        setBusy(saveBtn, false);
        const failed = tabs.filter((_, i) => results[i]!.status === 'rejected');
        if (failed.length === 0) {
          _dirty = false;
          toast('RTTI uitleg en leeradvies opgeslagen.', 'success');
          closeModal();
        } else if (
          results.some(
            (r) => r.status === 'rejected' && (r.reason as { code?: string })?.code === 'conflict',
          )
        ) {
          const names = failed.map((t) => `tabblad ${t.label}`).join(', ');
          toast(
            `Niet opgeslagen: ${names}. Iemand anders heeft dit intussen gewijzigd ` +
              '(of het bestand is onleesbaar). De andere tabbladen zijn wel opgeslagen. ' +
              'Sluit het venster en open het opnieuw om de nieuwste versie te zien.',
            'error',
          );
        } else {
          toast('Fout bij opslaan. Controleer de logbestanden.', 'error');
        }
      });

      renderTab(0);
    },
  });
}
