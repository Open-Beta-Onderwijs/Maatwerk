// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  toast,
  escHtml,
  getSchoolsoortFilter,
  matchesJaarlaagFilter,
  getAdminSubjectFilter,
  getObservatieFilter,
  setObservatieFilterOptions,
  openEditor,
  confirmDialog,
} from '../app.js';
import { ICONS } from '../utils/icons.js';
import { openOpdrachtModal } from '../modals/opdracht-edit';
import { openOpdrachtPrintModal } from '../modals/opdracht-print';
import { VAK_CHIPS } from '../modals/obs-opd-fields';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Opdrachten
// ═══════════════════════════════════════════════════════════════════════════════

const SUBJECT_LABEL = Object.fromEntries(VAK_CHIPS);

/** Opdracht bewerken (modals/opdracht-edit.ts); the list re-renders after a save. */
function openOpdrachtenModal(existingId) {
  void openOpdrachtModal(existingId, renderOpdrachten);
}

export async function renderOpdrachten() {
  const container = document.getElementById('opdracht-list');
  document.getElementById('btn-add-opdracht').onclick = () => openOpdrachtenModal(null);

  const [, allObsRaw] = await Promise.all([
    Store.getOpdrachten(),
    window.maatwerk.readAllJson('observaties'),
  ]);
  const allOpdrachten = Store.getOpdrachtenSync();
  const _allObsForCards = (allObsRaw ?? []).filter((o) => o && o.id);

  // ── Filters ────────────────────────────────────────────────────────────────
  // Items without schoolsoort / jaarlagen / vakken always pass that filter.
  const schoolsoortFilter = getSchoolsoortFilter();
  const adminSubject = getAdminSubjectFilter();
  const matchesSchoolsoort = (item) =>
    !(item.schoolsoort ?? []).length || item.schoolsoort.some((ss) => schoolsoortFilter.has(ss));
  const matchesVak = (o) =>
    !adminSubject ||
    !(o.vakken ?? []).length ||
    o.vakken.some((v) => (adminSubject === 'wi' ? v.startsWith('wis') : v === adminSubject));

  // Observatie filter options: observaties matching the current schoolsoort + jaarlagen
  const obsOptions = _allObsForCards
    .filter((obs) => matchesSchoolsoort(obs) && matchesJaarlaagFilter(obs.jaarlagen))
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));
  setObservatieFilterOptions(obsOptions);
  const obsFilter = getObservatieFilter();

  let opdrachten = allOpdrachten.filter(
    (o) =>
      matchesSchoolsoort(o) &&
      matchesJaarlaagFilter(o.jaarlagen) &&
      matchesVak(o) &&
      (!obsFilter || (o.observaties ?? []).some((id) => obsFilter.has(id))),
  );

  // ── Sort: min(jaarlagen) asc, then naam alpha ──────────────────────────────
  opdrachten = [...opdrachten].sort((a, b) => {
    const aJl = Math.min(...(a.jaarlagen?.length ? a.jaarlagen : [Infinity]));
    const bJl = Math.min(...(b.jaarlagen?.length ? b.jaarlagen : [Infinity]));
    if (aJl !== bJl) return aJl - bJl;
    return (a.naam ?? '').localeCompare(b.naam ?? '', 'nl');
  });

  if (opdrachten.length === 0) {
    container.innerHTML = allOpdrachten.length
      ? '<p class="hint">Geen opdrachten gevonden voor de huidige filters.</p>'
      : '<p class="hint">Nog geen opdrachten. Klik "+ Opdracht toevoegen" om te beginnen.</p>';
    return;
  }

  const obsById = Object.fromEntries(_allObsForCards.map((o) => [o.id, o]));

  container.innerHTML = opdrachten
    .map((o) => {
      const ssDisplay = (o.schoolsoort ?? []).join(', ') || '—';
      const vakDisplay = (o.vakken ?? []).map((v) => SUBJECT_LABEL[v] ?? v).join(', ') || '—';
      const jlDisplay = (o.jaarlagen ?? []).join(', ') || '—';
      const obsIcons = (o.observaties ?? [])
        .map((id) => obsById[id])
        .filter(Boolean)
        .map(
          (obs) =>
            `<span title="${escHtml(obs.naam)}" class="u-cursor-default">${escHtml(obs.icon)}</span>`,
        )
        .join(' ');

      return `
    <div class="card">
      <div class="card-main">
        <div class="student-card-row">
          <button class="student-name-btn" data-action="open-editor" data-id="${escHtml(o.id)}">${escHtml(o.naam)}</button>
        </div>
        <span class="muted">${escHtml(o.beschrijving ?? '')}</span>
        <span class="small">Schoolsoort: ${escHtml(ssDisplay)} &nbsp;·&nbsp; Vakken: ${escHtml(vakDisplay)} &nbsp;·&nbsp; Jaarlagen: ${escHtml(jlDisplay)} &nbsp;·&nbsp; Observaties: ${obsIcons || '—'}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn--icon" data-action="edit-opdracht" data-id="${escHtml(o.id)}" title="Opdracht bewerken">${ICONS.pen}</button>
        <button class="btn btn--icon" data-action="copy-opdracht" data-id="${escHtml(o.id)}" title="Opdracht kopiëren">${ICONS.copy}</button>
        <button class="btn btn--icon" data-action="print-opdracht" data-id="${escHtml(o.id)}" title="Opdracht afdrukken" aria-label="Opdracht afdrukken">${ICONS.print}</button>
        <button class="btn btn--icon btn--icon-danger" data-action="del-opdracht" data-id="${escHtml(o.id)}" title="Opdracht verwijderen">${ICONS.trash}</button>
      </div>
    </div>`;
    })
    .join('');

  container.querySelectorAll('[data-action="open-editor"]').forEach((b) =>
    b.addEventListener('click', () => {
      const opdracht = Store.getOpdrachtenSync().find((o) => o.id === b.dataset.id);
      if (opdracht) openEditor(opdracht);
    }),
  );
  container
    .querySelectorAll('[data-action="edit-opdracht"]')
    .forEach((b) => b.addEventListener('click', () => openOpdrachtenModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="copy-opdracht"]')
    .forEach((b) => b.addEventListener('click', () => copyOpdracht(b, b.dataset.id)));
  container.querySelectorAll('[data-action="print-opdracht"]').forEach((b) =>
    b.addEventListener('click', () => {
      const opdracht = Store.getOpdrachtenSync().find((o) => o.id === b.dataset.id);
      if (opdracht) openOpdrachtPrintModal(opdracht);
    }),
  );
  container
    .querySelectorAll('[data-action="del-opdracht"]')
    .forEach((b) => b.addEventListener('click', () => deleteOpdracht(b.dataset.id)));
}

async function copyOpdracht(btn, id) {
  btn.disabled = true;
  try {
    const copy = await Store.copyOpdracht(id);
    toast(`Opdracht gekopieerd als "${copy.naam}".`, 'success');
    renderOpdrachten();
  } catch (e) {
    btn.disabled = false;
    toast(`Kopiëren mislukt: ${e.message}`, 'error');
  }
}

async function deleteOpdracht(id) {
  const ok = await confirmDialog(
    'Opdracht verwijderen? Dit verwijdert ook het bijbehorende Typst-bestand.',
    { okLabel: 'Verwijderen', danger: true },
  );
  if (!ok) return;
  await Store.deleteOpdracht(id);
  toast('Opdracht verwijderd.', 'info');
  renderOpdrachten();
}
