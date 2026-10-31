// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICONS } from '../utils/icons.js';
import {
  escHtml,
  SEL,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
} from '../app.js';
import { openProfielModal } from '../modals/profiel.js';
import { inIdleSlices } from '../utils/idle';
import { perfSpan } from '../utils/perf';
import { SUBJECT_DISPLAY } from '../domain/rapport';
import { openStudentModal, deleteStudent, openStudentCSVImport } from '../modals/leerling-edit.js';

// Re-export modals so existing consumers keep working
export { openGroupStudentsModal } from '../modals/groep-leerlingen.js';
export { openProfielModal } from '../modals/profiel.js';
export { openStudentModal, deleteStudent, openStudentCSVImport } from '../modals/leerling-edit.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Leerlingen
// ═══════════════════════════════════════════════════════════════════════════════

export const leerlingenState = { year: null, search: '' };

// Cards rendered at once; the rest follow in idle time (Step 7c).
const FIRST_CARDS = 60;
let _listJob = null;

export const JAARLAGEN = ['1', '2', '3', '4', '5', '6'];
export const SCHOOLSOORTEN = [
  'Vmbo-bb',
  'Vmbo-kb',
  'Vmbo-gl',
  'Vmbo-tl',
  'Havo',
  'Vwo',
  'Gymnasium',
];

export function renderLeerlingen() {
  const cfg = Store.getConfigSync();
  const allYears = [...Store.listYearsSync()];
  if (!allYears.includes(cfg.activeYear)) allYears.unshift(cfg.activeYear);

  SEL.studentYear.setOptions(allYears.map((y) => ({ value: y, label: y })));
  if (!leerlingenState.year || !allYears.includes(leerlingenState.year))
    leerlingenState.year = cfg.activeYear;
  SEL.studentYear.setValue(leerlingenState.year);

  const searchInput = document.getElementById('student-search');
  searchInput.value = leerlingenState.search;
  searchInput.oninput = () => {
    leerlingenState.search = searchInput.value;
    renderStudentList();
  };

  const isAdmin = Store.isAdminActive();
  const btnAdd = document.getElementById('btn-add-student');
  const btnImport = document.getElementById('btn-import-students');
  btnAdd.classList.toggle('hidden', !isAdmin);
  btnImport.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    btnAdd.onclick = () => openStudentModal(null);
    btnImport.onclick = () => openStudentCSVImport();
  }

  renderStudentList();
}

export function renderStudentList() {
  _listJob?.cancel(); // cards of an earlier render still waiting for idle time
  const year = leerlingenState.year;
  const query = leerlingenState.search.trim().toLowerCase();
  const container = document.getElementById('student-list');

  let students = [...Store.getStudentsSync(year)];

  const activeSubject = Store.getActiveSubject();
  const schoolsoortFilter = getSchoolsoortFilter();
  const jaarlagFilter = getJaarlagFilter();
  const jaarlagKlasFilter = getJaarlagKlasFilter();
  const eigenOnly = getEigenOnly();
  const activeUser = Store.getActiveUser();

  // Schoolsoort filter — always applied (empty set = show nothing)
  students = students.filter((s) => (s.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss)));

  // Jaarlaag filter
  if (activeSubject === 'wi') {
    // Klas 1-6 filter (by numeric jaarlaag)
    students = students.filter((s) => jaarlagKlasFilter.has(String(s.jaarlaag ?? '')));
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
    students = students.filter((s) => allowedJl.has(String(s.jaarlaag ?? '')));
  } else {
    students = students.filter((s) => jaarlagFilter.has(String(s.jaarlaag ?? '')));
  }

  // Eigen filter: student must be in at least one group where teacher is a docent
  if (eigenOnly && activeUser && !Store.isAdminActive()) {
    const myGroups = Store.getGroupsSync(year).filter((g) =>
      (g.docenten ?? []).includes(activeUser.id),
    );
    const myStudentIds = new Set(myGroups.flatMap((g) => g.student_ids));
    students = students.filter((s) => myStudentIds.has(s.id));
  }

  // Filter by search (after sort so filtered results stay ordered)
  if (query) {
    students = students.filter(
      (s) =>
        Store.fullName(s).toLowerCase().includes(query) ||
        String(s.id).includes(query) ||
        (s.stamklas ?? '').toLowerCase().includes(query),
    );
  }

  if (students.length === 0) {
    container.innerHTML = query
      ? '<p class="hint">Geen leerlingen gevonden voor deze zoekopdracht.</p>'
      : '<p class="hint">Geen leerlingen voor dit schooljaar. Voeg leerlingen toe of kies een ander schooljaar.</p>';
    return;
  }

  const endDom = perfSpan('leerlingen:dom');
  const isAdmin = Store.isAdminActive();
  // One HTML part per student (with the headings that start before it).
  const parts = [];
  let lastJl = null;
  let lastSk = null;
  for (const s of students) {
    let html = '';
    const stamklas = s.stamklas || '—';
    const jl = Store.jaarlaagFromStamklas(stamklas) || '—';
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
      lastSk = null;
    }
    if (stamklas !== lastSk) {
      html += `<div class="section-heading-stamklas">${escHtml(stamklas)}</div>`;
      lastSk = stamklas;
    }
    html += `
      <div class="card">
        <div class="card-main">
          <div class="student-card-row">
            <button class="student-name-btn" data-action="profile" data-id="${s.id}" ${isAdmin ? 'disabled' : ''}>${escHtml(Store.fullName(s))}</button>
            <span class="card-sep">·</span>
            <span class="student-id-inline">${s.id}${s._geslacht ? ' · ' + escHtml(s._geslacht) : ''}</span>
          </div>
        </div>
        ${
          isAdmin
            ? `
        <div class="card-actions">
          <button class="btn-sm btn-sm-icon" data-action="edit-student" data-id="${s.id}" title="Leerling bewerken">${ICONS.pen}</button>
          <button class="btn-sm btn-danger btn-sm-icon" data-action="del-student" data-id="${s.id}" title="Leerling verwijderen">${ICONS.trash}</button>
        </div>`
            : ''
        }
      </div>`;
    parts.push(html);
  }

  // One listener for all cards, also those added later (Step 7c).
  const _peers = students; // capture current filtered+sorted list for nav
  container.onclick = (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b || b.disabled || !container.contains(b)) return;
    if (b.dataset.action === 'profile') openProfielModal(b.dataset.id, null, _peers);
    else if (b.dataset.action === 'edit-student') openStudentModal(b.dataset.id);
    else if (b.dataset.action === 'del-student') deleteStudent(b.dataset.id);
  };

  // Why Verwijderen is disabled, per student id (admin only: teachers have no
  // delete button). Filled by the checks below, applied to the buttons as they appear.
  const deleteBlocks = new Map();
  const deleteButtons = new Map();
  const applyBlock = (id) => {
    const btn = deleteButtons.get(id);
    const reason = deleteBlocks.get(id);
    if (!btn || !reason) return;
    btn.disabled = true;
    btn.title = reason;
  };
  const appendParts = (slice) => {
    const last = container.lastElementChild;
    container.insertAdjacentHTML('beforeend', slice.join(''));
    if (!isAdmin) return;
    for (let el = last ? last.nextElementSibling : container.firstElementChild; el;) {
      const btn = el.querySelector('[data-action="del-student"]');
      if (btn) {
        deleteButtons.set(btn.dataset.id, btn);
        applyBlock(btn.dataset.id);
      }
      el = el.nextElementSibling;
    }
  };

  // The first cards at once, the rest in idle time (a long list paints within budget).
  container.innerHTML = '';
  appendParts(parts.slice(0, FIRST_CARDS));
  endDom();
  const endRest = perfSpan('leerlingen:rest');
  _listJob = inIdleSlices(parts.slice(FIRST_CARDS), appendParts, 50);
  void _listJob.done.then(endRest);

  if (!isAdmin) return;
  // Disable Verwijderen for students that cannot be deleted (non-blocking)
  const endChecks = perfSpan('leerlingen:checks');
  // One folder read per year and vak instead of one read per student and file.
  const ids = students.map((s) => s.id);
  const preloads = Store.listYearsSync().flatMap((y) =>
    Object.keys(SUBJECT_DISPLAY).map((v) => Store.preloadScores(y, v, ids).catch(() => {})),
  );
  const checks = students.map(async (s) => {
    await Promise.all(preloads);
    const id = String(s.id);
    if (await Store.studentHasAnyScores(s.id)) {
      deleteBlocks.set(
        id,
        'Er zijn scores ingevoerd voor deze leerling, de leerling kan dus niet worden verwijderd.',
      );
    } else if (Store.getGroupsSync(year).some((g) => (g.student_ids ?? []).includes(s.id))) {
      // Also block if the student is in any group in any loaded year
      deleteBlocks.set(id, 'Deze leerling zit in een groep en kan dus niet worden verwijderd.');
    }
    applyBlock(id);
  });
  void Promise.allSettled(checks).then(endChecks);
}
