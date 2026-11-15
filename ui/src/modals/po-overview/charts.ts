// SPDX-License-Identifier: AGPL-3.0-or-later

// PO overview, tabs Cijferverdeling, Boxplot, Categorieën and Observaties (spec 4.14.2-4.14.5,
// board 43). Grades are the final ones (lines in) of the placed students: "Alle leerlingen" with
// the Stapgrootte toggle, then a card per klas; boxplot rows Alle leerlingen and each klas.
// Categorieën: per category the mean score, the share of the maximum and the students per level
// (accent shades light to dark, grey for a diagnostic category). Observaties: a card per
// category, then the general ones; percentages of the placed students.

import { formatFixed } from '../../domain/format';
import { gradeBarColor, gradeTextColor } from '../../domain/grade-colors';
import { stats } from '../../domain/statistics';
import { testKind } from '../../domain/test-type';
import type { Observatie } from '../../domain/types';
import { boxplotHtml } from '../../overview/boxplot';
import { emptyHtml, examBadgeHtml, meanLineHtml, pctOf, studentCount } from '../../overview/common';
import {
  histogramHtml,
  histogramModel,
  stepToggleHtml,
  type HistStep,
} from '../../overview/histogram';
import { esc } from '../../utils/html';
import {
  catScores,
  gradesOf,
  levelCounts,
  levelText,
  obsSections,
  type PoModel,
  type PoRow,
} from './model';

const NO_GRADES = 'Nog geen cijfers: beoordeel eerst een projectgroep.';

function histCard(title: string, grades: number[], step: HistStep, height: number, lead = '') {
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

const byKlas = (m: PoModel) =>
  m.klassen
    .map((k) => ({ klas: k, rows: m.placed.filter((r) => r.klas === k) }))
    .filter((x) => gradesOf(x.rows).length);

/** The "Alle leerlingen" histogram with its toggle; re-rendered when the step changes. */
export function allHistHtml(m: PoModel, step: HistStep): string {
  return (
    histCard('Alle leerlingen', gradesOf(m.placed), step, 170, examBadgeHtml(m.exam)) +
    `${stepToggleHtml(step)}</div>`
  );
}

export function verdelingHtml(m: PoModel, step: HistStep): string {
  if (!gradesOf(m.placed).length) return emptyHtml(NO_GRADES);
  const cards = byKlas(m)
    .map((x) => `${histCard(x.klas, gradesOf(x.rows), 1, 110)}</div>`)
    .join('');
  return (
    `<div class="ov-stack"><div class="po-ov-hist-all">${allHistHtml(m, step)}</div>` +
    (cards ? `<div class="ov-grid ov-grid--2 ov-grid--flush">${cards}</div>` : '') +
    `</div>`
  );
}

export function boxHtml(m: PoModel): string {
  if (!gradesOf(m.placed).length) return emptyHtml(NO_GRADES);
  const kind = testKind(m.exam);
  const badge = examBadgeHtml(m.exam);
  const row = (label: string, rows: PoRow[]) => {
    const graded = rows.filter((r) => r.grade !== null);
    return {
      labelHtml: `${badge}<span class="ov-box__name">${esc(label)}</span><span class="ov-card__count">· ${studentCount(graded.length)}</span>`,
      kind,
      points: graded.map((r) => ({ name: r.name, grade: r.grade! })),
    };
  };
  return `<div class="ov-stack">${boxplotHtml([
    row('Alle leerlingen', m.placed),
    ...byKlas(m).map((x) => row(x.klas, x.rows)),
  ])}</div>`;
}

/** The shade of level k of n: light to dark, in the accent or in grey (diagnostic). */
export function levelColor(k: number, n: number, diagnostic: boolean): string {
  const pct = n <= 1 ? 100 : Math.round(22 + (78 * k) / (n - 1));
  return `color-mix(in srgb, ${diagnostic ? 'var(--grade-diagnostic-border)' : 'var(--accent)'} ${pct}%, var(--surface))`;
}

export function categorieenHtml(m: PoModel): string {
  if (!m.rubric) return emptyHtml('Deze PO heeft geen rubric.');
  const placed = m.placed;
  if (!placed.some((r) => Object.keys(r.grading.scores).length))
    return emptyHtml('Nog geen scores: beoordeel eerst een projectgroep.');
  const rows = m.categories
    .map((c) => {
      const scores = catScores(placed, c.id);
      const max = c.max ?? 0;
      const mean = scores.length ? stats(scores)!.mean : null;
      const p = mean !== null && max ? mean / max : null;
      const diag = c.soort === 'diagnostisch';
      const tag =
        c.soort === 'bonus'
          ? '<span class="po-ov-pill po-ov-pill--bonus">bonus</span>'
          : diag
            ? '<span class="po-ov-pill">diagnostisch · telt niet mee</span>'
            : '';
      const asGrade = p === null ? null : 1 + 9 * p;
      const meanColor = diag ? 'var(--muted)' : gradeTextColor(asGrade);
      const barCls = diag
        ? ' po-ov-share__bar--diag'
        : c.soort === 'bonus'
          ? ' po-ov-share__bar--bonus'
          : '';
      const counts = levelCounts(c, placed);
      const n = c.niveaus.length;
      const total = counts.reduce((a, b) => a + b, 0);
      const segs = counts
        .map((cnt, k) =>
          cnt
            ? `<div class="po-ov-seg${k / Math.max(1, n - 1) > 0.5 ? ' po-ov-seg--dark' : ''}" title="${esc(`${levelText(c, k)}: ${studentCount(cnt)}`)}" data-w="${((100 * cnt) / total).toFixed(2)}%" data-bg="${levelColor(k, n, diag)}">${cnt}</div>`
            : '',
        )
        .join('');
      const legend = counts
        .map(
          (cnt, k) =>
            `<span><span class="ov-legend__key" data-bg="${levelColor(k, n, diag)}"></span>${esc(levelText(c, k))} <b>${cnt}</b></span>`,
        )
        .join('');
      return (
        `<tr><td class="po-ov-cat"><div class="po-ov-cat__name">${esc(c.naam)}</div>${tag ? `<div>${tag}</div>` : ''}</td>` +
        `<td class="po-ov-num po-ov-cat__mean"><b data-color="${meanColor}">${mean === null ? '—' : formatFixed(mean)}</b> <span class="po-ov-muted">/ ${max}</span></td>` +
        `<td><div class="po-ov-share"><div class="po-ov-share__track"><div class="po-ov-share__bar${barCls}" data-w="${p === null ? 0 : Math.round(p * 100)}%"${diag || c.soort === 'bonus' || asGrade === null ? '' : ` data-bg="${gradeBarColor(asGrade)}"`}></div></div>` +
        `<span class="po-ov-share__pct">${p === null ? '—' : `${Math.round(p * 100)}%`}</span></div></td>` +
        `<td><div class="po-ov-segs">${segs}</div><div class="ov-legend po-ov-legend">${legend}</div></td></tr>`
      );
    })
    .join('');
  const pts = placed.map((r) => r.points).filter((v): v is number => v !== null);
  const tot = pts.length ? stats(pts)!.mean : null;
  return (
    `<p class="ov-intro">${studentCount(placed.length).replace('leerling', 'ingedeelde leerling')}. Een balk per categorie: hoeveel leerlingen elk niveau haalden (bij overlappende niveaus telt een leerling twee keer).</p>` +
    `<table class="po-ov-cats"><thead><tr><th class="po-ov-cats__name">Categorie</th><th class="po-ov-cats__mean">Gem.</th><th class="po-ov-cats__share">Van het maximum</th><th>Leerlingen per niveau</th></tr></thead>` +
    `<tbody>${rows}</tbody><tfoot><tr><td class="po-ov-cats__foot">TOTAAL PUNTEN</td>` +
    `<td class="po-ov-num"><b>${tot === null ? '—' : formatFixed(tot)}</b> <span class="po-ov-muted">/ ${m.max}</span></td>` +
    `<td colspan="2"><b>${tot === null || !m.max ? '—' : `${pctOf(tot, m.max)}%`}</b> <span class="po-ov-muted">· incl. bonus, excl. diagnostisch</span></td></tr></tfoot></table>`
  );
}

export function observatiesHtml(m: PoModel, allObs: readonly Observatie[]): string {
  const sections = obsSections(m, allObs);
  if (!sections.length) return emptyHtml('Geen observaties bij deze PO.');
  const ns = m.placed.length;
  const nGroups = m.groups.length;
  const cards = sections
    .map((s) => {
      const rows = s.rows
        .map((r) => {
          const p = pctOf(r.n, ns);
          return (
            `<div class="po-ov-obs__row"><span class="ov-obs__icon" aria-hidden="true">${esc(r.obs.icon ?? '')}</span>` +
            `<span class="ov-obs__name">${esc(r.obs.naam ?? '')}</span>` +
            `<div class="ov-obs__track po-ov-obs__track"${r.groups.length ? ` title="${esc(r.groups.join(', '))}"` : ''}><div class="ov-obs__bar" data-w="${p}%"></div></div>` +
            `<span class="ov-obs__n">${r.n} (${p}%)</span><span class="po-ov-obs__groups">${r.groups.length} van ${nGroups} groepen</span></div>`
          );
        })
        .join('');
      return (
        `<div class="ov-card"><div class="ov-card__head"><span class="ov-card__title po-ov-obs__title">${esc(s.category?.naam ?? 'Algemene observaties')}</span>` +
        `<span class="ov-meanline">${s.category ? 'categorie' : 'niet aan een categorie gekoppeld'}</span></div>${rows}</div>`
      );
    })
    .join('');
  return (
    `<p class="ov-intro">Percentage van de ${studentCount(ns).replace('leerling', 'ingedeelde leerling')} (elk lid van een projectgroep telt mee).</p>` +
    `<div class="ov-stack">${cards}</div>`
  );
}
