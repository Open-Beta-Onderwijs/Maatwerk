// SPDX-License-Identifier: AGPL-3.0-or-later

// The PO overview modal (F-24; design spec 4.14, board 43): tabs Resultaten (Per klas / Per
// projectgroep), Cijferverdeling, Boxplot, Categorieën and Observaties, each rendered when first
// opened. Opened from "Overzicht openen" on a PO card; a PO herkansing opens it for its own
// attempt (a PO verzameloverzicht is not designed yet: backlog).

import { closeModal, modalRefresher, onModalSync, openModal, showReloadNotice } from '../../app.js';
import { skelBlock, skelRegion, skelRows } from '../../components/skeleton';
import { checkRubric, totalsText } from '../../domain/rubric';
import type { Observatie, Student } from '../../domain/types';
import { applyStyleData } from '../../legacy/style-data';
import { examBadgeHtml } from '../../overview/common';
import { keepNameColumnFitted } from '../../overview/fit-name';
import type { HistStep } from '../../overview/histogram';
import { installGradeTips } from '../../overview/tooltip';
import { Store } from '../../store.js';
import { loadPoContext } from '../po-scores';
import { openProfielModal } from '../profile';
import { allHistHtml, boxHtml, categorieenHtml, observatiesHtml, verdelingHtml } from './charts';
import { buildPoModel, type PoModel } from './model';
import { poCellTip, resultatenHtml, type PoView } from './resultaten';

type TabId = 'resultaten' | 'cijferverdeling' | 'boxplot' | 'categorieen' | 'observaties';

const TABS: { id: TabId; label: string }[] = [
  { id: 'resultaten', label: 'Resultaten' },
  { id: 'cijferverdeling', label: 'Cijferverdeling' },
  { id: 'boxplot', label: 'Boxplot' },
  { id: 'categorieen', label: 'Categorieën' },
  { id: 'observaties', label: 'Observaties' },
];

function subtitle(m: PoModel, year: string): string {
  const parts = [`Jaarlaag ${m.exam.jaarlaag ?? ''}`, year];
  if (m.rubric)
    parts.push(`rubric ${m.rubric.naam}`, totalsText(checkRubric(m.rubric).totals, 'card'));
  const g = m.groups.length;
  parts.push(`${g} ${g === 1 ? 'projectgroep' : 'projectgroepen'}`);
  parts.push(`${m.placed.length} ${m.placed.length === 1 ? 'leerling' : 'leerlingen'}`);
  return parts.join(' · ');
}

export async function openPoOverviewModal(
  examId: string,
  year: string,
  initialTab: TabId = 'resultaten',
  initialView: PoView = 'klas',
): Promise<void> {
  const ctx = await loadPoContext(examId, year);
  if (!ctx) return;
  const model = buildPoModel({
    exam: ctx.exam,
    rubric: ctx.rubric,
    students: ctx.students,
    records: ctx.records,
    classTag: ctx.classTag,
    name: ctx.name,
    results: (rec) => Store.examResults(rec, ctx.exam),
  });
  const allObs = Store.getObservatiesSync() as Observatie[];
  let view: PoView = initialView;
  let step: HistStep = 0.5;
  const rendered = new Set<TabId>();
  let root: HTMLElement | null = null;

  const panes = TABS.map(
    (t) =>
      `<div class="tab-pane po-ov-pane${t.id === initialTab ? '' : ' hidden'}" id="tab-${t.id}" role="tabpanel">` +
      skelRegion(
        t.id === 'resultaten'
          ? `<div class="ov-stack">${skelRows(10, 30)}</div>`
          : `<div class="ov-stack">${skelBlock(240)}${skelBlock(180)}</div>`,
      ) +
      `</div>`,
  ).join('');

  function render(tab: TabId, force = false) {
    if (!root || (rendered.has(tab) && !force)) return;
    const pane = root.querySelector<HTMLElement>(`#tab-${tab}`);
    if (!pane) return;
    rendered.add(tab);
    if (tab === 'resultaten') {
      pane.innerHTML = resultatenHtml(model, view);
      keepNameColumnFitted(pane);
    } else if (tab === 'cijferverdeling') pane.innerHTML = verdelingHtml(model, step);
    else if (tab === 'boxplot') pane.innerHTML = boxHtml(model);
    else if (tab === 'categorieen') pane.innerHTML = categorieenHtml(model);
    else pane.innerHTML = observatiesHtml(model, allObs);
    applyStyleData(pane);
  }

  function show(tab: TabId) {
    root
      ?.querySelectorAll<HTMLElement>('.po-ov-pane')
      .forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
    render(tab);
  }

  const { exam } = ctx;
  const dialog = openModal({
    key: 'po-overview',
    leadHtml: exam.volgnummer ? examBadgeHtml(exam) : '',
    title: exam.title ?? '',
    badge: exam.type === 'pta' ? 'SE · praktische opdracht' : 'Praktische opdracht',
    subtitle: subtitle(model, year),
    size: 'xl',
    fixedHeight: true,
    className: 'modal-po-overview',
    tabs: TABS,
    activeTab: initialTab,
    body: panes,
    onTab: (id: string) => show(id as TabId),
    onShow: (el: HTMLElement) => {
      root = el;
      const stopTips = installGradeTips(el, (key) => poCellTip(model, allObs, key));
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const name = t.closest<HTMLElement>('[data-action="open-student-from-po"]');
        if (name?.dataset.id) {
          const peers = model.placed
            .map((r) => ctx.students.get(r.id))
            .filter((s): s is Student => !!s);
          void openProfielModal(name.dataset.id, peers);
          return;
        }
        const v = t.closest<HTMLElement>('.po-ov-view');
        if (v && v.dataset.view !== view) {
          view = v.dataset.view === 'groep' ? 'groep' : 'klas';
          render('resultaten', true);
          return;
        }
        const bin = t.closest<HTMLElement>('.hist-bin-btn');
        if (bin) {
          step = Number(bin.dataset.bin) === 1 ? 1 : 0.5;
          const host = el.querySelector<HTMLElement>('.po-ov-hist-all');
          if (host) {
            host.innerHTML = allHistHtml(model, step);
            applyStyleData(host);
          }
        }
      });
      const currentTab = () => (dialog.activeTab ?? 'resultaten') as TabId;
      const refresh = modalRefresher(() => {
        stopTips();
        return openPoOverviewModal(examId, year, currentTab(), view);
      });
      onModalSync('scores', (ev: { year: string; subject: string; id: string }) => {
        if (ev.year === year && ev.subject === ctx.subject && ctx.records.has(ev.id)) refresh();
      });
      onModalSync('exam', (ev: { id: string; year: string; after?: unknown }) => {
        if (ev.id !== examId || ev.year !== year) return;
        if (ev.after) refresh();
        else showReloadNotice('Deze PO is verwijderd door een collega.', closeModal);
      });
      onModalSync('rubric', () => refresh());
    },
  });
  render(initialTab);
}
