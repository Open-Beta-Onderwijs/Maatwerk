// SPDX-License-Identifier: AGPL-3.0-or-later

// The Toetsen screen (design spec 4.7, F-27): filtering, the cards and stacks (toetsen/cards.ts,
// toetsen/stack.ts), their numbers and warnings, and the ⋮ menu (exam-menu.ts).

import {
  escHtml,
  SEL,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
  getAdminSubjectFilter,
} from '../app.js';
import { resitsOf } from '../domain/attempts';
import { attemptLabel } from '../domain/exam-info';
import { gradeTextColor } from '../domain/grade-colors';
import { TEST_KINDS, testKindBadgeClass } from '../domain/test-type';
import type { Exam, Observatie, ScoreRecord, ScoreValue } from '../domain/types';
import { applyStyleData } from '../legacy/style-data';
import { openExamOverviewModal } from '../modals/exam-overview';
import { openPoOverviewModal } from '../modals/po-overview';
import { openExamModal } from '../modals/toets-edit';
import { openBestGradesOverviewModal } from '../modals/herkansing';
import { openNewPoModal } from '../modals/po-gegevens';
import { openRttiUitlegModal } from '../modals/rtti-uitleg';
import * as Presence from '../presence.js';
import { presenceUser } from '../domain/login';
import { Store } from '../store.js';
import { yieldSlice } from '../utils/idle';
import { afterPaint, perfSpan } from '../utils/perf';
import { addRecords, newBlock, type BlockNumbers } from './toetsen/block-numbers';
import { cardSummary, miniHistogram, topObservaties, type CardNumbers } from './toetsen/card-model';
import { gridHtml, miniHistHtml, periodeNr, type CardKind } from './toetsen/cards';
import { initStacks, toggleStack } from './toetsen/stack';
import { toggleExamMenu } from './exam-menu';

function currentYear(): string {
  return SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
}

export function renderToetsen() {
  const cfg = Store.getConfigSync();
  const years = [...Store.listYearsSync()];
  if (!years.includes(cfg.activeYear)) years.unshift(cfg.activeYear);

  const selected = SEL.toetsenYear.getValue() || cfg.activeYear;
  SEL.toetsenYear.setOptions(years.map((y) => ({ value: y, label: y })));
  SEL.toetsenYear.setValue(years.includes(selected) ? selected : years[0]);

  document.getElementById('btn-add-exam')!.onclick = () => openExamModal(null);
  document.getElementById('btn-add-po')!.onclick = async () => {
    const year = currentYear();
    await Store.loadYear(year);
    openNewPoModal(year);
  };
  document.getElementById('btn-toetsen-rtti-uitleg')!.onclick = () => openRttiUitlegModal();
  renderLegend();
  // Started first: the statistics wait for this one folder read (Step 7c).
  void Store.preloadScores(SEL.toetsenYear.getValue() || cfg.activeYear).catch(() => {});
  return renderToetsenList(); // the tab span ends when the list is in (review 7c n4)
}

/** The five test types, right in the filter row (spec 4.7). */
function renderLegend(): void {
  const legend = document.getElementById('toetsen-legend');
  if (!legend || legend.childElementCount) return;
  legend.innerHTML = TEST_KINDS.map(
    ({ kind, label }) =>
      `<span class="test-legend-item"><span class="${testKindBadgeClass(kind)} test-legend-swatch" aria-hidden="true"></span>${escHtml(label)}</span>`,
  ).join('');
}

interface ScoreProblem {
  name: string;
  issue: 'ongeldig' | 'onvolledig';
}

async function computeExamWarnings(
  year: string,
  exam: Exam,
  current: () => boolean,
): Promise<ScoreProblem[] | null> {
  const students = Store.getStudentsSync(year);
  const problems: ScoreProblem[] = [];
  for (const s of students) {
    await yieldSlice();
    if (!current()) return null; // a newer draw took over (review 33b m1)
    const rec = await Store.getStudentScores(s.id, year);
    const examScores: Record<string, ScoreValue> | undefined = rec?.scores?.[exam.id];
    if (!examScores || Object.keys(examScores).length === 0) continue;
    let filled = 0;
    let invalid = false;
    for (const q of exam.questions) {
      const v = examScores[q.id];
      if (v === undefined) continue; // not entered
      filled++;
      if (v === null) continue; // 'N': valid
      const num = Number(v);
      if (isNaN(num) || num < 0 || num > q.max_points) invalid = true;
    }
    if (invalid) problems.push({ name: Store.fullName(s), issue: 'ongeldig' });
    else if (filled > 0 && filled < exam.questions.length)
      problems.push({ name: Store.fullName(s), issue: 'onvolledig' });
  }
  return problems.length > 0 ? problems : null;
}

const SUBCATEGORY_TO_FILTER: Record<string, string> = {
  onderbouw: 'OB',
  wisa: 'WisA',
  wisb: 'WisB',
  wisc: 'WisC',
  wisd: 'WisD',
};

// ── Presence: colleagues working in an exam's score modal ────────────────────
async function fillExamPresence(): Promise<void> {
  const container = document.getElementById('exam-list');
  const spans = container?.querySelectorAll<HTMLElement>('[data-presence-exam]');
  if (!spans?.length) return;
  const year = SEL.toetsenYear.getValue();
  const subject = Store.getActiveSubject();
  const users: { id: string }[] = await Store.loadUsers();
  spans.forEach((span) => {
    span.innerHTML = Presence.inScoreModal(year, subject, span.dataset.presenceExam)
      .map((o: { userId: string; status: string }) => {
        const user = presenceUser(users, o.userId) as
          { id: string; [k: string]: unknown } | undefined;
        return user
          ? Presence.badgeHtml(user, o.status, `${Store.fullName(user)} werkt hierin`)
          : '';
      })
      .join('');
    void Presence.loadPhotos(span);
  });
}
Presence.onChange(fillExamPresence);

/** The exams of the year that pass the filter bar, in list order. */
function filteredExams(year: string): Exam[] {
  let exams: Exam[] = Store.getExamsSync(year);
  const activeSubject = Store.isAdminActive() ? getAdminSubjectFilter() : Store.getActiveSubject();
  const schoolsoortFilter = getSchoolsoortFilter();
  const jaarlagFilter = getJaarlagFilter();
  const jaarlagKlasFilter = getJaarlagKlasFilter();
  const activeUser = Store.getActiveUser();

  // Schoolsoort filter: always applied; exams without schoolsoort always pass
  exams = exams.filter(
    (e) =>
      !(e.schoolsoort ?? []).length ||
      (e.schoolsoort ?? []).some((ss) => schoolsoortFilter.has(ss)),
  );

  if (activeSubject === 'wi') {
    // Klas 1-6 filter (by numeric jaarlaag)
    exams = exams.filter((e) => jaarlagKlasFilter.has(String(e.jaarlaag ?? '')));
    // Subcategory filter (OB / WisA / WisB / WisC / WisD)
    exams = exams.filter((e) => {
      const filterKey = SUBCATEGORY_TO_FILTER[e.subcategory ?? ''];
      return filterKey ? jaarlagFilter.has(filterKey) : true;
    });
  } else {
    exams = exams.filter((e) => jaarlagFilter.has(String(e.jaarlaag ?? '')));
  }

  // Eigen filter: exam overlaps with at least one of teacher's groups
  if (getEigenOnly() && activeUser && !Store.isAdminActive()) {
    const myGroups: { docenten?: string[]; jaarlaag?: unknown; schoolsoort?: string[] }[] =
      Store.getGroupsSync(year).filter((g: { docenten?: string[] }) =>
        (g.docenten ?? []).includes(activeUser.id),
      );
    exams = exams.filter((e) =>
      myGroups.some(
        (g) =>
          String(g.jaarlaag) === String(e.jaarlaag) &&
          (g.schoolsoort ?? []).some((ss) => (e.schoolsoort ?? []).includes(ss)),
      ),
    );
  }

  const byId = new Map(exams.map((e) => [e.id, e]));
  return exams.sort(
    (a, b) =>
      String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
      // The periodes in reading order (decision 41); the attempts follow their original.
      periodeNr(a.parent_id ? (byId.get(a.parent_id) ?? a) : a) -
        periodeNr(b.parent_id ? (byId.get(b.parent_id) ?? b) : b) ||
      (a.volgnummer ?? 0) - (b.volgnummer ?? 0) ||
      (a.attempt ?? 1) - (b.attempt ?? 1),
  );
}

const problemText = (p: ScoreProblem) =>
  `${p.name} — ${p.issue === 'ongeldig' ? 'ongeldige score' : 'onvolledige scores'}`;

function applyWarning(el: HTMLElement, lines: string[]): void {
  if (!lines.length) {
    el.remove();
    return;
  }
  el.title = lines.join('\n');
  el.hidden = false;
}

/** Bumped on every draw: fills of an older draw must not touch the new list (review 33 m2). */
let generation = 0;

/**
 * The numbers of a test's cards, chunk by chunk of students (one call into the grade rules per
 * chunk, between slices). Null when a newer draw took over (review 33b m1).
 */
async function blockNumbers(
  year: string,
  original: Exam,
  resits: readonly Exam[],
  current: () => boolean,
): Promise<BlockNumbers | null> {
  const block = newBlock([original, ...resits]);
  const students = Store.getStudentsSync(year) as { id: string }[];
  for (let i = 0; i < students.length; i += CHUNK) {
    await yieldSlice();
    if (!current()) return null;
    const recs = (await Promise.all(
      students.slice(i, i + CHUNK).map((s) => Store.getStudentScores(s.id, year)),
    )) as (ScoreRecord | null)[];
    addRecords(block, recs, original, resits);
  }
  return block;
}

/** Students per call into the grade rules. */
const CHUNK = 60;

/** Fills the bottom of a card and its mini histogram. */
function fillCard(card: HTMLElement, numbers: CardNumbers, best: boolean, diagnostic: boolean) {
  const sum = cardSummary(numbers, best);
  card.querySelector('[data-count]')!.textContent = sum.countText;
  const obs = topObservaties(numbers.obs, Store.getObservatiesSync() as Observatie[]);
  card.querySelector('[data-obs]')!.innerHTML = obs
    .map(
      (o) =>
        `<span class="tcard-obs-item" title="${escHtml(o.title)}"><span aria-hidden="true">${escHtml(o.icon)}</span><b>${o.count}</b></span>`,
    )
    .join('');
  const avg = card.querySelector<HTMLElement>('[data-avg]')!;
  const mean = document.createElement('span');
  mean.className = 'tcard-mean';
  const b = document.createElement('b');
  b.textContent = sum.meanText;
  // A diagnostic test counts for nothing: its mean stays grey (spec 4.7).
  if (sum.mean !== null && !diagnostic) b.style.color = gradeTextColor(sum.mean);
  mean.append(b);
  if (sum.mean !== null) mean.append(` ± ${sum.sdText}`);
  const fail = document.createElement('span');
  fail.className = 'tcard-fail';
  fail.textContent = sum.failText;
  avg.replaceChildren(mean, fail);
  const hist = card.querySelector<HTMLElement>('[data-hist]')!;
  const model = miniHistogram(numbers.grades);
  hist.innerHTML = miniHistHtml(model.bars, model.passPct);
  applyStyleData(hist);
}

/** Opens what a card's title button names. */
function openFromCard(btn: HTMLElement): void {
  const id = btn.dataset.examid ?? '';
  const year = currentYear();
  switch (btn.dataset.action) {
    case 'exam-overview':
      void openExamOverviewModal(id, year);
      break;
    case 'po-overview':
      void openPoOverviewModal(id, year);
      break;
    case 'exam-overview-best':
      openBestGradesOverviewModal(id, year);
      break;
  }
}

/** One listener for the whole list (it is redrawn often). */
function wireList(container: HTMLElement): void {
  if (container.dataset.wired) return;
  container.dataset.wired = '1';
  container.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    const action = target.closest<HTMLElement>('[data-action]');
    if (action && container.contains(action)) {
      switch (action.dataset.action) {
        case 'exam-menu':
          void toggleExamMenu(action, SEL.toetsenYear.getValue());
          return;
        case 'exam-attempts':
          toggleStack(container, action.dataset.examid ?? '');
          return;
        default:
          openFromCard(action);
          return;
      }
    }
    // A click anywhere else on a card opens its overview (decision 41), not on a selection.
    const card = target.closest<HTMLElement>('.tcard--link');
    if (!card || target.closest('a, button, input') || window.getSelection()?.toString()) return;
    const title = card.querySelector<HTMLElement>('.tcard-title[data-action]');
    if (title) openFromCard(title);
  });
}

/** Sections per jaarlaag: label and grid. */
function listHtml(exams: Exam[], attemptsOf: (e: Exam) => Exam[]): string {
  const originals = exams.filter((e) => !e.parent_id);
  const byJl = new Map<string, Exam[]>();
  for (const e of originals) {
    const jl = String(e.jaarlaag ?? '—');
    if (!byJl.has(jl)) byJl.set(jl, []);
    byJl.get(jl)!.push(e);
  }
  return [...byJl]
    .map(
      ([jl, list]) =>
        `<section class="tsection"><h3 class="tsection-label">Jaarlaag ${escHtml(jl)}</h3>${gridHtml(list, attemptsOf)}</section>`,
    )
    .join('');
}

export async function renderToetsenList() {
  const year: string = SEL.toetsenYear.getValue();
  const exams = filteredExams(year);
  const container = document.getElementById('exam-list')!;
  const gen = ++generation;
  const current = () => gen === generation;
  // A stack holds every resit of the year, as the verzameloverzicht it opens (review 33 m5).
  const all: Exam[] = Store.getExamsSync(year);
  const attemptsOf = (e: Exam) => resitsOf(all, e.id);
  container.classList.add('tlist');
  wireList(container);

  if (exams.length === 0) {
    container.innerHTML = `<p class="hint">Geen toetsen voor ${escHtml(year)}.</p>`;
    return;
  }

  container.innerHTML = listHtml(exams, attemptsOf);
  applyStyleData(container);
  initStacks(container);
  void fillExamPresence();
  // The cards with their placeholders paint first; the numbers follow in slices (perf hotfix
  // 0.24.1: computed at once they held the first paint back for seconds on a school laptop).
  void afterPaint()
    .then(() => (current() ? fillNumbers(year, exams, attemptsOf, container, current) : undefined))
    .catch((e) => console.warn('[toetsen] cijfers', e));
}

/**
 * Fills the numbers and warnings of the cards of one draw, in the background: one test after the
 * other in reading order, so the first cards fill first (review 33b n2). A failed read leaves the
 * rest going and no placeholder behind.
 */
async function fillNumbers(
  year: string,
  exams: Exam[],
  attemptsOf: (e: Exam) => Exam[],
  container: HTMLElement,
  current: () => boolean,
): Promise<void> {
  const endStats = perfSpan('toetsen:stats');
  const cardEl = (id: string, kind: CardKind) =>
    container.querySelector<HTMLElement>(
      `.tcard[data-exam-card="${CSS.escape(id)}"][data-kind="${kind}"]`,
    );
  for (const e of exams.filter((x) => !x.parent_id)) {
    if (!current()) return;
    const resits = attemptsOf(e);
    const stack = resits.length > 0;
    try {
      const numbers = await blockNumbers(year, e, resits, current);
      if (!numbers || !current()) return;
      if (stack) {
        const card = cardEl(e.id, 'summary');
        if (card) fillCard(card, numbers.summary, true, !!e.diagnostic);
      }
      for (const a of [e, ...resits]) {
        const card = cardEl(a.id, stack ? 'attempt' : 'solo');
        if (card) fillCard(card, numbers.per.get(a.id)!, false, !!a.diagnostic);
      }
    } catch (err) {
      console.warn('[toetsen] cijfers', e.id, err);
    }
    try {
      const list: { a: Exam; problems: ScoreProblem[] }[] = [];
      for (const a of [e, ...resits]) {
        const problems = await computeExamWarnings(year, a, current);
        if (!current()) return;
        list.push({ a, problems: problems ?? [] });
      }
      for (const { a, problems } of list) {
        const el = container.querySelector<HTMLElement>(
          `.exam-warning[data-examid="${CSS.escape(a.id)}"]`,
        );
        if (el) applyWarning(el, problems.map(problemText));
      }
      const summary = container.querySelector<HTMLElement>(
        `.exam-warning[data-summary-warning="${CSS.escape(e.id)}"]`,
      );
      if (summary)
        applyWarning(
          summary,
          list.flatMap(({ a, problems }) =>
            problems.map((p) => `${attemptLabel(a)}: ${problemText(p)}`),
          ),
        );
    } catch (err) {
      console.warn('[toetsen] waarschuwingen', e.id, err);
    }
  }
  if (!current()) return;
  // A read that failed leaves no placeholder behind.
  container.querySelectorAll('.tcard [data-avg]:has(> .skel)').forEach((el) => {
    el.replaceChildren();
  });
  container.querySelectorAll('.tcard [data-count]:has(> .skel)').forEach((el) => {
    el.replaceChildren();
  });
  endStats();
}
