// SPDX-License-Identifier: AGPL-3.0-or-later

// SCREEN: Leerlingen. Teachers see student cards (F-07, design spec 4.3,
// variant C): name and number, a bar per test, the year average with the
// trend arrow (F-08) and "laatste X,X" (years 4-6: alternating with "SE X,X").
// The grades fill in after the cards are there (screens/cards/student-grades.ts).
// The admin keeps the plain list (no vak, so no grades), with edit and delete.

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
import { inIdleSlices, type IdleJob } from '../utils/idle';
import { perfSpan } from '../utils/perf';
import { SUBJECT_DISPLAY } from '../domain/rapport';
import { openStudentModal, deleteStudent, openStudentCSVImport } from '../modals/leerling-edit.js';
import { Store } from '../store.js';
import { fillStudentGrades, type GradeFill } from './cards/student-grades';

// Re-export modals so existing consumers keep working
export { openGroupStudentsModal } from '../modals/groep-leerlingen.js';
export { openProfielModal } from '../modals/profiel.js';
export { openStudentModal, deleteStudent, openStudentCSVImport } from '../modals/leerling-edit.js';

interface Student {
  id: string;
  voornaam?: string;
  tussenvoegsel?: string;
  achternaam?: string;
  stamklas?: string;
  jaarlaag?: string | number;
  schoolsoort?: string[];
  _geslacht?: string;
}

interface CustomSelect {
  setOptions(o: { value: string; label: string }[]): void;
  setValue(v: string): void;
  getValue(): string;
}

// Read when used: app.js fills SEL after this module (a circular import) is loaded.
const sel = () => SEL as unknown as { studentYear: CustomSelect };
// store.js and profiel.js are untyped: their parameter types are guesses.
const fullName = Store.fullName as (s: object) => string;
const openProfiel = openProfielModal as unknown as (id: string, peers: Student[]) => Promise<void>;
const filters = {
  schoolsoort: () => getSchoolsoortFilter() as Set<string>,
  jaarlaag: () => getJaarlagFilter() as Set<string>,
  jaarlaagKlas: () => getJaarlagKlasFilter() as Set<string>,
  eigen: () => getEigenOnly() as boolean,
};

export const leerlingenState: { year: string | null; search: string } = { year: null, search: '' };

// Cards rendered at once; the rest follow in idle time (Step 7c).
const FIRST_CARDS = 60;
let _listJob: IdleJob | null = null;
let _grades: GradeFill | null = null;

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

export function renderLeerlingen(): void {
  const cfg = Store.getConfigSync() as { activeYear: string };
  const allYears: string[] = [...(Store.listYearsSync() as string[])];
  if (!allYears.includes(cfg.activeYear)) allYears.unshift(cfg.activeYear);

  sel().studentYear.setOptions(allYears.map((y) => ({ value: y, label: y })));
  if (!leerlingenState.year || !allYears.includes(leerlingenState.year))
    leerlingenState.year = cfg.activeYear;
  sel().studentYear.setValue(leerlingenState.year);

  const searchInput = document.getElementById('student-search') as HTMLInputElement;
  searchInput.value = leerlingenState.search;
  searchInput.oninput = () => {
    leerlingenState.search = searchInput.value;
    renderStudentList();
  };

  const isAdmin = Store.isAdminActive() as boolean;
  const btnAdd = document.getElementById('btn-add-student') as HTMLButtonElement;
  const btnImport = document.getElementById('btn-import-students') as HTMLButtonElement;
  btnAdd.classList.toggle('hidden', !isAdmin);
  btnImport.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    btnAdd.onclick = () => openStudentModal(null);
    btnImport.onclick = () => openStudentCSVImport();
  }

  renderStudentList();
}

/** The students the filters, the eigen toggle and the search leave, in list order. */
function filteredStudents(year: string, query: string): Student[] {
  let students: Student[] = [...(Store.getStudentsSync(year) as Student[])];
  const activeSubject = Store.getActiveSubject() as string | null;
  const schoolsoortFilter = filters.schoolsoort();
  const jaarlagFilter = filters.jaarlaag();
  const jaarlagKlasFilter = filters.jaarlaagKlas();
  const activeUser = Store.getActiveUser() as { id: string } | null;

  // Schoolsoort filter — always applied (empty set = show nothing)
  students = students.filter((s) => (s.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss)));

  if (activeSubject === 'wi') {
    // Klas 1-6 filter (by numeric jaarlaag)
    students = students.filter((s) => jaarlagKlasFilter.has(String(s.jaarlaag ?? '')));
    // Subcategory filter: OB covers jaarlaag 1-3; any WisX covers jaarlaag 4-6
    const allowedJl = new Set<string>();
    if (jaarlagFilter.has('OB')) ['1', '2', '3'].forEach((j) => allowedJl.add(j));
    if (['WisA', 'WisB', 'WisC', 'WisD'].some((w) => jaarlagFilter.has(w)))
      ['4', '5', '6'].forEach((j) => allowedJl.add(j));
    students = students.filter((s) => allowedJl.has(String(s.jaarlaag ?? '')));
  } else {
    students = students.filter((s) => jaarlagFilter.has(String(s.jaarlaag ?? '')));
  }

  // Eigen filter: student must be in at least one group where teacher is a docent
  if (filters.eigen() && activeUser && !Store.isAdminActive()) {
    const myGroups = (
      Store.getGroupsSync(year) as { docenten?: string[]; student_ids: string[] }[]
    ).filter((g) => (g.docenten ?? []).includes(activeUser.id));
    const myStudentIds = new Set(myGroups.flatMap((g) => g.student_ids));
    students = students.filter((s) => myStudentIds.has(s.id));
  }

  if (query) {
    students = students.filter(
      (s) =>
        fullName(s).toLowerCase().includes(query) ||
        String(s.id).includes(query) ||
        (s.stamklas ?? '').toLowerCase().includes(query),
    );
  }
  return students;
}

function teacherCardHtml(s: Student): string {
  const id = escHtml(s.id);
  return `
      <button type="button" class="card s-card" data-action="profile" data-id="${id}">
        <span class="s-card__who">
          <span class="s-card__name">${escHtml(fullName(s))}</span>
          <span class="s-card__nr">${id}</span>
        </span>
        <span class="s-card__grades" data-card-grades="${id}"></span>
      </button>`;
}

function adminRowHtml(s: Student): string {
  const id = escHtml(s.id);
  return `
      <div class="card s-row">
        <div class="card-main">
          <div class="student-card-row">
            <span class="s-row__name">${escHtml(fullName(s))}</span>
            <span class="card-sep">·</span>
            <span class="student-id-inline">${id}${s._geslacht ? ' · ' + escHtml(s._geslacht) : ''}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn--icon" data-action="edit-student" data-id="${id}" title="Leerling bewerken" aria-label="Leerling bewerken">${ICONS.pen}</button>
          <button class="btn btn--icon btn--icon-danger" data-action="del-student" data-id="${id}" title="Leerling verwijderen" aria-label="Leerling verwijderen">${ICONS.trash}</button>
        </div>
      </div>`;
}

/**
 * Renders the filtered list. `staged`: the first cards now, the rest in idle
 * time; a background refresh passes false, so the whole list is there when
 * app.js restores the scroll position (review 7c M1).
 */
export function renderStudentList({ staged = true } = {}): void {
  _listJob?.cancel(); // cards of an earlier render still waiting for idle time
  _grades?.cancel();
  _grades = null;
  const year = leerlingenState.year!;
  const query = leerlingenState.search.trim().toLowerCase();
  const container = document.getElementById('student-list') as HTMLElement;
  const students = filteredStudents(year, query);

  if (students.length === 0) {
    container.className = 'card-list';
    container.innerHTML = query
      ? '<p class="hint">Geen leerlingen gevonden voor deze zoekopdracht.</p>'
      : '<p class="hint">Geen leerlingen voor dit schooljaar. Voeg leerlingen toe of kies een ander schooljaar.</p>';
    return;
  }

  const endDom = perfSpan('leerlingen:dom');
  const isAdmin = Store.isAdminActive() as boolean;
  // The admin keeps the list; teachers get a grid of cards per class (spec 4.3).
  container.className = isAdmin ? 'card-list' : 'card-list s-cards';
  // One HTML part per student (with the headings that start before it).
  const parts: string[] = [];
  let lastJl: string | null = null;
  let lastSk: string | null = null;
  for (const s of students) {
    let html = '';
    const stamklas = s.stamklas || '—';
    const jl = (Store.jaarlaagFromStamklas(stamklas) as string) || '—';
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
      lastSk = null;
    }
    if (stamklas !== lastSk) {
      html += `<div class="section-heading-stamklas">${escHtml(stamklas)}</div>`;
      lastSk = stamklas;
    }
    html += isAdmin ? adminRowHtml(s) : teacherCardHtml(s);
    parts.push(html);
  }

  // One listener for all cards, also those added later (Step 7c).
  const peers = students; // the current filtered list, for the profile's navigation
  container.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!b || b.disabled || !container.contains(b)) return;
    const id = b.dataset.id!;
    if (b.dataset.action === 'profile') void openProfiel(id, peers);
    else if (b.dataset.action === 'edit-student') void openStudentModal(id);
    else if (b.dataset.action === 'del-student') void deleteStudent(id);
  };

  // Why Verwijderen is disabled, per student id (admin only: teachers have no
  // delete button). Filled by the checks below, applied to the buttons as they appear.
  const deleteBlocks = new Map<string, string>();
  const deleteButtons = new Map<string, HTMLButtonElement>();
  const applyBlock = (id: string) => {
    const btn = deleteButtons.get(id);
    const reason = deleteBlocks.get(id);
    if (!btn || !reason) return;
    btn.disabled = true;
    btn.title = reason;
  };
  const grades = isAdmin ? null : fillStudentGrades(container, students, year);
  _grades = grades;
  const appendParts = (slice: string[]) => {
    const last = container.lastElementChild;
    container.insertAdjacentHTML('beforeend', slice.join(''));
    for (let el = last ? last.nextElementSibling : container.firstElementChild; el;) {
      if (isAdmin) {
        const btn = el.querySelector<HTMLButtonElement>('[data-action="del-student"]');
        if (btn) {
          deleteButtons.set(btn.dataset.id!, btn);
          applyBlock(btn.dataset.id!);
        }
      } else if (el instanceof HTMLElement && el.dataset.action === 'profile') {
        grades?.show(el);
      }
      el = el.nextElementSibling;
    }
  };

  // The first cards at once, the rest in idle time (a long list paints within budget).
  container.innerHTML = '';
  const first = staged ? FIRST_CARDS : parts.length;
  appendParts(parts.slice(0, first));
  endDom();
  if (first < parts.length) {
    const endRest = perfSpan('leerlingen:rest');
    const job = inIdleSlices(parts.slice(first), appendParts, 50);
    _listJob = job;
    void job.done.then(endRest);
  }

  if (!isAdmin) return;
  // Disable Verwijderen for students that cannot be deleted (non-blocking)
  const endChecks = perfSpan('leerlingen:checks');
  // One folder read per year and vak instead of one read per student and file.
  const ids = students.map((s) => s.id);
  const preloads = (Store.listYearsSync() as string[]).flatMap((y) =>
    Object.keys(SUBJECT_DISPLAY).map((v) =>
      (Store.preloadScores(y, v, ids) as Promise<void>).catch(() => {}),
    ),
  );
  const checks = students.map(async (s) => {
    await Promise.all(preloads);
    const id = String(s.id);
    if (await Store.studentHasAnyScores(s.id)) {
      deleteBlocks.set(
        id,
        'Er zijn scores ingevoerd voor deze leerling, de leerling kan dus niet worden verwijderd.',
      );
    } else if (
      (Store.getGroupsSync(year) as { student_ids?: string[] }[]).some((g) =>
        (g.student_ids ?? []).includes(s.id),
      )
    ) {
      // Also block if the student is in any group in any loaded year
      deleteBlocks.set(id, 'Deze leerling zit in een groep en kan dus niet worden verwijderd.');
    }
    applyBlock(id);
  });
  void Promise.allSettled(checks).then(endChecks);
}
