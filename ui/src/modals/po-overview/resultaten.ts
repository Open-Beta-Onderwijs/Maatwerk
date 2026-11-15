// SPDX-License-Identifier: AGPL-3.0-or-later

// PO overview, tab Resultaten (spec 4.14.1, board 43): "Per klas" (a section per klas, the
// projectgroep as a chip; dashed "niet ingedeeld" without one) or "Per projectgroep" (a section
// per projectgroep with its projectgroepcijfer and group lines, the klas as a chip; "Niet
// ingedeeld" last, without a footer). Columns: Naam, the label, Punten, Bonus / malus and
// Cijfer; GEMIDDELDE and STANDAARDDEVIATIE per section. No column per category (user
// 2026-11-15: a rubric can have 20): the tooltips of Punten, Bonus / malus and Cijfer give the
// grade's build-up, every observatie of the student and then the category scores.

import { formatFixed, formatGrade } from '../../domain/format';
import { signedPoints } from '../../domain/po-grading';
import type { RubricCategory } from '../../domain/rubric';
import type { Observatie } from '../../domain/types';
import { ovPillHtml, studentCount } from '../../overview/common';
import { columnStats, sdText } from '../../overview/sections';
import type { TipContent } from '../../overview/tooltip';
import { esc } from '../../utils/html';
import { gradesOf, linesOfRow, rowObs, type PoModel, type PoRow } from './model';

export type PoView = 'klas' | 'groep';

/** Every observatie a placed student has (general and per category). */
const poStudentObs = (r: PoRow) => [
  ...r.grading.observations,
  ...Object.values(r.grading.categoryObs).flat(),
];

const NONE = '—';

/** A category in a tooltip: "Theorie", "Extra (bonus)", "Planning (diagnostisch)". */
const catLabel = (c: RubricCategory) => (c.soort === 'normaal' ? c.naam : `${c.naam} (${c.soort})`);

/** "+0,3" / "−0,5" with the sign, "0,0" for a sum of nothing. */
const signed = (n: number) => signedPoints(n) || formatFixed(0);

const lineList = (lines: { label: string; value: number | null }[]) =>
  lines.map((l) => `${l.label || 'Zonder omschrijving'} ${signed(l.value ?? 0)}`).join(' · ');

function chip(text: string, unplaced = false): string {
  return `<span class="po-ov-chip${unplaced ? ' po-ov-chip--none' : ''}" title="${esc(text)}">${esc(text)}</span>`;
}

function rowHtml(r: PoRow, view: PoView): string {
  const label =
    view === 'klas' ? (r.group ? chip(r.group.name) : chip('niet ingedeeld', true)) : chip(r.klas);
  const name = `<td class="ov-name-td"><button type="button" class="ov-name__link" data-action="open-student-from-po" data-id="${esc(r.id)}">${esc(r.name)}</button></td>`;
  if (!r.group) {
    const empty = `<td class="po-ov-num po-ov-muted">${NONE}</td>`;
    return (
      `<tr class="ov-row">${name}<td class="po-ov-label">${label}</td>${empty.repeat(2)}` +
      `<td class="po-ov-num">${ovPillHtml(null)}</td></tr>`
    );
  }
  const { lines, sum } = linesOfRow(r);
  const hasObs = poStudentObs(r).length > 0;
  const dotted = hasObs ? ' class="po-ov-tipv"' : '';
  const pill = ovPillHtml(r.grade);
  const tip = (col: string) => ` data-tip="${esc(`${r.id}|${col}`)}" data-tip-align="right"`;
  return (
    `<tr class="ov-row">${name}<td class="po-ov-label">${label}</td>` +
    `<td class="po-ov-num po-ov-pts"${tip('pts')}>${r.points === null ? NONE : `<span${dotted}>${r.points}</span>`}</td>` +
    `<td class="po-ov-num${lines.length ? (sum < 0 ? ' po-ov-minus' : '') : ' po-ov-muted'}"${tip('bm')}>${lines.length ? `<span${dotted}>${signed(sum)}</span>` : NONE}</td>` +
    `<td class="po-ov-num"${tip('cijfer')}>${hasObs ? pill.replace('class="ov-pill', 'class="ov-pill ov-pill--tip') : pill}</td></tr>`
  );
}

function footHtml(rows: PoRow[]): string {
  const p = columnStats(rows.map((r) => r.points).filter((v): v is number => v !== null));
  const g = columnStats(gradesOf(rows));
  return (
    `<tr class="ov-foot ov-foot--mean"><td class="ov-foot__label">GEMIDDELDE</td><td></td>` +
    `<td class="po-ov-num po-ov-foot-v">${p.mean === null ? '' : formatFixed(p.mean)}</td>` +
    `<td></td><td class="po-ov-num">${ovPillHtml(g.mean)}</td></tr>` +
    `<tr class="ov-foot ov-foot--sd"><td class="ov-foot__label">STANDAARDDEVIATIE</td><td></td>` +
    `<td class="po-ov-num">${p.mean === null ? '' : esc(sdText(p.sd))}</td>` +
    `<td></td><td class="po-ov-num">${g.mean === null ? '' : esc(sdText(g.sd))}</td></tr>`
  );
}

interface Section {
  name: string;
  extra: string;
  rows: PoRow[];
  foot: boolean;
}

function sections(m: PoModel, view: PoView): Section[] {
  if (view === 'klas')
    return m.klassen.map((k) => {
      const rows = m.rows.filter((r) => r.klas === k);
      return {
        name: k === NONE ? 'Zonder klas' : `Klas ${k}`,
        extra: studentCount(rows.length),
        rows,
        foot: true,
      };
    });
  const out: Section[] = m.groups.map((g) => ({
    name: g.name,
    extra: [
      `projectgroepcijfer ${formatGrade(g.rubricGrade)}`,
      ...(g.groupLines.length ? [lineList(g.groupLines)] : []),
      studentCount(g.members.length),
    ].join(' · '),
    rows: g.members,
    foot: true,
  }));
  const free = m.rows.filter((r) => !r.group);
  if (free.length)
    out.push({
      name: 'Niet ingedeeld',
      extra: 'geen cijfer, geen rapport',
      rows: free,
      foot: false,
    });
  return out;
}

/** The view toggle, the hint and the table. */
export function resultatenHtml(m: PoModel, view: PoView): string {
  const btn = (v: PoView, text: string) =>
    `<button type="button" class="tog-btn po-ov-view${view === v ? ' selected' : ''}" data-view="${v}" aria-pressed="${view === v}">${text}</button>`;
  const bar =
    `<div class="po-ov-bar"><div class="btn-toggle-group" role="group" aria-label="Indeling">${btn('klas', 'Per klas')}${btn('groep', 'Per projectgroep')}</div>` +
    `<span class="ov-card__spacer"></span><span class="ov-meanline">Beweeg over punten of cijfer voor de categoriescores en observaties · categoriescores zijn van de projectgroep</span></div>`;
  if (!m.rows.length) return `${bar}<p class="hint ov-empty">Geen leerlingen bij deze PO.</p>`;
  const nCols = 5;
  const head =
    `<tr><th class="ov-name-th">Naam</th><th class="po-ov-col-label">${view === 'klas' ? 'Projectgroep' : 'Klas'}</th>` +
    `<th class="po-ov-col-pts"><div>Punten</div><div class="po-ov-sub">/ ${m.max}</div></th>` +
    `<th class="po-ov-col-bm">Bonus / malus</th><th class="po-ov-col-grade">Cijfer</th></tr>`;
  const body = sections(m, view)
    .map(
      (s) =>
        `<tbody class="po-ov-section"><tr class="ov-section"><th class="ov-section__head" colspan="${nCols}" scope="colgroup">` +
        `${esc(s.name)} <span class="ov-section__extra">· ${esc(s.extra)}</span></th></tr>` +
        s.rows.map((r) => rowHtml(r, view)).join('') +
        (s.foot ? footHtml(s.rows.filter((r) => r.group)) : '') +
        `</tbody>`,
    )
    .join('');
  return `${bar}<table class="ov-table po-ov-table"><thead>${head}</thead>${body}</table>`;
}

/** The category scores of a student, for the tooltips: "Theorie" "6 / 8". */
export function categoryRows(m: PoModel, r: PoRow): [string, string][] {
  return m.categories.map((c) => {
    const v = r.grading.scores[c.id];
    return [catLabel(c), `${v === undefined ? NONE : v} / ${c.max ?? 0}`];
  });
}

/** The tooltip of a cell key `<student>|pts`, `<student>|bm` or `<student>|cijfer`. */
export function poCellTip(
  m: PoModel,
  allObs: readonly Observatie[],
  key: string,
): TipContent | null {
  const [id, col] = key.split('|');
  const r = m.rows.find((x) => x.id === id);
  if (!r?.group) return null;
  const byId = new Map(allObs.map((o) => [o.id, o]));
  const obs = rowObs(r, m, byId);
  const rows = categoryRows(m, r);
  const { lines, sum } = linesOfRow(r);
  if (col === 'pts')
    return {
      head: `Punten: ${r.points ?? NONE} / ${m.max}`,
      sub: `Projectgroepcijfer ${formatGrade(r.rubricGrade)} (bonus telt mee, diagnostisch niet)`,
      obs,
      rows,
    };
  if (col === 'bm')
    return {
      head: `Bonus / malus: ${lines.length ? signed(sum) : 'geen'}`,
      sub: lines.length ? lineList(lines) : 'Geen regels voor de groep of de leerling',
      obs,
      rows,
    };
  const group = linesOfRow({ ...r, ownLines: [] }).sum;
  const own = linesOfRow({ ...r, groupLines: [] }).sum;
  return {
    head: `${r.name}: ${formatGrade(r.grade)}`,
    sub:
      `Projectgroep ${r.group.name} ${formatGrade(r.rubricGrade)}` +
      (r.groupLines.length ? ` · groep ${signed(group)}` : '') +
      (r.ownLines.length ? ` · persoonlijk ${signed(own)}` : ''),
    obs,
    rows,
  };
}
