// SPDX-License-Identifier: AGPL-3.0-or-later

// Exam overview, tabs Cijferverdeling, Boxplot cijfers and Vraaganalyse (spec 4.6.2-4.6.4;
// decisions 30, 31, 36): "Alle leerlingen" with the Stapgrootte toggle and a card per group (two
// per row, step 1); boxplot rows Alle leerlingen and each group in the test's type colour;
// Vraaganalyse restyled only (a bar per question in its RTTI colour, then a thin bar per group).

import { qKind } from '../../domain/grades';
import { RTTI_HEX } from '../../domain/rtti-names';
import { pct, questionStats, stats, type StatAttempt } from '../../domain/statistics';
import { testKind } from '../../domain/test-type';
import type { Exam, Student } from '../../domain/types';
import { emptyHtml, examBadgeHtml, meanLineHtml, studentCount } from '../../overview/common';
import { boxplotHtml } from '../../overview/boxplot';
import {
  histogramHtml,
  histogramModel,
  stepToggleHtml,
  type HistStep,
} from '../../overview/histogram';
import { rttiLegendHtml } from '../../overview/rtti-line';
import { esc } from '../../utils/html';
import { hasPoints, type ExamOverviewData, type Graded } from './data';

const NO_SCORES = 'Nog geen scores ingevoerd.';

/** The colour of the i-th of n groups: the accent, lighter for each next group (board 46). */
export function groupColor(i: number, n: number): string {
  const pct = n <= 1 ? 100 : Math.round(100 - (i * 55) / (n - 1));
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--surface))`;
}

function histCard(
  title: string,
  grades: number[],
  step: HistStep,
  height: number,
  lead = '',
): string {
  const s = grades.length ? stats(grades) : null;
  return (
    `<div class="ov-card"><div class="ov-card__head">${lead}<span class="ov-card__title">${esc(title)}</span>` +
    `<span class="ov-card__count">· ${studentCount(grades.length)}</span><span class="ov-card__spacer"></span>${meanLineHtml(s)}</div>` +
    histogramHtml(histogramModel(grades, step, height), {
      height,
      label: `Cijferverdeling ${title}`,
    })
  );
}

/** The "Alle leerlingen" histogram with its toggle; re-rendered when the step changes. */
export function allHistHtml(data: ExamOverviewData, step: HistStep): string {
  return (
    histCard('Alle leerlingen', data.grades, step, 170, examBadgeHtml(data.exam)) +
    `${stepToggleHtml(step)}</div>`
  );
}

export function verdelingHtml(data: ExamOverviewData, step: HistStep): string {
  if (!data.grades.length) return emptyHtml(NO_SCORES);
  const groups = data.groups
    .filter((g) => g.grades.length)
    .map((g) => `${histCard(g.group.name, g.grades, 1, 110)}</div>`)
    .join('');
  return (
    `<div class="ov-stack"><div class="xo-hist-all">${allHistHtml(data, step)}</div>` +
    (groups ? `<div class="ov-grid ov-grid--2 ov-grid--flush">${groups}</div>` : '') +
    `</div>`
  );
}

export function boxHtml(data: ExamOverviewData, nameOf: (s: Student) => string): string {
  if (!data.grades.length) return emptyHtml(NO_SCORES);
  const kind = testKind(data.exam);
  const byId = new Map(data.students.map((s) => [String(s.id), s]));
  const row = (label: string, list: Graded[]) => ({
    labelHtml: `<span class="ov-box__name">${esc(label)}</span><span class="ov-card__count">· ${studentCount(list.length)}</span>`,
    kind,
    points: list.map((x) => ({
      name: byId.has(x.id) ? nameOf(byId.get(x.id)!) : x.id,
      grade: x.grade,
    })),
  });
  return boxplotHtml([
    row('Alle leerlingen', data.graded),
    ...data.groups.filter((g) => g.graded.length).map((g) => row(g.group.name, g.graded)),
  ]);
}

/** The questions of the exam with their label and pooled percentage. */
function questionRows(exam: Exam, attempts: StatAttempt[]) {
  const byId = new Map(questionStats(attempts).map((s) => [s.question, s.points]));
  return exam.questions.map((q) => {
    const p = byId.get(q.id);
    return {
      q,
      label: q.section ? `${q.section}${q.number}` : String(q.number ?? ''),
      pct: p && p.max > 0 ? pct(p.scored, p.max) : null,
    };
  });
}

export function vraagHtml(data: ExamOverviewData): string {
  if (!hasPoints(data.attempts)) return emptyHtml('Geen vraagdata beschikbaar.');
  const { exam } = data;
  const all = questionRows(exam, data.attempts);
  const bar = (pct: number | null, color: string, cls: string) =>
    `<div class="xo-q__track ${cls}"><div class="xo-q__bar" data-w="${pct ?? 0}%" data-bg="${color}"></div></div>`;
  const allRows = all
    .map((r) => {
      const color = qKind(r.q) === 'normal' && r.q.rtti ? RTTI_HEX[r.q.rtti] : 'var(--muted)';
      const title = `${r.label}${r.q.rtti ? ` (${r.q.rtti})` : ''}: ${r.pct ?? '—'}%`;
      return (
        `<div class="xo-q" title="${esc(title)}"><span class="xo-q__label">${esc(r.label)}</span>` +
        `<span class="xo-q__max">${esc(String(r.q.max_points ?? ''))} punten</span>${bar(r.pct, color, '')}` +
        `<span class="xo-q__pct">${r.pct == null ? '—' : `${r.pct}%`}</span></div>`
      );
    })
    .join('');
  const groups = data.groups.filter((g) => hasPoints(g.attempts));
  const perGroup = groups.map((g) => questionRows(exam, g.attempts));
  const legend = groups
    .map(
      (g, i) =>
        `<span><span class="ov-legend__key" data-bg="${groupColor(i, groups.length)}"></span>${esc(g.group.name)}</span>`,
    )
    .join('');
  const groupRows = all
    .map(
      (r, qi) =>
        `<div class="xo-q xo-q--groups"><span class="xo-q__label">${esc(r.label)}</span><div class="xo-q__stack">` +
        perGroup
          .map((rows, gi) => {
            const p = rows[qi]!.pct;
            return `<div class="xo-q__thin" title="${esc(`${groups[gi]!.group.name}: ${p ?? '—'}%`)}">${bar(p, groupColor(gi, groups.length), 'xo-q__track--thin')}<span class="xo-q__gpct">${p == null ? '—' : `${p}%`}</span></div>`;
          })
          .join('') +
        `</div></div>`,
    )
    .join('');
  return (
    `<div class="ov-stack"><div class="ov-card"><div class="ov-card__head"><h3 class="ov-card__h3">Score per vraag, alle leerlingen</h3><span class="ov-card__spacer"></span><span class="ov-meanline">kleur = RTTI-categorie van de vraag</span></div>` +
    `${rttiLegendHtml()}${allRows}</div>` +
    (groups.length
      ? `<div class="ov-card"><div class="ov-card__head"><h3 class="ov-card__h3">Score per vraag, per groep</h3><span class="ov-card__spacer"></span><div class="ov-legend ov-legend--inline">${legend}</div></div>${groupRows}</div>`
      : '') +
    `</div>`
  );
}
