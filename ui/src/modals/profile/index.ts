// SPDX-License-Identifier: AGPL-3.0-or-later

// The student profile (F-25; design spec 4.15, board 44): tabs Cijferverloop and Analyse on a
// tinted body, footer "← Vorige (<naam>)" and "Volgende (<naam>) →" through the list it was
// opened from. From an overview it stacks on top, so closing returns there; Vorige/Volgende
// replace it in place. New scores and exam edits refresh it silently on the same tab. R-05: was
// modals/profiel.js (Chart.js); now HTML and CSS like the other overviews.

import { closeModal, modalRefresher, onModalSync, openModal, showReloadNotice } from '../../app.js';
import type { Dialog } from '../../components/dialog';
import { skelBlock, skelRegion } from '../../components/skeleton';
import type { Student } from '../../domain/types';
import { applyStyleData } from '../../legacy/style-data';
import { examBadgeHtml } from '../../overview/common';
import { installGradeTips } from '../../overview/tooltip';
import { leerlingenState } from '../../screens/leerlingen';
import { Store } from '../../store.js';
import { esc } from '../../utils/html';
import { obsTableHtml, rttiCardsHtml } from './analyse';
import {
  BAR_LEGEND,
  barsHtml,
  barTip,
  dumbLegend,
  dumbRowHtml,
  axisRowHtml,
  inBouw,
  toggleHtml,
  yearRowsHtml,
  type Bouw,
} from './cijferverloop';
import { examStats, loadProfile, yearComparisons, type ProfileData } from './data';

type TabId = 'cijferverloop' | 'analyse';

interface WatchOptions {
  studentId: string;
  year: string;
  peers: Peer[] | null;
  activeTab: TabId;
}

/** A student of the list the profile was opened from. */
export interface Peer {
  id: string;
}

/** Keep an open profile up to date; a change to the student's own record needs a notice. */
function watchProfile(dialog: Dialog & { activeTab?: string }, o: WatchOptions) {
  const currentTab = () => (dialog.activeTab ?? o.activeTab) as TabId;
  const reopen = () => openProfielModal(o.studentId, o.peers, currentTab());
  const refresh = modalRefresher(reopen);
  onModalSync('scores', (ev: { id: string; subject: string }) => {
    if (ev.id === String(o.studentId) && ev.subject === Store.getActiveSubject()) refresh();
  });
  onModalSync('exam', (ev: { subject: string }) => {
    if (ev.subject === Store.getActiveSubject()) refresh();
  });
  onModalSync('students', (ev: { year: string; before?: Student[]; after?: Student[] }) => {
    if (ev.year !== o.year) return;
    const find = (list?: Student[]) =>
      JSON.stringify((list ?? []).find((s) => s.id === o.studentId) ?? null);
    const after = find(ev.after);
    if (find(ev.before) === after) return;
    if (after === 'null')
      showReloadNotice('Deze leerling is verwijderd door een collega.', closeModal);
    else
      showReloadNotice(
        'De gegevens van deze leerling zijn gewijzigd door een collega. Het venster wordt opnieuw geladen.',
        reopen,
      );
  });
}

function subtitle(d: ProfileData): string {
  const s = d.student;
  const vak = (Store.SUBJECT_DISPLAY as Record<string, string>)[Store.getActiveSubject() as string];
  return [
    String(s.id),
    d.currentJaarlaag ? `jaarlaag ${d.currentJaarlaag}` : '',
    (s.schoolsoort ?? []).join(' / '),
    vak ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const card = (title: string, tools: string, body: string, cls = '') =>
  `<div class="ov-card pf-card${cls}"><div class="ov-card__head"><h3 class="ov-card__h3">${esc(title)}</h3><span class="ov-card__spacer"></span>${tools}</div>${body}</div>`;

/**
 * Opens a student's profile.
 * @param peers the list it was opened from (Vorige/Volgende), or null.
 */
export async function openProfielModal(
  studentId: string,
  peers: Peer[] | null = null,
  activeTab: TabId = 'cijferverloop',
): Promise<void> {
  const year = (leerlingenState.year || Store.getConfigSync().activeYear) as string;
  const d = await loadProfile(studentId, year);
  if (!d) return;
  const name = Store.fullName(d.student) as string;
  const first = d.student.voornaam || name;

  const idx = peers && peers.length > 1 ? peers.findIndex((p) => p.id === studentId) : -1;
  const prev = idx > 0 ? peers![idx - 1]! : null;
  const next = idx >= 0 && idx < peers!.length - 1 ? peers![idx + 1]! : null;
  const footerHtml =
    (prev
      ? `<button class="btn btn--secondary" id="prof-prev" data-align="start">← Vorige (${esc(Store.fullName(prev as Partial<Student>))})</button>`
      : '') +
    (next
      ? `<button class="btn btn--secondary" id="prof-next">Volgende (${esc(Store.fullName(next as Partial<Student>))}) →</button>`
      : '');

  if (!d.history.length) {
    openModal({
      key: 'profile',
      title: name,
      badge: d.student.stamklas ?? '',
      subtitle: subtitle(d),
      className: 'modal-profile',
      bodyClass: 'dlg-body--tinted',
      footerHtml,
      body: '<p class="hint">Nog geen scores voor deze leerling.</p>',
      onShow: (el: HTMLElement, dialog: Dialog) => {
        watchProfile(dialog, { studentId, year, peers, activeTab });
        wireFooter(el, dialog);
      },
    });
    return;
  }

  const yearLabel = (yr: string) => {
    const jl = d.jaarlaagByYear[yr];
    return jl ? `${yr} · jaarlaag ${jl}` : yr;
  };
  const lastYear = d.years[d.years.length - 1]!;
  let bouw: Bouw = d.currentJaarlaag >= 4 ? 'bovenbouw' : 'onderbouw';
  let jaar = lastYear;
  let rttiKey = lastYear;
  const yearOptions = d.years.map((yr): [string, string] => [yr, yr]);
  const rendered = new Set<TabId>();
  let root: HTMLElement | null = null;
  let barTests = d.counted.filter((t) => inBouw(t, bouw));

  function wireFooter(el: HTMLElement, dialog: Dialog & { activeTab?: string }) {
    el.querySelector('#prof-prev')?.addEventListener('click', () =>
      openProfielModal(prev!.id, peers, (dialog.activeTab ?? activeTab) as TabId),
    );
    el.querySelector('#prof-next')?.addEventListener('click', () =>
      openProfielModal(next!.id, peers, (dialog.activeTab ?? activeTab) as TabId),
    );
  }

  const fill = (host: HTMLElement | null | undefined, html: string) => {
    if (!host) return;
    host.innerHTML = html;
    applyStyleData(host);
  };

  function renderBars() {
    barTests = d!.counted.filter((t) => inBouw(t, bouw));
    fill(root?.querySelector<HTMLElement>('.pf-bars-host'), barsHtml(barTests, yearLabel));
  }

  /** The per-test rows of a school year; the averages are read per test. */
  async function renderTests() {
    const host = root?.querySelector<HTMLElement>('.pf-tests-host');
    if (!host) return;
    const key = jaar;
    const tests = d!.attempts.filter((t) => t.exam.academic_year === key);
    if (!tests.length)
      return fill(host, '<p class="hint ov-empty">Geen cijfers in dit schooljaar.</p>');
    const rows: string[] = [];
    for (const t of tests) {
      const s = await examStats(key, t.exam);
      rows.push(
        dumbRowHtml(
          `${examBadgeHtml(t.exam)}<span class="pf-dumb__title">${esc(t.exam.title ?? '')}</span>`,
          t.res.grade,
          s,
          'Toetsgemiddelde',
          first,
        ),
      );
    }
    if (key === jaar && host.isConnected) fill(host, rows.join('') + axisRowHtml());
  }

  function render(tab: TabId) {
    if (!root || rendered.has(tab)) return;
    const pane = root.querySelector<HTMLElement>(`#tab-${tab}`);
    if (!pane) return;
    rendered.add(tab);
    if (tab === 'cijferverloop') {
      pane.innerHTML =
        `<div class="ov-stack">` +
        card(
          'Cijferverloop',
          toggleHtml(
            'bouw',
            [
              ['onderbouw', 'Onderbouw'],
              ['bovenbouw', 'Bovenbouw'],
            ],
            bouw,
          ),
          `${BAR_LEGEND}<div class="pf-bars-host"></div>`,
        ) +
        card(
          'Ten opzichte van het toetsgemiddelde',
          toggleHtml('jaar', yearOptions, jaar),
          `${dumbLegend(first, 'Toetsgemiddelde')}<div class="pf-tests-host">${skelBlock(160)}</div>`,
        ) +
        card(
          'Gemiddeld cijfer per jaar, ten opzichte van de jaarlaag',
          '',
          `${dumbLegend(first, 'Jaarlaaggemiddelde')}<div class="pf-years-host">${skelBlock(100)}</div>`,
        ) +
        `</div>`;
      applyStyleData(pane);
      renderBars();
      void renderTests();
      void yearComparisons(d!).then((rows) =>
        fill(
          pane.querySelector<HTMLElement>('.pf-years-host'),
          yearRowsHtml(rows, yearLabel, first),
        ),
      );
    } else {
      pane.innerHTML =
        `<div class="ov-stack">` +
        `<div class="ov-card__head pf-head"><h3 class="ov-card__h3">RTTI-scores per toets</h3><span class="ov-card__spacer"></span>` +
        toggleHtml('rtti', [...yearOptions, ['se', 'Examendossier']], rttiKey) +
        `</div><div class="pf-rtti-host"></div>` +
        card('Observaties per schooljaar', '', obsTableHtml(d!, yearLabel)) +
        `</div>`;
      applyStyleData(pane);
      fill(pane.querySelector<HTMLElement>('.pf-rtti-host'), rttiCardsHtml(d!, rttiKey, yearLabel));
    }
  }

  const select = (btn: HTMLElement) => {
    btn
      .closest('.btn-toggle-group')
      ?.querySelectorAll<HTMLElement>('.pf-tog')
      .forEach((b) => {
        b.classList.toggle('selected', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
  };

  const panes = (['cijferverloop', 'analyse'] as TabId[])
    .map(
      (t) =>
        `<div class="tab-pane pf-pane${t === activeTab ? '' : ' hidden'}" id="tab-${t}" role="tabpanel">` +
        skelRegion(`<div class="ov-stack">${skelBlock(300)}${skelBlock(200)}</div>`) +
        `</div>`,
    )
    .join('');

  openModal({
    key: 'profile',
    title: name,
    badge: d.student.stamklas ?? '',
    subtitle: subtitle(d),
    className: 'modal-profile',
    size: 'xl',
    fixedHeight: true,
    bodyClass: 'dlg-body--tinted',
    tabs: [
      { id: 'cijferverloop', label: 'Cijferverloop' },
      { id: 'analyse', label: 'Analyse' },
    ],
    activeTab,
    onTab: (id: string) => {
      root
        ?.querySelectorAll<HTMLElement>('.pf-pane')
        .forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${id}`));
      render(id as TabId);
    },
    footerHtml,
    body: panes,
    onShow: (el: HTMLElement, dlg: Dialog) => {
      root = el;
      watchProfile(dlg, { studentId, year, peers, activeTab });
      wireFooter(el, dlg);
      installGradeTips(el, (key) => {
        const t = key.startsWith('b') ? barTests[Number(key.slice(1))] : undefined;
        return t ? barTip(t) : null;
      });
      el.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('.pf-tog');
        if (!btn) return;
        select(btn);
        if (btn.dataset.bouw) {
          bouw = btn.dataset.bouw === 'bovenbouw' ? 'bovenbouw' : 'onderbouw';
          renderBars();
        } else if (btn.dataset.jaar) {
          jaar = btn.dataset.jaar;
          void renderTests();
        } else if (btn.dataset.rtti) {
          rttiKey = btn.dataset.rtti;
          fill(
            el.querySelector<HTMLElement>('.pf-rtti-host'),
            rttiCardsHtml(d, rttiKey, yearLabel),
          );
        }
      });
    },
  });
  render(activeTab);
}
