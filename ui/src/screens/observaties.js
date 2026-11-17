// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICONS } from '../utils/icons.js';
import {
  toast,
  escHtml,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
  confirmDialog,
} from '../app.js';
import { obsToetstypes } from '../domain/rubric';
import { obsUsedInRubric, toetstypeFilterChip } from './observatie-toetstype';
import { openObsModal as openObsModalTs } from '../modals/observatie-edit';

/** Observatie bewerken (modals/observatie-edit.ts); the list re-renders after a save. */
export function openObsModal(existingId) {
  openObsModalTs(existingId, renderObservaties);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Observaties
// ═══════════════════════════════════════════════════════════════════════════════

export function renderObservaties() {
  let obs = Store.getObservatiesSync();
  const container = document.getElementById('obs-list');
  document.getElementById('btn-add-obs').onclick = () => openObsModal(null);
  // Toetstype filter (F-23): Alle toetstypes / Toets / PO.
  const chip = toetstypeFilterChip(renderObservaties);
  const row = document.getElementById('filter-row-observaties');
  if (row && !row.contains(chip.element)) row.prepend(chip.element);
  if (chip.value() !== 'alle') obs = obs.filter((o) => obsToetstypes(o).includes(chip.value()));

  const activeSubject = Store.getActiveSubject();
  const schoolsoortFilter = getSchoolsoortFilter();
  const jaarlagFilter = getJaarlagFilter();
  const jaarlagKlasFilter = getJaarlagKlasFilter();
  const eigenOnly = getEigenOnly();
  const activeUser = Store.getActiveUser();

  // Schoolsoort filter — always applied; obs without schoolsoort always pass
  obs = obs.filter(
    (o) =>
      !(o.schoolsoort ?? []).length ||
      (o.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss)),
  );

  // Jaarlaag filter
  if (activeSubject === 'wi') {
    // Klas 1-6 filter
    obs = obs.filter(
      (o) =>
        !(o.jaarlagen ?? []).length ||
        (o.jaarlagen ?? []).some((jl) => jaarlagKlasFilter.has(String(jl))),
    );
    // Subcategory filter: OB covers jaarlaag 1-3; any WisX covers jaarlaag 4-6
    const allowedJl = new Set();
    if (jaarlagFilter.has('OB')) {
      allowedJl.add('1');
      allowedJl.add('2');
      allowedJl.add('3');
    }
    if (
      jaarlagFilter.has('WisA') ||
      jaarlagFilter.has('WisB') ||
      jaarlagFilter.has('WisC') ||
      jaarlagFilter.has('WisD')
    ) {
      allowedJl.add('4');
      allowedJl.add('5');
      allowedJl.add('6');
    }
    obs = obs.filter(
      (o) =>
        !(o.jaarlagen ?? []).length || (o.jaarlagen ?? []).some((jl) => allowedJl.has(String(jl))),
    );
  } else {
    obs = obs.filter(
      (o) =>
        !(o.jaarlagen ?? []).length ||
        (o.jaarlagen ?? []).some((jl) => jaarlagFilter.has(String(jl))),
    );
  }

  // Eigen filter: obs must be relevant to at least one of teacher's groups
  if (eigenOnly && activeUser && !Store.isAdminActive()) {
    const cfg = Store.getConfigSync();
    const myGroups = Store.getGroupsSync(cfg.activeYear).filter((g) =>
      (g.docenten ?? []).includes(activeUser.id),
    );
    obs = obs.filter((o) =>
      myGroups.some(
        (g) =>
          (o.subjects ?? []).includes(g.subject) &&
          (o.schoolsoort ?? []).some((ss) => (g.schoolsoort ?? []).includes(ss)) &&
          (o.jaarlagen ?? []).map(String).includes(String(g.jaarlaag)),
      ),
    );
  }

  if (obs.length === 0) {
    container.innerHTML =
      '<p class="hint">Nog geen observaties. Klik "+ Observatie toevoegen" om te beginnen.</p>';
    return;
  }

  obs.sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));

  container.innerHTML = obs
    .map(
      (o) => `
    <div class="card">
      <div class="card-main">
        <div class="student-card-row">
          <span class="obs-card-icon">${escHtml(o.icon)}</span>
          <strong class="obs-card-naam">${escHtml(o.naam)}</strong>${obsToetstypes(o).includes('po') ? `<span class="obs-toetstype-badge" title="Toetstype">${obsToetstypes(o).includes('toets') ? 'Toets + PO' : 'PO'}</span>` : ''}
        </div>
        <span class="muted">${escHtml(o.uitleg)}</span>
        <span class="small">Schoolsoort: ${escHtml((o.schoolsoort ?? []).join(', ')) || '—'} &nbsp;·&nbsp; Jaarlagen: ${escHtml((o.jaarlagen ?? []).join(', ')) || '—'}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn--icon" data-action="edit-obs" data-id="${escHtml(o.id)}" title="Observatie bewerken">${ICONS.pen}</button>
        <button class="btn btn--icon btn--icon-danger" data-action="del-obs" data-id="${escHtml(o.id)}"${Store.obsIsUsedInAnyExam(o.id) ? ' disabled title="Deze observatie is gekoppeld aan een toets en kan dus niet worden verwijderd."' : obsUsedInRubric(o.id) ? ' disabled title="Deze observatie staat in een rubric en kan dus niet worden verwijderd."' : ' title="Observatie verwijderen"'}>${ICONS.trash}</button>
      </div>
    </div>`,
    )
    .join('');

  container
    .querySelectorAll('[data-action="edit-obs"]')
    .forEach((b) => b.addEventListener('click', () => openObsModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="del-obs"]')
    .forEach((b) => b.addEventListener('click', () => deleteObs(b.dataset.id)));
}

export async function deleteObs(id) {
  if (!(await confirmDialog('Observatie verwijderen?', { okLabel: 'Verwijderen', danger: true })))
    return;
  await Store.deleteObservation(id);
  toast('Observatie verwijderd.', 'info');
  renderObservaties();
}
