// SPDX-License-Identifier: AGPL-3.0-or-later

// Exam overview, tab Resultaten (spec 4.6.1, board 46; decision 35): one table with a sticky
// thead, a heading row per group ("Groep 5A · 12 leerlingen"), columns Naam, Totaal, Cijfer, an
// icon column per observatie and R/T1/T2/I; GEMIDDELDE and STANDAARDDEVIATIE under each group
// with the score grid's rules (step 25, decision 29: totals and grades mean ± SD, the ticked
// count per observatie, per RTTI the mean of the graded rows' percentages). Verzameloverzicht:
// the resit dot right of the grade and an empty column before the icons.

import { formatFixed, formatGrade, formatNumber } from '../../domain/format';
import { RTTI_CATS, RTTI_NAMES } from '../../domain/rtti-names';
import { stats } from '../../domain/statistics';
import type { Student } from '../../domain/types';
import { ovPillHtml } from '../../overview/common';
import { gradeWithDotHtml, resitInfo } from '../../overview/resit-dot';
import { sdText } from '../../overview/sections';
import { esc } from '../../utils/html';
import type { ExamOverviewData, StudentData } from './data';

export interface Section {
  name: string;
  students: Student[];
}

function totaalText(d: StudentData | undefined): string {
  const r = d?.results;
  if (!r || !Object.keys(d.questionScores).length) return '';
  const plus = r.hasBonus && r.scored > r.normalMax ? ' (+)' : '';
  return `${formatNumber(r.scored)} / ${formatNumber(r.normalMax)}${plus}`;
}

function rttiText(d: StudentData | undefined, cat: (typeof RTTI_CATS)[number]): string {
  if (!d?.results || !Object.keys(d.questionScores).length) return '';
  const v = d.results[cat];
  return v == null ? '' : v === 'NVT' ? 'NVT' : `${v}%`;
}

function gradeCell(d: StudentData | undefined, isSummary: boolean): string {
  const grade = d?.grade ?? null;
  const r = d?.results;
  const overridden = !!r?.overridden;
  const title = overridden
    ? ` title="${esc(
        `Met de hand overschreven cijfer. Berekend cijfer: ${formatGrade(r!.calculatedGrade)}.` +
          (r!.overrideStale ? '\nHet berekende cijfer is gewijzigd sinds het overschrijven.' : ''),
      )}"`
    : '';
  const cls = `xo-grade${overridden ? ' xo-grade--override' : ''}${r?.overrideStale ? ' grade-override-stale' : ''}`;
  const dot = isSummary ? resitInfo(d?.attempt) : null;
  const pill = ovPillHtml(grade);
  return `<td class="${cls}"${title}>${gradeWithDotHtml(overridden ? pill.replace('class="ov-pill', 'class="ov-pill ov-pill--tip') : pill, dot)}</td>`;
}

function footHtml(data: ExamOverviewData, list: StudentData[], isSummary: boolean): string {
  const graded = list.filter((d) => d.grade !== null);
  const totals = list
    .filter((d) => d.results && Object.keys(d.questionScores).length)
    .map((d) => d.results!.scored);
  const ts = totals.length ? stats(totals) : null;
  const gs = graded.length ? stats(graded.map((d) => d.grade!)) : null;
  const obsCells = data.observaties
    .map((o, i) => {
      const n = list.filter((d) => d.obs.includes(o.id)).length;
      return `<td class="xo-num${i === 0 ? ' xo-sep' : ''}">${n}</td>`;
    })
    .join('');
  const rttiCells = RTTI_CATS.map((cat, i) => {
    const pcts = graded
      .map((d) => d.results?.[cat])
      .filter((v): v is number => typeof v === 'number');
    const m = pcts.length ? stats(pcts)!.mean : null;
    const text = m !== null ? `${formatFixed(m, 0)}%` : graded.length ? 'NVT' : '';
    return `<td class="xo-num${i === 0 ? ' xo-sep' : ''}">${text}</td>`;
  }).join('');
  const blank = isSummary ? '<td></td>' : '';
  const rest = data.observaties.length + RTTI_CATS.length + (isSummary ? 1 : 0);
  return (
    `<tr class="ov-foot ov-foot--mean"><td class="ov-foot__label">GEMIDDELDE</td>` +
    `<td class="xo-num">${ts ? formatFixed(ts.mean) : ''}</td>` +
    `<td>${ovPillHtml(gs?.mean ?? null)}</td>${blank}${obsCells}${rttiCells}</tr>` +
    `<tr class="ov-foot ov-foot--sd"><td class="ov-foot__label">STANDAARDDEVIATIE</td>` +
    `<td>${ts ? esc(sdText(ts.sd)) : ''}</td><td>${gs ? esc(sdText(gs.sd)) : ''}</td>` +
    `<td colspan="${rest}"></td></tr>`
  );
}

export function resultatenHtml(
  data: ExamOverviewData,
  sections: Section[],
  nameOf: (s: Student) => string,
): string {
  const { observaties, isSummary } = data;
  const nCols = 3 + (isSummary ? 1 : 0) + observaties.length + RTTI_CATS.length;
  const head =
    `<tr><th class="ov-name-th">Naam</th><th class="xo-col-tot">Totaal</th><th class="xo-col-grade">Cijfer</th>` +
    (isSummary ? '<th class="xo-col-dot" title="Poging die telt"></th>' : '') +
    observaties
      .map(
        (o, i) =>
          `<th class="xo-col-obs${i === 0 ? ' xo-sep' : ''}" title="${esc(o.naam ?? '')}">${esc(o.icon ?? '')}</th>`,
      )
      .join('') +
    RTTI_CATS.map(
      (c, i) =>
        `<th class="xo-col-rtti xo-rtti--${c.toLowerCase()}${i === 0 ? ' xo-sep' : ''}" title="${c} ${RTTI_NAMES[c]}">${c}</th>`,
    ).join('') +
    `</tr>`;
  const body = sections
    .filter((sec) => sec.students.length)
    .map((sec) => {
      const rows = sec.students
        .map((s) => {
          const d = data.byStudent.get(String(s.id));
          const obsCells = observaties
            .map((o, i) => {
              const marked = !!d?.obs.includes(o.id);
              return `<td class="xo-obs${i === 0 ? ' xo-sep' : ''}"${marked ? ` title="${esc(o.naam ?? '')}"` : ''}>${marked ? esc(o.icon ?? '') : ''}</td>`;
            })
            .join('');
          const rtti = RTTI_CATS.map(
            (c, i) => `<td class="xo-num${i === 0 ? ' xo-sep' : ''}">${rttiText(d, c)}</td>`,
          ).join('');
          return (
            `<tr class="ov-row"><td class="ov-name-td"><button type="button" class="ov-name__link" data-action="open-student-from-exam" data-id="${esc(s.id)}">${esc(nameOf(s))}</button></td>` +
            `<td class="xo-num xo-muted">${totaalText(d)}</td>${gradeCell(d, isSummary)}` +
            (isSummary ? '<td></td>' : '') +
            `${obsCells}${rtti}</tr>`
          );
        })
        .join('');
      const list = sec.students
        .map((s) => data.byStudent.get(String(s.id)))
        .filter((d): d is StudentData => !!d);
      return (
        `<tbody class="xo-section"><tr class="ov-section"><th class="ov-section__head" colspan="${nCols}" scope="colgroup">` +
        `${esc(sec.name)} <span class="ov-section__extra">· ${sec.students.length} ${sec.students.length === 1 ? 'leerling' : 'leerlingen'}</span></th></tr>` +
        `${rows}${footHtml(data, list, isSummary)}</tbody>`
      );
    })
    .join('');
  if (!body) return '<p class="hint ov-empty">Geen groepen gevonden voor deze toets.</p>';
  return `<table class="ov-table xo-table"><thead>${head}</thead>${body}</table>`;
}
