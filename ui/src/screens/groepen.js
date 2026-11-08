// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICONS } from '../utils/icons.js';
import { statsOfAverages } from '../domain/statistics';
import {
  escHtml,
  SEL,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
  getAdminSubjectFilter,
} from '../app.js';
import { gradeStatHtml } from '../utils/grades';
import { perfSpan } from '../utils/perf';
import { openGroupStudentsModal } from './leerlingen.js';

// ── Modal imports (used directly in this screen file) ───────────────────────
import {
  openGroupModal,
  deleteGroup,
  openGroupCSVImport,
  openGroupAssignmentCSVImport,
} from '../modals/groep-edit.js';

// ── Re-exports for backward compatibility ───────────────────────────────────
export {
  openGroupModal,
  deleteGroup,
  openGroupCSVImport,
  openGroupAssignmentCSVImport,
} from '../modals/groep-edit.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Groepen
// ═══════════════════════════════════════════════════════════════════════════════

export function renderGroepen() {
  const cfg = Store.getConfigSync();
  const years = [...Store.listYearsSync()];
  if (!years.includes(cfg.activeYear)) years.unshift(cfg.activeYear);

  const currentYear = SEL.groupsYear.getValue() || cfg.activeYear;
  SEL.groupsYear.setOptions(years.map((y) => ({ value: y, label: y })));
  SEL.groupsYear.setValue(years.includes(currentYear) ? currentYear : years[0]);

  const isAdmin = Store.isAdminActive();
  const btnAdd = document.getElementById('btn-add-group');
  const btnImport = document.getElementById('btn-import-groups');
  const btnImportAssignment = document.getElementById('btn-import-group-assignment');
  btnAdd.classList.toggle('hidden', !isAdmin);
  btnImport.classList.toggle('hidden', !isAdmin);
  btnImportAssignment.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    btnAdd.onclick = () => openGroupModal(null);
    btnImport.onclick = () => openGroupCSVImport();
    btnImportAssignment.onclick = () => openGroupAssignmentCSVImport();
  }
  return renderGroepenForYear(SEL.groupsYear.getValue()); // the tab span ends when the list is in (review 7c n4)
}

const SUBCATEGORY_TO_FILTER = {
  onderbouw: 'OB',
  wisa: 'WisA',
  wisb: 'WisB',
  wisc: 'WisC',
  wisd: 'WisD',
};

export async function renderGroepenForYear(year) {
  let groups = Store.getGroupsSync(year);
  const students = Store.getStudentsSync(year);
  const users = await Store.loadUsers();
  const container = document.getElementById('group-list');

  // Admin: filter by selected subject in the topbar filter bar
  if (Store.isAdminActive()) {
    const adminSubj = getAdminSubjectFilter();
    if (adminSubj) {
      groups = groups.filter((g) => g.subject === adminSubj);
    }
  }

  const activeSubject = Store.isAdminActive() ? getAdminSubjectFilter() : Store.getActiveSubject();
  const schoolsoortFilter = getSchoolsoortFilter();
  const jaarlagFilter = getJaarlagFilter();
  const jaarlagKlasFilter = getJaarlagKlasFilter();
  const eigenOnly = getEigenOnly();
  const activeUser = Store.getActiveUser();

  // Schoolsoort filter — always applied (empty set = show nothing)
  groups = groups.filter((g) => (g.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss)));

  // Jaarlaag filter
  if (activeSubject === 'wi') {
    // Klas 1-6 filter (by numeric jaarlaag)
    groups = groups.filter((g) => jaarlagKlasFilter.has(String(g.jaarlaag)));
    // Subcategory filter (OB / WisA / WisB / WisC / WisD)
    groups = groups.filter((g) => {
      const filterKey = SUBCATEGORY_TO_FILTER[g.subcategory ?? ''];
      return filterKey ? jaarlagFilter.has(filterKey) : true;
    });
  } else {
    groups = groups.filter((g) => jaarlagFilter.has(String(g.jaarlaag)));
  }

  // Eigen filter
  if (eigenOnly && activeUser && !Store.isAdminActive()) {
    groups = groups.filter((g) => (g.docenten ?? []).includes(activeUser.id));
  }

  groups.sort(
    (a, b) =>
      String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );

  if (groups.length === 0) {
    container.innerHTML = `<p class="hint">Geen groepen voor ${escHtml(year)}.</p>`;
    return;
  }

  let html = '';
  let lastJl = null;
  for (const g of groups) {
    const jl = String(g.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    const memberNames = g.student_ids
      .map((id) => {
        const s = students.find((s) => s.id === id);
        return s ? s.voornaam || Store.fullName(s) : `#${id}`;
      })
      .sort()
      .join(', ');
    const schoolsoortText = (g.schoolsoort ?? []).join(', ') || '—';
    const docentNames =
      (g.docenten ?? [])
        .map((did) => {
          const u = users.find((u) => u.id === did);
          return u ? [u.voornaam, u.tussenvoegsel, u.achternaam].filter(Boolean).join(' ') : null;
        })
        .filter(Boolean)
        .join(', ') || '—';
    html += `
      <div class="card">
        <div class="card-main">
          <button class="student-name-btn group-name-btn" data-action="open-group" data-id="${escHtml(g.id)}" ${Store.isAdminActive() ? 'disabled' : ''}>${escHtml(g.name)}</button>
          <p class="small muted">${escHtml(schoolsoortText)} &nbsp;·&nbsp; Docent(en): ${escHtml(docentNames)}</p>
          <p class="small muted">${g.student_ids.length} leerlingen${memberNames ? ': ' + escHtml(memberNames) : ''}</p>
          ${g.student_ids.length > 0 ? `<p class="small" data-grade-stats="${escHtml(g.id)}"></p>` : ''}
        </div>
        ${
          Store.isAdminActive()
            ? `
        <div class="card-actions">
          <button class="btn btn--icon" data-action="edit-group" data-id="${escHtml(g.id)}" title="Groep bewerken">${ICONS.pen}</button>
          <button class="btn btn--icon btn--icon-danger" data-action="del-group" data-id="${escHtml(g.id)}"${g.student_ids.length > 0 ? ' disabled title="Deze groep heeft leerlingen en kan dus niet worden verwijderd."' : ' title="Groep verwijderen"'}>${ICONS.trash}</button>
        </div>`
            : Store.isVoorzitterActive(g.subject)
              ? `
        <div class="card-actions">
          <button class="btn btn--icon" data-action="edit-group" data-id="${escHtml(g.id)}" title="Leerlingen en docenten van de groep (sectievoorzitter)">${ICONS.pen}</button>
        </div>`
              : ''
        }
      </div>`;
  }
  container.innerHTML = html;
  container
    .querySelectorAll('[data-action="open-group"]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        openGroupStudentsModal(
          b.dataset.id,
          SEL.groupsYear.getValue() || Store.getConfigSync().activeYear,
        ),
      ),
    );
  container
    .querySelectorAll('[data-action="edit-group"]')
    .forEach((b) => b.addEventListener('click', () => openGroupModal(b.dataset.id)));
  container
    .querySelectorAll('[data-action="del-group"]')
    .forEach((b) => b.addEventListener('click', () => deleteGroup(b.dataset.id)));

  // Fill grade stats asynchronously — does not block initial render
  fillGroupGradeStats(
    groups.filter((g) => g.student_ids.length > 0),
    year,
    container,
  );
}

// ── Grade stats helpers ────────────────────────────────────────────────────────

async function calcGroupGradeStats(group, year) {
  const subject = group.subject;
  if (!subject) return null;

  const allStudents = Store.getStudentsSync(year);
  const students = allStudents.filter((s) => group.student_ids.includes(s.id));
  if (students.length === 0) return null;

  // All the students' tests of the year, whatever the group's jaarlaag (decision 25).
  await Store.getExams(year, subject);

  const scoreMap = {};
  await Promise.all(
    students.map(async (s) => {
      const rec = await Store.getStudentScores(s.id, year, subject);
      scoreMap[s.id] = rec;
    }),
  );

  // Decision 21: mean, SD and % onvoldoende of the year averages as shown.
  return statsOfAverages(
    students
      .map((s) => Store.studentYearAverage(scoreMap[s.id], year, subject))
      .filter((g) => g !== null),
  );
}

async function fillGroupGradeStats(groups, year, container) {
  const end = perfSpan('groepen:stats');
  // One folder read per vak instead of one read per student (Step 7c).
  const subjects = [...new Set(groups.map((g) => g.subject).filter(Boolean))];
  await Promise.all(subjects.map((s) => Store.preloadScores(year, s).catch(() => {})));
  for (const g of groups) {
    const stats = await calcGroupGradeStats(g, year);
    if (!stats) continue;
    const el = container.querySelector('[data-grade-stats="' + g.id + '"]');
    if (el) el.innerHTML = gradeStatHtml(stats);
  }
  end();
}
