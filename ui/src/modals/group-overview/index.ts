// SPDX-License-Identifier: AGPL-3.0-or-later

// The group overview modal (F-10; design spec 4.5, board 45; PLAN-2 decisions 27-34): five tabs
// over the whole school year (Resultaten, Cijferverdeling, Boxplot, RTTI-analyse, Observaties),
// each rendered when first opened; placeholders while the scores load. R-05: was
// modals/groep-leerlingen.js.

import {
  changedByName,
  closeModal,
  modalRefresher,
  onModalCleanup,
  onModalSync,
  openModal,
  showReloadNotice,
} from '../../app.js';
import { skelBlock, skelRegion, skelRows } from '../../components/skeleton';
import type { VakNumbers } from '../../domain/numbers';
import type { Exam, Group, Observatie, ScoreRecord, Student } from '../../domain/types';
import { applyStyleData } from '../../legacy/style-data';
import { installGradeTips } from '../../overview/tooltip';
import { emptyHtml, LOAD_FAILED } from '../../overview/common';
import { vakNumbers } from '../../services/vak-numbers';
import { Store } from '../../store.js';
import { openProfielModal } from '../profile';
import { boxHtml, rttiHtml, verdelingHtml } from './charts';
import { buildGroupModel, type GroupModel } from './model';
import { fitHeat, observatiesHtml } from './observaties';
import { cellTip, resultatenHtml } from './resultaten';

type TabId = 'resultaten' | 'cijferverdeling' | 'boxplot' | 'rtti' | 'observaties';

const TABS: { id: TabId; label: string }[] = [
  { id: 'resultaten', label: 'Resultaten' },
  { id: 'cijferverdeling', label: 'Cijferverdeling' },
  { id: 'boxplot', label: 'Boxplot' },
  { id: 'rtti', label: 'RTTI-analyse' },
  { id: 'observaties', label: 'Observaties' },
];

interface Person {
  id: string;
  voornaam?: string;
  tussenvoegsel?: string;
  achternaam?: string;
}

// The version of one student in a students-file change (before, after), as JSON.
function studentVersions(ev: { before?: Student[]; after?: Student[] }, id: string) {
  const find = (list: Student[] | undefined) =>
    JSON.stringify((list ?? []).find((s) => s.id === id) ?? null);
  return [find(ev.before), find(ev.after)];
}

const personName = (u: Person) =>
  [u.voornaam, u.tussenvoegsel, u.achternaam].filter(Boolean).join(' ');

async function docentLine(group: Group & { docenten?: string[] }): Promise<string> {
  try {
    const users = (await Store.loadUsers()) as Person[];
    const names = (group.docenten ?? [])
      .map((id) => users.find((u) => u.id === id))
      .filter((u): u is Person => !!u)
      .map(personName);
    return names.join(', ') || 'Geen docent';
  } catch {
    return 'Geen docent';
  }
}

function placeholder(tab: TabId, n: number): string {
  if (tab === 'resultaten') return skelRegion(`<div class="ov-stack">${skelRows(n + 3, 29)}</div>`);
  return skelRegion(`<div class="ov-stack">${skelBlock(220)}${skelBlock(220)}</div>`);
}

/** What the overview shows besides the group itself: loaded before a refresh opens it. */
interface GroupData {
  yearExams: Exam[];
  records: Map<string, ScoreRecord | null>;
  numbers: VakNumbers | null;
}

/** The scores of the year for the cells; the r and SE columns are the core's (step 38). */
async function loadGroupData(group: Group, students: Student[], year: string): Promise<GroupData> {
  const yearExams = Store.getExamsSync(year) as Exam[];
  const records = new Map<string, ScoreRecord | null>();
  // One folder read instead of one per student (review 29 m5).
  await (Store.preloadScores(year) as Promise<void>).catch(() => {});
  for (const s of students)
    records.set(String(s.id), (await Store.getStudentScores(s.id, year)) as ScoreRecord);
  const subject = group.subject ?? (Store.getActiveSubject() as string | null);
  const numbers = subject ? await vakNumbers(year, subject, Store.generation() as number) : null;
  return { yearExams, records, numbers };
}

/**
 * Opens the group overview. `prefetched`: a background refresh loaded the data first, so the
 * new window shows the tables at once instead of placeholders (review 29 m4).
 */
export async function openGroupStudentsModal(
  groupId: string,
  year: string,
  initialTab: TabId = 'resultaten',
  prefetched?: GroupData,
): Promise<void> {
  const group = (Store.getGroupsSync(year) as (Group & { schoolsoort?: string[] })[]).find(
    (g) => g.id === groupId,
  );
  if (!group) return;
  const students = (Store.getStudentsSync(year) as Student[])
    .filter((s) => group.student_ids.some((id) => String(id) === String(s.id)))
    .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));
  const nameOf = (s: Student) => Store.fullName(s) as string;
  const subtitle = (docent: string) =>
    `${docent} · ${students.length} leerlingen · klik een naam om het leerlingprofiel te openen`;

  const panes = TABS.map(
    (t) =>
      `<div class="tab-pane gl-pane${t.id === initialTab ? '' : ' hidden'}" id="gl-tab-${t.id}" role="tabpanel">${placeholder(t.id, students.length)}</div>`,
  ).join('');

  let model: GroupModel | null = null;
  const rendered = new Set<TabId>();
  let active: TabId = initialTab;
  let root: HTMLElement | null = null;
  const observaties = () => Store.getObservatiesSync() as Observatie[];

  function render(tab: TabId) {
    if (!model || !root || rendered.has(tab)) return;
    const pane = root.querySelector<HTMLElement>(`#gl-tab-${tab}`);
    if (!pane) return;
    rendered.add(tab);
    if (tab === 'resultaten') pane.innerHTML = resultatenHtml(model, nameOf);
    else if (tab === 'cijferverdeling') pane.innerHTML = verdelingHtml(model);
    else if (tab === 'boxplot') pane.innerHTML = boxHtml(model, nameOf);
    else if (tab === 'observaties') {
      pane.innerHTML = observatiesHtml(model, observaties());
      fitHeat(pane);
      const wrap = pane.querySelector('.ov-heat-wrap');
      if (wrap) new ResizeObserver(() => fitHeat(pane)).observe(wrap);
    } else pane.innerHTML = rttiHtml(model, Math.max(400, pane.clientWidth - 38));
    applyStyleData(pane);
  }

  function show(tab: TabId) {
    active = tab;
    root
      ?.querySelectorAll<HTMLElement>('.gl-pane')
      .forEach((p) => p.classList.toggle('hidden', p.id !== `gl-tab-${tab}`));
    render(tab);
  }

  const dialog = openModal({
    key: 'group-overview',
    title: group.name,
    badge: (group.schoolsoort ?? []).join(', ') || undefined,
    subtitle: subtitle('…'),
    size: 'xl',
    fixedHeight: true,
    className: 'modal-group-overview',
    tabs: TABS,
    activeTab: initialTab,
    body: panes,
    onTab: (id: string) => show(id as TabId),
    onShow: (el: HTMLElement) => {
      root = el;
      const reopen = () => openGroupStudentsModal(groupId, year, active);
      // A refresh loads first, then swaps the window (review 29 m4); on a failed load the
      // current window stays.
      const refresh = modalRefresher(async () => {
        const data = await loadGroupData(group, students, year).catch(() => null);
        if (data) await openGroupStudentsModal(groupId, year, active, data);
      });
      onModalSync('scores', (ev: { year: string; subject: string; id: string }) => {
        if (ev.year !== year || ev.subject !== Store.getActiveSubject()) return;
        if (group.student_ids.some((id) => String(id) === ev.id)) refresh();
      });
      onModalSync('exam', (ev: { year: string }) => {
        if (ev.year === year) refresh();
      });
      onModalSync('group', async (ev: { id: string; year: string; after?: unknown }) => {
        if (ev.id !== groupId || ev.year !== year) return;
        const who = await changedByName(ev);
        if (!ev.after) showReloadNotice(`Deze groep is verwijderd door ${who}.`, closeModal);
        else
          showReloadNotice(
            `Deze groep is gewijzigd door ${who}. Het venster wordt opnieuw geladen.`,
            reopen,
          );
      });
      onModalSync('students', (ev: { year: string; before?: Student[]; after?: Student[] }) => {
        if (ev.year !== year) return;
        const changed = group.student_ids.some((id) => {
          const [before, after] = studentVersions(ev, String(id));
          return before !== after;
        });
        if (!changed) return;
        showReloadNotice(
          'Leerlinggegevens zijn gewijzigd door een collega. Het venster wordt opnieuw geladen.',
          reopen,
        );
      });
      el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
          '[data-action="open-student-from-group"]',
        );
        // Stacks on this overview: closing the profile returns here.
        if (b?.dataset.id) void openProfielModal(b.dataset.id, students);
      });
      const tips = installGradeTips(el, (key) => {
        const [i, j] = key.split('|').map(Number);
        const row = model?.rows[i!];
        const col = model?.columns[j!];
        if (!row || !col) return null;
        const byId = new Map(observaties().map((o) => [o.id, o]));
        return cellTip(col, row.cells[j!]!, byId);
      });
      onModalCleanup(tips);
    },
  });

  void docentLine(group).then((d) => {
    const sub = dialog.el.querySelector('.dlg-subtitle');
    if (sub) sub.textContent = subtitle(d);
  });

  let data: GroupData;
  try {
    data = prefetched ?? (await loadGroupData(group, students, year));
  } catch {
    if (dialog.isOpen)
      dialog.el
        .querySelectorAll<HTMLElement>('[role="tabpanel"]')
        .forEach((p) => (p.innerHTML = emptyHtml(LOAD_FAILED)));
    return;
  }
  if (!dialog.isOpen) return;
  model = buildGroupModel({ group, students, ...data });
  render(active);
}
