// SPDX-License-Identifier: AGPL-3.0-or-later

// The exam overview modal (F-11; design spec 4.6, board 46; PLAN-2 decisions 35, 36): tabs
// Resultaten, Cijferverdeling, Boxplot cijfers, Vraaganalyse, RTTI-analyse and Observaties, each
// rendered when first opened. The verzameloverzicht (best attempt over the original and its
// resits, computed by the caller) is the same modal with the last three tabs disabled. R-05:
// was modals/toets-overzicht.js.

import { closeModal, modalRefresher, onModalSync, openModal, showReloadNotice } from '../../app.js';
import { skelBlock, skelRegion, skelRows } from '../../components/skeleton';
import { formatFixed } from '../../domain/format';
import { gradeBarColor } from '../../domain/grade-colors';
import { stats } from '../../domain/statistics';
import type { Exam, ScoreRecord, Student } from '../../domain/types';
import { applyStyleData } from '../../legacy/style-data';
import { emptyHtml, examBadgeHtml, LOAD_FAILED } from '../../overview/common';
import { keepNameColumnFitted } from '../../overview/fit-name';
import type { HistStep } from '../../overview/histogram';
import { Store } from '../../store.js';
import { examGroups, groupStudentsOf } from '../../screens/scores/roster';
import { openProfielModal } from '../profile';
import { allHistHtml, boxHtml, verdelingHtml, vraagHtml } from './charts';
import { loadExamOverview, type BestEntry, type ExamOverviewData } from './data';
import { resultatenHtml } from './resultaten';
import { observatiesHtml, rttiHtml, verloopHtml, verloopPoints } from './rtti-obs';

type TabId =
  'resultaten' | 'cijferverdeling' | 'boxplots' | 'vraaganalyse' | 'rtti-analyse' | 'observaties';

const ONLY_INDIVIDUAL =
  'Dit tabblad is alleen beschikbaar voor individuele toetsen, niet voor het verzameloverzicht.';

function summaryHtml(data: ExamOverviewData): string {
  const s = data.grades.length ? stats(data.grades) : null;
  if (!s) return '<p class="hint xo-summary">Nog geen scores ingevoerd.</p>';
  return (
    `<p class="xo-summary">${data.grades.length} leerlingen · <span class="xo-summary__dot" data-bg="${gradeBarColor(s.mean)}"></span>` +
    ` <b>${formatFixed(s.mean)}</b> ± ${formatFixed(s.sd)} · ${s.fails}% onvoldoende</p>`
  );
}

/** @param scoreOverride per student: the attempt that counts (the verzameloverzicht). */
export async function openExamOverviewModal(
  examId: string,
  year: string,
  scoreOverride: Record<string, BestEntry> | null = null,
  isSummary = false,
  initialTab: TabId = 'resultaten',
): Promise<void> {
  const exam = ((await Store.getExams(year)) as Exam[]).find((e) => e.id === examId);
  if (!exam) return;
  const nameOf = (s: Student) => Store.fullName(s) as string;
  const tabs = (
    [
      { id: 'resultaten', label: 'Resultaten' },
      { id: 'cijferverdeling', label: 'Cijferverdeling' },
      { id: 'boxplots', label: 'Boxplot cijfers' },
      { id: 'vraaganalyse', label: 'Vraaganalyse' },
      { id: 'rtti-analyse', label: 'RTTI-analyse' },
      { id: 'observaties', label: 'Observaties' },
    ] as { id: TabId; label: string; disabled?: boolean; title?: string }[]
  ).map((t, i) => (isSummary && i >= 3 ? { ...t, disabled: true, title: ONLY_INDIVIDUAL } : t));
  const start: TabId =
    isSummary && tabs.find((t) => t.id === initialTab)?.disabled ? 'resultaten' : initialTab;

  const panes = tabs
    .map(
      (t) =>
        `<div class="tab-pane xo-pane${t.id === start ? '' : ' hidden'}" id="tab-${t.id}" role="tabpanel">` +
        skelRegion(
          t.id === 'resultaten'
            ? `<div class="ov-stack">${skelRows(12, 29)}</div>`
            : `<div class="ov-stack">${skelBlock(240)}${skelBlock(180)}</div>`,
        ) +
        `</div>`,
    )
    .join('');

  let data: ExamOverviewData | null = null;
  let root: HTMLElement | null = null;
  let step: HistStep = 0.5;
  const rendered = new Set<TabId>();

  function render(tab: TabId) {
    if (!data || !root || rendered.has(tab)) return;
    const pane = root.querySelector<HTMLElement>(`#tab-${tab}`);
    if (!pane) return;
    rendered.add(tab);
    const d = data;
    if (tab === 'resultaten') {
      const students = d.students;
      const sections = examGroups(exam!, year).map((g) => ({
        name: `Groep ${g.name}`,
        students: groupStudentsOf(g, students),
      }));
      pane.innerHTML = resultatenHtml(d, sections, nameOf);
      keepNameColumnFitted(pane);
    } else if (tab === 'cijferverdeling') pane.innerHTML = verdelingHtml(d, step);
    else if (tab === 'boxplots') pane.innerHTML = boxHtml(d, nameOf);
    else if (tab === 'vraaganalyse') pane.innerHTML = vraagHtml(d);
    else if (tab === 'observaties') pane.innerHTML = observatiesHtml(d);
    else {
      pane.innerHTML = rttiHtml(d);
      const host = pane.querySelector<HTMLElement>('.xo-verloop__chart');
      if (host) {
        const width = host.clientWidth;
        const current = exam!.parent_id ?? exam!.id;
        void verloopPoints(
          Store.getExamsSync(year) as Exam[],
          String(exam!.jaarlaag ?? ''),
          d.students,
          async (s) => (await Store.getStudentScores(s.id, year)) as ScoreRecord | null,
        )
          .then((points) => {
            if (!host.isConnected) return;
            host.innerHTML = verloopHtml(points, width, current);
            applyStyleData(host);
          })
          .catch(() => {
            if (host.isConnected) host.innerHTML = emptyHtml(LOAD_FAILED);
          });
      }
    }
    applyStyleData(pane);
  }

  function show(tab: TabId) {
    root
      ?.querySelectorAll<HTMLElement>('.xo-pane')
      .forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
    render(tab);
  }

  const dialog = openModal({
    key: 'exam-overview',
    leadHtml: exam.volgnummer ? examBadgeHtml(exam) : '',
    title: `Overzicht: ${exam.title ?? ''}`,
    subtitle: `Jaarlaag ${exam.jaarlaag ?? ''} · ${year}`,
    size: 'xl',
    fixedHeight: true,
    className: 'modal-exam-overview',
    tabs,
    activeTab: start,
    body: `<div class="xo-summary-host"><p class="xo-summary">&nbsp;</p></div>${panes}`,
    onTab: (id: string) => show(id as TabId),
    onShow: (el: HTMLElement) => {
      root = el;
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const name = t.closest<HTMLButtonElement>('[data-action="open-student-from-exam"]');
        if (name?.dataset.id) {
          const peers = data?.students.filter((s) => data!.byStudent.has(String(s.id))) ?? null;
          void openProfielModal(name.dataset.id, peers);
          return;
        }
        const bin = t.closest<HTMLButtonElement>('.hist-bin-btn');
        if (bin && data) {
          step = Number(bin.dataset.bin) === 1 ? 1 : 0.5;
          const host = el.querySelector<HTMLElement>('.xo-hist-all');
          if (host) {
            host.innerHTML = allHistHtml(data, step);
            applyStyleData(host);
          }
        }
      });
      // Background changes: new scores or edits of this exam refresh the overview silently on
      // the same tab. (The verzameloverzicht is computed by the caller, so it is not refreshed.)
      if (!scoreOverride) {
        const currentTab = () => (dialog.activeTab ?? 'resultaten') as TabId;
        const refresh = modalRefresher(() =>
          openExamOverviewModal(examId, year, null, isSummary, currentTab()),
        );
        onModalSync('scores', (ev: { year: string; subject: string }) => {
          if (ev.year === year && ev.subject === Store.getActiveSubject()) refresh();
        });
        onModalSync('exam', (ev: { id: string; year: string; after?: unknown }) => {
          if (ev.id !== examId || ev.year !== year) return;
          if (ev.after) refresh();
          else showReloadNotice('Deze toets is verwijderd door een collega.', closeModal);
        });
      }
    },
  });

  try {
    data = await loadExamOverview(exam, year, scoreOverride, isSummary);
  } catch {
    if (dialog.isOpen)
      dialog.el
        .querySelectorAll<HTMLElement>('.xo-pane')
        .forEach((p) => (p.innerHTML = emptyHtml(LOAD_FAILED)));
    return;
  }
  if (!dialog.isOpen) return;
  const summary = dialog.el.querySelector<HTMLElement>('.xo-summary-host');
  if (summary) {
    summary.innerHTML = summaryHtml(data);
    applyStyleData(summary);
  }
  render(dialog.activeTab as TabId);
}
