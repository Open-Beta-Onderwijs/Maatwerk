// SPDX-License-Identifier: AGPL-3.0-or-later

// SCREEN: Groepen. Group cards side by side per jaarlaag (F-09, design spec
// 4.4, variant B): name with the schoolsoort pill, "<docent> · <n> leerlingen",
// the first names (two lines at most); right the mean ± SD of the year
// averages and % onvoldoende, upper school "SE … · R …". No trend per group.

import { ICONS } from '../utils/icons.js';
import {
  escHtml,
  SEL,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
  getAdminSubjectFilter,
} from '../app.js';
import { groupCardNumbers, isUpperSchool } from '../domain/cards';
import { seAverage } from '../domain/statistics';
import type { HistoryEntry } from '../domain/attempts';
import type { Exam, ScoreRecord } from '../domain/types';
import { applyStyleData } from '../legacy/style-data';
import { Store } from '../store.js';
import { perfSpan } from '../utils/perf';
import { openGroupStudentsModal } from './leerlingen';
import { groupGradesHtml } from './cards/card-html';

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

interface Group {
  id: string;
  name: string;
  subject?: string;
  subcategory?: string;
  jaarlaag?: string | number;
  schoolsoort?: string[];
  docenten?: string[];
  student_ids: string[];
}

interface Person {
  id: string;
  voornaam?: string;
  tussenvoegsel?: string;
  achternaam?: string;
}

interface CustomSelect {
  setOptions(o: { value: string; label: string }[]): void;
  setValue(v: string): void;
  getValue(): string;
}

// Read when used: app.js fills SEL after this module (a circular import) is loaded.
const sel = () => SEL as unknown as { groupsYear: CustomSelect };

export function renderGroepen(): Promise<void> {
  const cfg = Store.getConfigSync() as { activeYear: string };
  const years: string[] = [...(Store.listYearsSync() as string[])];
  if (!years.includes(cfg.activeYear)) years.unshift(cfg.activeYear);

  const currentYear = sel().groupsYear.getValue() || cfg.activeYear;
  sel().groupsYear.setOptions(years.map((y) => ({ value: y, label: y })));
  sel().groupsYear.setValue(years.includes(currentYear) ? currentYear : years[0]!);

  const isAdmin = Store.isAdminActive() as boolean;
  const btnAdd = document.getElementById('btn-add-group') as HTMLButtonElement;
  const btnImport = document.getElementById('btn-import-groups') as HTMLButtonElement;
  const btnImportAssignment = document.getElementById(
    'btn-import-group-assignment',
  ) as HTMLButtonElement;
  btnAdd.classList.toggle('hidden', !isAdmin);
  btnImport.classList.toggle('hidden', !isAdmin);
  btnImportAssignment.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    btnAdd.onclick = () => openGroupModal(null);
    btnImport.onclick = () => openGroupCSVImport();
    btnImportAssignment.onclick = () => openGroupAssignmentCSVImport();
  }
  return renderGroepenForYear(sel().groupsYear.getValue()); // the tab span ends when the list is in (review 7c n4)
}

const SUBCATEGORY_TO_FILTER: Record<string, string> = {
  onderbouw: 'OB',
  wisa: 'WisA',
  wisb: 'WisB',
  wisc: 'WisC',
  wisd: 'WisD',
};

function filteredGroups(year: string): Group[] {
  let groups = [...(Store.getGroupsSync(year) as Group[])];
  const isAdmin = Store.isAdminActive() as boolean;
  const adminSubj = isAdmin ? (getAdminSubjectFilter() as string | null) : null;
  // Admin: filter by selected subject in the topbar filter bar
  if (adminSubj) groups = groups.filter((g) => g.subject === adminSubj);

  const activeSubject = isAdmin ? adminSubj : (Store.getActiveSubject() as string | null);
  const schoolsoortFilter = getSchoolsoortFilter() as Set<string>;
  const jaarlagFilter = getJaarlagFilter() as Set<string>;
  const jaarlagKlasFilter = getJaarlagKlasFilter() as Set<string>;
  const activeUser = Store.getActiveUser() as { id: string } | null;

  // Schoolsoort filter — always applied (empty set = show nothing)
  groups = groups.filter((g) => (g.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss)));

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

  if (getEigenOnly() && activeUser && !isAdmin) {
    groups = groups.filter((g) => (g.docenten ?? []).includes(activeUser.id));
  }

  return groups.sort(
    (a, b) =>
      String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );
}

function personName(u: Person): string {
  return [u.voornaam, u.tussenvoegsel, u.achternaam].filter(Boolean).join(' ');
}

function groupCardHtml(g: Group, students: Person[], users: Person[]): string {
  const isAdmin = Store.isAdminActive() as boolean;
  const id = escHtml(g.id);
  const firstNames = g.student_ids
    .map((sid) => {
      const s = students.find((s) => s.id === sid);
      return s ? s.voornaam || personName(s) : `#${sid}`;
    })
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
  const docenten =
    (g.docenten ?? [])
      .map((did) => users.find((u) => u.id === did))
      .filter((u): u is Person => !!u)
      .map(personName)
      .join(', ') || 'Geen docent';
  const n = g.student_ids.length;
  const actions = isAdmin
    ? `
        <button class="btn btn--icon" data-action="edit-group" data-id="${id}" title="Groep bewerken" aria-label="Groep bewerken">${ICONS.pen}</button>
        <button class="btn btn--icon btn--icon-danger" data-action="del-group" data-id="${id}"${n > 0 ? ' disabled title="Deze groep heeft leerlingen en kan dus niet worden verwijderd."' : ' title="Groep verwijderen"'} aria-label="Groep verwijderen">${ICONS.trash}</button>`
    : Store.isVoorzitterActive(g.subject)
      ? `
        <button class="btn btn--icon" data-action="edit-group" data-id="${id}" title="Leerlingen en docenten van de groep (sectievoorzitter)" aria-label="Groep bewerken">${ICONS.pen}</button>`
      : '';
  const pill = (g.schoolsoort ?? []).length
    ? `<span class="g-card__type">${escHtml((g.schoolsoort ?? []).join(', '))}</span>`
    : '';
  return `
      <div class="card g-card">
        <div class="g-card__info">
          <span class="g-card__head">
            <button type="button" class="g-card__open" data-action="open-group" data-id="${id}"${isAdmin ? ' disabled' : ''}>${escHtml(g.name)}</button>
            ${pill}
          </span>
          <span class="g-card__meta">${escHtml(docenten)} · ${n} ${n === 1 ? 'leerling' : 'leerlingen'}</span>
        </div>
        <div class="g-card__grades" ${n > 0 ? `data-grade-stats="${id}"` : ''}></div>
        <p class="g-card__names">${escHtml(firstNames)}</p>
        ${actions ? `<div class="g-card__actions">${actions}</div>` : ''}
      </div>`;
}

export async function renderGroepenForYear(year: string): Promise<void> {
  const groups = filteredGroups(year);
  const students = Store.getStudentsSync(year) as Person[];
  const users = (await Store.loadUsers()) as Person[];
  const container = document.getElementById('group-list') as HTMLElement;

  if (groups.length === 0) {
    container.className = 'card-list';
    container.innerHTML = `<p class="hint">Geen groepen voor ${escHtml(year)}.</p>`;
    return;
  }

  container.className = 'card-list g-cards';
  let html = '';
  let lastJl: string | null = null;
  for (const g of groups) {
    const jl = String(g.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    html += groupCardHtml(g, students, users);
  }
  container.innerHTML = html;
  container.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!b || b.disabled || !container.contains(b)) return;
    const id = b.dataset.id!;
    if (b.dataset.action === 'open-group')
      void openGroupStudentsModal(
        id,
        sel().groupsYear.getValue() || (Store.getConfigSync() as { activeYear: string }).activeYear,
      );
    else if (b.dataset.action === 'edit-group') void openGroupModal(id);
    else if (b.dataset.action === 'del-group') void deleteGroup(id);
  };

  // Fill grade stats asynchronously — does not block initial render
  void fillGroupGradeStats(
    groups.filter((g) => g.student_ids.length > 0),
    year,
    container,
  );
}

// ── Grade stats ──────────────────────────────────────────────────────────────

async function groupNumbers(group: Group, year: string) {
  const subject = group.subject;
  if (!subject) return null;
  const students = (Store.getStudentsSync(year) as Person[]).filter((s) =>
    group.student_ids.includes(s.id),
  );
  if (students.length === 0) return null;
  const upper = isUpperSchool(group.jaarlaag);

  // All the students' tests of the year, whatever the group's jaarlaag (decision 25).
  await Store.getExams(year, subject);
  const allExams = upper ? (Store.getAllExamsSync(subject) as Exam[]) : [];
  const members = await Promise.all(
    students.map(async (s) => {
      const rec = (await Store.getStudentScores(s.id, year, subject)) as ScoreRecord;
      const se = upper
        ? seAverage(
            (await Store.getStudentHistory(s.id, subject, { loaded: true })) as HistoryEntry[],
            allExams,
          )
        : null;
      return { year: Store.studentYearAverage(rec, year, subject) as number | null, se };
    }),
  );
  // Decision 21: mean, SD and % onvoldoende of the averages as shown.
  return groupCardNumbers(members, upper);
}

/** Each render starts a new fill; an older one stops (review 26-28 m4). */
let fillRun = 0;

async function fillGroupGradeStats(groups: Group[], year: string, container: HTMLElement) {
  const run = ++fillRun;
  const end = perfSpan('groepen:stats');
  // One folder read per vak (and per year for the SE) instead of one read per student (Step 7c).
  const subjects = [...new Set(groups.map((g) => g.subject).filter((s): s is string => !!s))];
  const years = groups.some((g) => isUpperSchool(g.jaarlaag))
    ? (Store.listYearsSync() as string[])
    : [year];
  // Every year once (not once per student, review 26-28 M2); the SE needs all of them.
  await Promise.all(
    subjects.flatMap((s) =>
      years.map((y) =>
        Promise.all([
          (Store.loadYear(y, s) as Promise<void>).catch(() => {}),
          (Store.preloadScores(y, s) as Promise<void>).catch(() => {}),
        ]),
      ),
    ),
  );
  for (const g of groups) {
    if (run !== fillRun) return;
    const numbers = await groupNumbers(g, year);
    if (!numbers) continue;
    const el = container.querySelector<HTMLElement>(`[data-grade-stats="${CSS.escape(g.id)}"]`);
    if (!el) continue;
    el.innerHTML = groupGradesHtml(numbers);
    applyStyleData(el);
  }
  end();
}
