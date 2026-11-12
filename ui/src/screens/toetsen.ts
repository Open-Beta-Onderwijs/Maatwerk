// SPDX-License-Identifier: AGPL-3.0-or-later

// The Toetsen screen (design spec 4.7): filtering, the cards (exam-cards.ts),
// their statistics and warnings, and the ⋮ menu (exam-menu.ts).

import {
  escHtml,
  SEL,
  getSchoolsoortFilter,
  getJaarlagFilter,
  getJaarlagKlasFilter,
  getEigenOnly,
  getAdminSubjectFilter,
} from '../app.js';
import { formatFixed, parseDecimalLoose } from '../domain/format';
import { gradeTextColor } from '../domain/grade-colors';
import { mean, stats } from '../domain/statistics';
import { TEST_KINDS, testKindBadgeClass } from '../domain/test-type';
import type { Exam, ScoreValue } from '../domain/types';
import { applyStyleData } from '../legacy/style-data';
import { openExamOverviewModal } from '../modals/toets-overzicht.js';
import { openExamModal } from '../modals/toets-edit';
import { openBestGradesOverviewModal } from '../modals/herkansing';
import { openNewPoModal } from '../modals/po-gegevens';
import { openRttiUitlegModal } from '../modals/rtti-uitleg';
import * as Presence from '../presence.js';
import { Store } from '../store.js';
import { perfSpan } from '../utils/perf';
import { examBlock, setAttemptsOpen } from './exam-cards';
import { toggleExamMenu } from './exam-menu';

/** What a stats line shows. */
interface ExamStats {
  n: number;
  avgG: string;
  sd: string;
  fails: number;
}

/** Trees the teacher closed; for this session only (open by default, spec 4.7). */
const closedAttempts = new Set<string>();

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

export async function computeExamStats(year: string, exam: Exam) {
  const students = Store.getStudentsSync(year);
  const { normalMax } = Store.calcResults(exam, {});
  const grades: number[] = [];
  const points: number[] = [];
  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    const res = Store.examResults(rec, exam);
    if (res && res.grade !== null) {
      grades.push(res.grade);
      // Only an overwritten grade, no scores: no points to average
      if (Object.keys(rec.scores?.[exam.id] ?? {}).length) points.push(res.scored);
    }
  }
  const st = stats(grades);
  if (!st) return null;
  const avgPts = mean(points);
  return {
    n: st.n,
    avgPts: avgPts === null ? '—' : formatFixed(avgPts),
    avgG: formatFixed(st.mean),
    sd: formatFixed(st.sd),
    fails: st.fails,
    normalMax,
  };
}

interface ScoreProblem {
  name: string;
  issue: 'ongeldig' | 'onvolledig';
}

async function computeExamWarnings(year: string, exam: Exam): Promise<ScoreProblem[] | null> {
  const students = Store.getStudentsSync(year);
  const problems: ScoreProblem[] = [];
  for (const s of students) {
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

async function computeBestGradeStats(parentId: string, year: string): Promise<ExamStats | null> {
  const bestMap: Record<string, { grade: number }> = await Store.computeBestGradeMap(
    parentId,
    year,
  );
  const st = stats(Object.values(bestMap).map((e) => e.grade));
  if (!st) return null;
  return { n: st.n, avgG: formatFixed(st.mean), sd: formatFixed(st.sd), fails: st.fails };
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
        const user = users.find((u) => u.id === o.userId);
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

  return exams.sort(
    (a, b) =>
      String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
      (a.volgnummer ?? 0) - (b.volgnummer ?? 0) ||
      (a.attempt ?? 1) - (b.attempt ?? 1),
  );
}

function applyStats(el: HTMLElement, st: ExamStats | null, diagnostic: boolean): void {
  if (!st) {
    el.remove();
    return;
  }
  const b = document.createElement('b');
  b.textContent = st.avgG;
  // A diagnostic test counts for nothing: its mean stays grey (spec 4.7).
  if (!diagnostic) b.style.color = gradeTextColor(parseDecimalLoose(st.avgG));
  const rest = document.createElement('span');
  rest.className = 'muted';
  rest.textContent = ` ± ${st.sd} · ${st.fails}% onvoldoende`;
  el.replaceChildren(b, rest);
}

function applyWarning(el: HTMLElement, problems: ScoreProblem[] | null): void {
  if (!problems) {
    el.remove();
    return;
  }
  el.title = problems
    .map((p) => `${p.name} — ${p.issue === 'ongeldig' ? 'ongeldige score' : 'onvolledige scores'}`)
    .join('\n');
  el.style.display = 'inline';
}

export async function renderToetsenList() {
  const year: string = SEL.toetsenYear.getValue();
  const exams = filteredExams(year);
  const container = document.getElementById('exam-list')!;

  if (exams.length === 0) {
    container.innerHTML = `<p class="hint">Geen toetsen voor ${escHtml(year)}.</p>`;
    return;
  }

  const originals = exams.filter((e) => !e.parent_id);
  const resitsByParent: Record<string, Exam[]> = {};
  for (const e of exams) {
    if (e.parent_id) (resitsByParent[e.parent_id] ??= []).push(e);
  }
  const resitsOf = (e: Exam) => resitsByParent[e.id] ?? [];

  let html = '';
  let lastJl: string | null = null;
  for (const e of originals) {
    const jl = String(e.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    html += examBlock(e, resitsOf(e), !closedAttempts.has(e.id));
  }
  container.innerHTML = html;
  applyStyleData(container);
  void fillExamPresence();

  // ── Event listeners ────────────────────────────────────────────────────────
  const buttons = (action: string) =>
    container.querySelectorAll<HTMLElement>(`[data-action="${action}"]`);
  buttons('exam-menu').forEach((b) =>
    b.addEventListener('click', () => void toggleExamMenu(b, year)),
  );
  buttons('exam-overview').forEach((b) =>
    b.addEventListener('click', () => openExamOverviewModal(b.dataset.examid, currentYear())),
  );
  buttons('exam-overview-best').forEach((b) =>
    b.addEventListener('click', () =>
      openBestGradesOverviewModal(b.dataset.examid ?? '', currentYear()),
    ),
  );
  buttons('exam-attempts').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.examid ?? '';
      const open = closedAttempts.has(id);
      if (open) closedAttempts.delete(id);
      else closedAttempts.add(id);
      setAttemptsOpen(b, open);
    }),
  );

  // ── Fill stats and warnings asynchronously ─────────────────────────────────
  const endStats = perfSpan('toetsen:stats');
  const fills: Promise<void>[] = [];
  const statsSlot = (id: string, best: boolean) =>
    container.querySelector<HTMLElement>(
      `.exam-stats[data-examid="${CSS.escape(id)}"]${best ? '[data-best-stats]' : ':not([data-best-stats])'}`,
    );
  const warningSlot = (id: string) =>
    container.querySelector<HTMLElement>(`.exam-warning[data-examid="${CSS.escape(id)}"]`);

  for (const e of originals) {
    const resits = resitsOf(e);
    if (resits.length > 0) {
      const el = statsSlot(e.id, true);
      if (el) {
        fills.push(
          computeBestGradeStats(e.id, year).then((st) => applyStats(el, st, !!e.diagnostic)),
        );
      }
    }
    for (const attempt of [e, ...resits]) {
      const el = statsSlot(attempt.id, false);
      if (el) {
        fills.push(
          computeExamStats(year, attempt).then((st) => {
            applyStats(el, st, !!attempt.diagnostic);
            const count = container.querySelector(
              `[data-attempt-count="${CSS.escape(attempt.id)}"]`,
            );
            if (count) {
              const n = st?.n ?? 0;
              count.textContent = `${n} ${n === 1 ? 'leerling' : 'leerlingen'}`;
            }
          }),
        );
      }
      const warning = warningSlot(attempt.id);
      if (warning) {
        fills.push(computeExamWarnings(year, attempt).then((p) => applyWarning(warning, p)));
      }
    }
  }
  void Promise.allSettled(fills).then(() => {
    // A read that failed leaves no placeholder behind.
    container.querySelectorAll('.exam-stats:has(> .skel)').forEach((el) => el.remove());
    endStats();
  });
}
