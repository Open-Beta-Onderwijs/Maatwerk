// SPDX-License-Identifier: AGPL-3.0-or-later

// The Opdrachten tab as cards (design spec 4.17, board 58, F-28, PLAN-2 decision 47): three per
// row, sorted by lowest jaarlaag, then name. ⋮ has Openen in de editor, Bewerken, Kopiëren,
// Afdrukken (the 0.23.1 print) and Verwijderen. A click on a card opens the editor until the
// preview panel arrives (step 34b).

import {
  confirmDialog,
  getAdminSubjectFilter,
  getObservatieFilter,
  getSchoolsoortFilter,
  matchesJaarlaagFilter,
  openEditor,
  setObservatieFilterOptions,
  toast,
} from '../app.js';
import { closeCardMenu, isCardMenuOpen, showCardMenu } from '../components/card-menu';
import type { Observatie } from '../domain/types';
import { openOpdrachtModal } from '../modals/opdracht-edit';
import { openOpdrachtPrintModal } from '../modals/opdracht-print';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import { countText, setFilterCount } from './cards/item-card';
import { compareOpdrachten, opdCardHtml, type OpdFields } from './opdrachten/card';

/** Opdracht bewerken (modals/opdracht-edit.ts); the list re-renders after a save. */
function openOpdrachtenModal(existingId: string | null): void {
  void openOpdrachtModal(existingId, () => void renderOpdrachten());
}

function opdracht(id: string): OpdFields | undefined {
  return (Store.getOpdrachtenSync() as OpdFields[]).find((o) => o.id === id);
}

function openInEditor(id: string): void {
  const o = opdracht(id);
  if (o) openEditor(o);
}

async function copyOpdracht(id: string): Promise<void> {
  try {
    const copy = await Store.copyOpdracht(id);
    toast(`Opdracht gekopieerd als "${copy.naam}".`, 'success');
    void renderOpdrachten();
  } catch (e) {
    toast(`Kopiëren mislukt: ${(e as Error).message}`, 'error');
  }
}

async function deleteOpdracht(id: string): Promise<void> {
  const ok = await confirmDialog(
    'Opdracht verwijderen? Dit verwijdert ook het bijbehorende Typst-bestand.',
    { okLabel: 'Verwijderen', danger: true },
  );
  if (!ok) return;
  await Store.deleteOpdracht(id);
  toast('Opdracht verwijderd.', 'info');
  void renderOpdrachten();
}

function toggleMenu(btn: HTMLElement): void {
  if (isCardMenuOpen(btn)) {
    closeCardMenu();
    return;
  }
  const id = btn.dataset.id ?? '';
  void showCardMenu(btn, [
    { icon: ICONS.editor, label: 'Openen in de editor', run: () => openInEditor(id) },
    { icon: ICONS.pen, label: 'Bewerken', run: () => openOpdrachtenModal(id) },
    { icon: ICONS.copy, label: 'Kopiëren', run: () => copyOpdracht(id) },
    {
      icon: ICONS.print,
      label: 'Afdrukken',
      run: () => {
        const o = opdracht(id);
        if (o) openOpdrachtPrintModal(o);
      },
    },
    'sep',
    { icon: ICONS.trash, label: 'Verwijderen', danger: true, run: () => deleteOpdracht(id) },
  ]);
}

/** One listener for the whole list (it is redrawn often). */
function wireList(container: HTMLElement): void {
  if (container.dataset.wired) return;
  container.dataset.wired = '1';
  container.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    const action = target.closest<HTMLElement>('[data-action]');
    if (action && container.contains(action)) {
      if (action.dataset.action === 'opd-menu') toggleMenu(action);
      else if (action.dataset.action === 'open-editor') openInEditor(action.dataset.id ?? '');
      return;
    }
    const card = target.closest<HTMLElement>('[data-opd-card]');
    if (!card || target.closest('a, button, input') || window.getSelection()?.toString()) return;
    openInEditor(card.dataset.opdCard ?? '');
  });
}

export async function renderOpdrachten(): Promise<void> {
  const container = document.getElementById('opdracht-list')!;
  document.getElementById('btn-add-opdracht')!.onclick = () => openOpdrachtenModal(null);
  wireList(container);

  const [, allObsRaw] = (await Promise.all([
    Store.getOpdrachten(),
    window.maatwerk.readAllJson('observaties'),
  ])) as [unknown, (Observatie & { schoolsoort?: string[]; jaarlagen?: unknown[] })[] | null];
  const allOpdrachten = Store.getOpdrachtenSync() as OpdFields[];
  const allObs = (allObsRaw ?? []).filter((o) => o && o.id);

  // ── Filters ────────────────────────────────────────────────────────────────
  // Items without schoolsoort / jaarlagen / vakken always pass that filter.
  const schoolsoortFilter: Set<string> = getSchoolsoortFilter();
  const adminSubject: string | null = getAdminSubjectFilter();
  const matchesSchoolsoort = (item: { schoolsoort?: string[] }) =>
    !(item.schoolsoort ?? []).length ||
    (item.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss));
  const matchesVak = (o: OpdFields) =>
    !adminSubject ||
    !(o.vakken ?? []).length ||
    (o.vakken ?? []).some((v) =>
      adminSubject === 'wi' ? v.startsWith('wis') : v === adminSubject,
    );

  // Observatie filter options: observaties matching the current schoolsoort + jaarlagen
  const obsOptions = allObs
    .filter((obs) => matchesSchoolsoort(obs) && matchesJaarlaagFilter(obs.jaarlagen))
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));
  setObservatieFilterOptions(obsOptions);
  const obsFilter: Set<string> | null = getObservatieFilter();

  const opdrachten = allOpdrachten
    .filter(
      (o) =>
        matchesSchoolsoort(o) &&
        matchesJaarlaagFilter(o.jaarlagen) &&
        matchesVak(o) &&
        (!obsFilter || (o.observaties ?? []).some((id) => obsFilter.has(id))),
    )
    .sort(compareOpdrachten);
  setFilterCount('filter-row-opdrachten', countText(opdrachten.length, 'opdracht', 'opdrachten'));

  if (opdrachten.length === 0) {
    container.innerHTML = allOpdrachten.length
      ? '<p class="hint">Geen opdrachten gevonden voor de huidige filters.</p>'
      : '<p class="hint">Nog geen opdrachten. Klik "+ Opdracht toevoegen" om te beginnen.</p>';
    return;
  }
  const obsById = new Map(allObs.map((o) => [o.id, o]));
  container.innerHTML = `<div class="igrid">${opdrachten.map((o) => opdCardHtml(o, obsById)).join('')}</div>`;
}
