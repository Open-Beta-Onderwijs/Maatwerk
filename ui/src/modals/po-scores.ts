// SPDX-License-Identifier: AGPL-3.0-or-later

// Scores invoeren for a PO (step 23a; design spec 4.13, board 18; PLAN-2 decision 24): a
// read-only table grouped by projectgroep. Category scores (slanted headings with their max),
// Punten, Groep ±, Eigen ± and Cijfer per student; a sticky heading per projectgroep with
// "Beoordelen" and its status. Grading itself is the projectgroep's modal (po-beoordelen.ts),
// also opened by a double-click on a row. Unplaced students are listed last, without a grade.

import {
  alertDialog,
  closeModal,
  modalRefresher,
  onModalSync,
  openModal,
  showReloadNotice,
} from '../app.js';
import { esc } from '../components/dialog';
import { formatGrade } from '../domain/format';
import { gradeCellColor } from '../domain/grade-colors';
import { poLinesSum, type Results } from '../domain/grades';
import {
  classesByStudent,
  compareStudents,
  groupName,
  matchingClasses,
  rubricOf,
  unplaced,
  type PoClass,
} from '../domain/po';
import {
  gradingOf,
  gradingStatus,
  groupSource,
  ownLinesOf,
  signedPoints,
  STATUS_TEXT,
} from '../domain/po-grading';
import type { Rubric } from '../domain/rubric';
import { testBadgeClass } from '../domain/test-type';
import type { Exam, PoLine, ScoreRecord, Student } from '../domain/types';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import { openPoEditModal } from './po-gegevens';
import { openProjectgroepenModal } from './po-groepen';

/** What the table and the grading modal read of one PO. */
export interface PoContext {
  exam: Exam;
  year: string;
  subject: string;
  rubric: Rubric | null;
  students: Map<string, Student>;
  /** The student's class name (the first matching class), or "—". */
  classTag: (id: string) => string;
  name: (id: string) => string;
  records: Map<string, ScoreRecord>;
}

/** Loads the PO, its rubric, its students and their score files. */
export async function loadPoContext(examId: string, year: string): Promise<PoContext | null> {
  await Store.loadYear(year);
  const exam = ((await Store.getExams(year)) as Exam[]).find((e) => e.id === examId);
  if (!exam) return null;
  const subject = exam.subject ?? (Store.getActiveSubject() as string);
  await Store.getRubrics(subject);
  const students = new Map<string, Student>(
    (Store.getStudentsSync(year) as Student[]).map((s) => [String(s.id), s]),
  );
  const scope = { subject, schoolsoort: exam.schoolsoort, jaarlaag: exam.jaarlaag };
  const byStudent = classesByStudent(
    matchingClasses(Store.getGroupsSync(year) as PoClass[], scope),
  );
  const ids = new Set([
    ...byStudent.keys(),
    ...(exam.projectgroepen ?? []).flatMap((g) => g.student_ids.map(String)),
  ]);
  await Store.preloadScores(year, subject, [...ids]);
  const records = new Map<string, ScoreRecord>();
  for (const id of ids)
    records.set(id, (await Store.getStudentScores(id, year, subject)) as ScoreRecord);
  const name = (id: string) => {
    const s = students.get(id);
    return s ? (Store.fullName(s) as string) : `Leerling ${id}`;
  };
  return {
    exam,
    year,
    subject,
    rubric: (rubricOf(exam) as Rubric | undefined) ?? null,
    students,
    classTag: (id) => byStudent.get(id)?.[0] ?? '—',
    name,
    records,
  };
}

/** Members of a projectgroep (or any list of ids) by achternaam. */
export function sortedIds(ctx: PoContext, ids: readonly (string | number)[]): string[] {
  return ids.map(String).sort((a, b) => compareStudents(ctx.students.get(a), ctx.students.get(b)));
}

/** "Theorie: −0,5 · Te laat: +0,2": the lines' names for a tooltip. */
function linesTitle(lines: PoLine[]): string {
  return lines
    .filter((l) => l.value !== null)
    .map((l) => `${l.label || 'Zonder omschrijving'}: ${signedPoints(l.value ?? 0)}`)
    .join(' · ');
}

function signClass(n: number): string {
  return n < 0 ? 'po-sc-minus' : n > 0 ? 'po-sc-plus' : '';
}

function cellClass(v: number, max: number): string {
  return v >= max ? 'po-sc-cell--max' : v <= 0 ? 'po-sc-cell--zero' : 'po-sc-cell--mid';
}

function studentRow(ctx: PoContext, id: string, groupId: string | null): string {
  const rec = ctx.records.get(id);
  const cats = ctx.rubric?.categories ?? [];
  const res: Results | null = groupId ? Store.examResults(rec, ctx.exam) : null;
  const g = gradingOf(rec, ctx.exam.id);
  const cells = cats
    .map((c) => {
      const v = groupId ? g.scores[c.id] : undefined;
      return v === undefined
        ? '<td class="po-sc-cell po-sc-empty">—</td>'
        : `<td class="po-sc-cell ${cellClass(v, c.max ?? 0)}">${v}</td>`;
    })
    .join('');
  const group = groupId ? poLinesSum(g.groupLines) : 0;
  const ownLines = groupId ? ownLinesOf(rec, ctx.exam.id) : [];
  const own = poLinesSum(ownLines);
  const grade = res?.grade ?? null;
  const fill = gradeCellColor(grade);
  return `<tr class="po-sc-row"${groupId ? ` data-group="${esc(groupId)}" title="Dubbelklik om de projectgroep te beoordelen"` : ''} data-student="${esc(id)}">
    <td class="po-sc-nr">${esc(id)}</td>
    <td class="po-sc-name">${esc(ctx.name(id))}</td>
    <td class="po-sc-cls">${esc(ctx.classTag(id))}</td>
    ${cells}
    <td class="po-sc-pts">${res && Object.keys(g.scores).length ? `${res.scored} / ${res.normalMax}` : '—'}</td>
    <td class="po-sc-adj ${signClass(group)}"${group ? ` title="${esc(linesTitle(g.groupLines))}"` : ''}>${signedPoints(group)}</td>
    <td class="po-sc-adj ${signClass(own)}"${own ? ` title="${esc(linesTitle(ownLines))}"` : ''}>${signedPoints(own)}</td>
    <td class="po-sc-grade"${fill ? ` data-bg="${fill}"` : ''}>${grade === null ? '—' : formatGrade(grade)}</td>
  </tr>`;
}

/** The table's body HTML. */
function tableHtml(ctx: PoContext): string {
  const cats = ctx.rubric?.categories ?? [];
  if (!ctx.rubric)
    return '<p class="po-sc-note">Deze PO heeft geen rubric, dus er is niets te beoordelen. Kies een rubric via <b>PO bewerken</b>.</p>';
  const groups = ctx.exam.projectgroepen ?? [];
  if (!groups.length)
    return '<p class="po-sc-note">Nog geen projectgroepen. Deel de leerlingen eerst in via <b>Projectgroepen</b>.</p>';
  const span = 3 + cats.length + 4;
  const head = `<thead><tr>
      <th class="po-sc-nr" scope="col">#</th>
      <th class="po-sc-name" scope="col">Naam</th>
      <th class="po-sc-cls" scope="col">Klas</th>
      ${cats
        .map(
          (c) =>
            `<th class="po-sc-cat po-sc-cat--${c.soort}" scope="col"><div class="po-sc-slant"><span>${esc(c.naam)} <span class="po-sc-max">(${c.max ?? 0})</span></span></div></th>`,
        )
        .join('')}
      <th class="po-sc-pts" scope="col">Punten</th>
      <th class="po-sc-adj" scope="col">Groep ±</th>
      <th class="po-sc-adj" scope="col">Eigen ±</th>
      <th class="po-sc-grade" scope="col">Cijfer</th>
    </tr></thead>`;
  const bodies = groups.map((g, i) => {
    const members = sortedIds(ctx, g.student_ids);
    const source = groupSource(
      members.map((m) => ctx.records.get(m)),
      ctx.exam.id,
      g.id,
    );
    const status = gradingStatus(ctx.rubric, gradingOf(source, ctx.exam.id));
    const n = members.length;
    return `<tbody class="po-sc-group" data-group="${esc(g.id)}">
      <tr class="po-sc-ghead"><th colspan="${span}" scope="rowgroup"><div class="po-sc-ghead-in">
        <b class="po-sc-gname">${esc(groupName(g, i))}</b>
        <span class="po-sc-ginfo">${n} ${n === 1 ? 'leerling' : 'leerlingen'}</span>
        <button type="button" class="btn btn--sm po-sc-grade-btn" data-grade-group="${esc(g.id)}">${ICONS.pen}Beoordelen</button>
        <span class="po-sc-status po-sc-status--${status}">${STATUS_TEXT[status]}</span>
      </div></th></tr>
      ${members.map((m) => studentRow(ctx, m, g.id)).join('')}
    </tbody>`;
  });
  const free = sortedIds(ctx, unplaced([...ctx.records.keys()], groups));
  if (free.length)
    bodies.push(`<tbody class="po-sc-group po-sc-free">
      <tr class="po-sc-ghead"><th colspan="${span}" scope="rowgroup"><div class="po-sc-ghead-in">
        <b class="po-sc-gname">Niet ingedeeld</b>
        <span class="po-sc-ginfo">${free.length} ${free.length === 1 ? 'leerling krijgt' : 'leerlingen krijgen'} pas een cijfer in een projectgroep</span>
      </div></th></tr>
      ${free.map((m) => studentRow(ctx, m, null)).join('')}
    </tbody>`);
  return `<div class="po-sc-wrap"><table class="po-sc-table">${head}${bodies.join('')}</table></div>`;
}

const HELP =
  'De scores van een PO gelden per projectgroep. Klik op Beoordelen bij een projectgroep, of dubbelklik op een rij, om de categorieën te scoren, observaties aan te vinken en bonus of malus te geven. ' +
  'Groep ± is de bonus/malus van de hele projectgroep, Eigen ± die van de leerling zelf. Cijfer = 10 × punten ÷ maximum, plus de bonus/malus, tussen 1,0 en 10,0.';

/** Opens the PO score table; `grade` opens the grading modal of a projectgroep. */
export async function openPoScoresModal(
  examId: string,
  year: string,
  grade?: (ctx: PoContext, groupId: string, refresh: () => void) => void,
): Promise<void> {
  const ctx = await loadPoContext(examId, year);
  if (!ctx) return;
  const { exam } = ctx;
  const badge = exam.volgnummer
    ? `<span class="${testBadgeClass(exam)}">${esc(String(exam.volgnummer))}</span>`
    : '';
  openModal({
    title: 'Scores invoeren',
    key: 'po-scores',
    subtitleHtml: `${badge}<span>${esc(exam.title)}</span>`,
    className: 'dlg--po-scores',
    size: 'xl',
    fixedHeight: true,
    bodyClass: 'po-sc-body',
    headerActionsHtml: `
      <button type="button" class="btn btn--icon" id="po-sc-help" aria-label="Uitleg" title="Uitleg">?</button>
      <button type="button" class="btn btn--secondary btn--sm" id="po-sc-groups">Projectgroepen</button>
      <button type="button" class="btn btn--secondary btn--sm" id="po-sc-edit">PO bewerken</button>`,
    body: tableHtml(ctx),
    footerHtml: `
      <span class="po-sc-hint">Scores per categorie wijzig je via <b>Beoordelen</b> of door dubbel te klikken op een rij; ze gelden voor de hele projectgroep.</span>
      <span class="po-sc-saved" role="status">● Alles opgeslagen</span>`,
    onShow: (el: HTMLElement) => {
      const reopen = () => openPoScoresModal(examId, year, grade);
      const refresh = modalRefresher(reopen, 200);
      let generation = Store.generation();
      // Back from a stacked dialog (Projectgroepen, PO bewerken): refresh what it changed.
      el.addEventListener('focusin', () => {
        if (Store.generation() !== generation) {
          generation = Store.generation();
          refresh();
        }
      });
      const openGrading = (groupId: string | undefined) => {
        if (groupId && grade) grade(ctx, groupId, refresh);
      };
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const btn = t.closest<HTMLElement>('[data-grade-group]');
        if (btn) openGrading(btn.dataset.gradeGroup);
      });
      el.addEventListener('dblclick', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('tr.po-sc-row[data-group]');
        if (row) openGrading(row.dataset.group);
      });
      el.querySelector('#po-sc-help')?.addEventListener('click', () => {
        void alertDialog(HELP, { title: 'Scores van een PO' });
      });
      el.querySelector('#po-sc-groups')?.addEventListener('click', () => {
        void openProjectgroepenModal(examId, year);
      });
      el.querySelector('#po-sc-edit')?.addEventListener('click', () => {
        void openPoEditModal(examId, year);
      });
      onModalSync('scores', (ev: { year: string; subject: string; id: string }) => {
        if (ev.year === year && ev.subject === ctx.subject && ctx.records.has(ev.id)) refresh();
      });
      onModalSync('exam', (ev: { id: string; year: string; after: unknown }) => {
        if (ev.id !== examId || ev.year !== year) return;
        if (ev.after) refresh();
        else showReloadNotice('Deze PO is verwijderd door een collega.', closeModal);
      });
      onModalSync('rubric', () => refresh());
    },
  });
}
