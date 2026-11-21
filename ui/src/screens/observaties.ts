// SPDX-License-Identifier: AGPL-3.0-or-later

// The Observaties tab as cards (design spec 4.16, board 57, F-28, PLAN-2 decision 46): three per
// row, alphabetical; a click on a card opens Observatie bewerken; ⋮ has Bewerken and Verwijderen
// (disabled with the reason when a test or a rubric uses the observatie, as before).

import {
  confirmDialog,
  getEigenOnly,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getSchoolsoortFilter,
  toast,
} from '../app.js';
import { closeCardMenu, isCardMenuOpen, showCardMenu } from '../components/card-menu';
import type { Exam, Opdracht } from '../domain/types';
import { openObsModal as openObsModalTs } from '../modals/observatie-edit';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import { countText, setFilterCount } from './cards/item-card';
import { obsUsedInRubric, toetstypeFilterChip } from './observatie-toetstype';
import { obsCardHtml, obsDeleteBlock, obsUse, type ObsFields } from './observaties/card';
import { filterObservaties, type ObsFilters } from './observaties/filter';

/** Observatie bewerken (modals/observatie-edit.ts); the list re-renders after a save. */
export function openObsModal(existingId: string | null): void {
  openObsModalTs(existingId, () => void renderObservaties());
}

type OwnGroup = NonNullable<ObsFilters['ownGroups']>[number] & { docenten?: string[] };

function ownGroups(): OwnGroup[] | null {
  const user = Store.getActiveUser();
  if (!getEigenOnly() || !user || Store.isAdminActive()) return null;
  const year = Store.getConfigSync().activeYear;
  return (Store.getGroupsSync(year) as OwnGroup[]).filter((g) =>
    (g.docenten ?? []).includes(user.id),
  );
}

function deleteReason(id: string): string | null {
  return obsDeleteBlock(Store.obsIsUsedInAnyExam(id), obsUsedInRubric(id));
}

async function deleteObs(id: string): Promise<void> {
  if (!(await confirmDialog('Observatie verwijderen?', { okLabel: 'Verwijderen', danger: true })))
    return;
  await Store.deleteObservation(id);
  toast('Observatie verwijderd.', 'info');
  void renderObservaties();
}

function toggleMenu(btn: HTMLElement): void {
  if (isCardMenuOpen(btn)) {
    closeCardMenu();
    return;
  }
  const id = btn.dataset.id ?? '';
  void showCardMenu(btn, [
    { icon: ICONS.pen, label: 'Bewerken', run: () => openObsModal(id) },
    'sep',
    {
      icon: ICONS.trash,
      label: 'Verwijderen',
      danger: true,
      disabled: deleteReason(id),
      run: () => deleteObs(id),
    },
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
      if (action.dataset.action === 'obs-menu') toggleMenu(action);
      else if (action.dataset.action === 'edit-obs') openObsModal(action.dataset.id ?? null);
      return;
    }
    // A click anywhere else on a card opens Observatie bewerken, not on a text selection.
    const card = target.closest<HTMLElement>('[data-obs-card]');
    if (!card || target.closest('a, button, input') || window.getSelection()?.toString()) return;
    openObsModal(card.dataset.obsCard ?? null);
  });
}

export async function renderObservaties(): Promise<void> {
  const container = document.getElementById('obs-list')!;
  document.getElementById('btn-add-obs')!.onclick = () => openObsModal(null);
  // Toetstype filter (F-23): Alle toetstypes / Toets / PO.
  const chip = toetstypeFilterChip(() => void renderObservaties());
  const row = document.getElementById('filter-row-observaties');
  if (row && !row.contains(chip.element)) row.prepend(chip.element);
  wireList(container);

  // The use counts read this year's tests and the opdrachten.
  const year: string = Store.getConfigSync().activeYear;
  const [exams, opdrachten] = (await Promise.all([
    Store.getExams(year),
    Store.getOpdrachten(),
  ])) as [Exam[], Opdracht[]];
  const obs = filterObservaties(Store.getObservatiesSync() as ObsFields[], {
    toetstype: chip.value(),
    subject: Store.getActiveSubject(),
    schoolsoort: getSchoolsoortFilter(),
    jaarlagen: getJaarlagFilter(),
    jaarlagenKlas: getJaarlagKlasFilter(),
    ownGroups: ownGroups(),
  });
  setFilterCount('filter-row-observaties', countText(obs.length, 'observatie', 'observaties'));

  if (obs.length === 0) {
    container.innerHTML =
      '<p class="hint">Nog geen observaties. Klik "+ Observatie toevoegen" om te beginnen.</p>';
    return;
  }
  const useOf = obsUse(exams ?? [], opdrachten ?? []);
  container.innerHTML = `<div class="igrid">${obs.map((o) => obsCardHtml(o, useOf(o.id))).join('')}</div>`;
}
