// SPDX-License-Identifier: AGPL-3.0-or-later

// PO overview, tab Resultaten (spec 4.14.1, board 43): "Per klas" (a section per klas, the
// projectgroep as a chip; dashed "niet ingedeeld" without one) or "Per projectgroep" (a section
// per projectgroep with its projectgroepcijfer and group lines, the klas as a chip; "Niet
// ingedeeld" last, without a footer). Columns: Naam, the label, one per category (diagnostic
// italic and muted), Punten, Bonus / malus and Cijfer; GEMIDDELDE and STANDAARDDEVIATIE per
// section. Tooltips (spec 3.10): a category score with its level and observaties; Punten,
// Bonus / malus and Cijfer with the grade's build-up and every observatie of the student.

import { formatFixed, formatGrade } from '../../domain/format';
import { signedPoints } from '../../domain/po-grading';
import type { RubricCategory } from '../../domain/rubric';
import type { Observatie } from '../../domain/types';
import { ovPillHtml, studentCount } from '../../overview/common';
import { columnStats, sdText } from '../../overview/sections';
import type { TipContent } from '../../overview/tooltip';
import { esc } from '../../utils/html';
import {
  catScores,
  gradesOf,
  levelsOf,
  levelText,
  linesOfRow,
  rowObs,
  type PoModel,
  type PoRow,
} from './model';

export type PoView = 'klas' | 'groep';

/** Every observatie a placed student has (general and per category). */
const poStudentObs = (r: PoRow) => [
  ...r.grading.observations,
  ...Object.values(r.grading.categoryObs).flat(),
];

const NONE = '—';

function catTag(c: RubricCategory): string {
  if (c.soort === 'bonus') return '<span class="po-ov-tag po-ov-tag--bonus" title="bonus">B</span>';
  if (c.soort === 'diagnostisch')
    return '<span class="po-ov-tag" title="diagnostisch · telt niet mee">D</span>';
  return '';
}

/** "+0,3" / "−0,5" with the sign, "0,0" for a sum of nothing. */
const signed = (n: number) => signedPoints(n) || formatFixed(0);

const lineList = (lines: { label: string; value: number | null }[]) =>
  lines.map((l) => `${l.label || 'Zonder omschrijving'} ${signed(l.value ?? 0)}`).join(' · ');

function chip(text: string, unplaced = false): string {
  return `<span class="po-ov-chip${unplaced ? ' po-ov-chip--none' : ''}" title="${esc(text)}">${esc(text)}</span>`;
}

function rowHtml(m: PoModel, r: PoRow, view: PoView): string {
  const label =
    view === 'klas' ? (r.group ? chip(r.group.name) : chip('niet ingedeeld', true)) : chip(r.klas);
  const name = `<td class="ov-name-td"><button type="button" class="ov-name__link" data-action="open-student-from-po" data-id="${esc(r.id)}">${esc(r.name)}</button></td>`;
  if (!r.group) {
    const empty = `<td class="po-ov-num po-ov-muted">${NONE}</td>`;
    return (
      `<tr class="ov-row">${name}<td class="po-ov-label">${label}</td>${empty.repeat(m.categories.length + 2)}` +
      `<td class="po-ov-num">${ovPillHtml(null)}</td></tr>`
    );
  }
  const cats = m.categories
    .map((c, i) => {
      const v = r.grading.scores[c.id];
      const diag = c.soort === 'diagnostisch' ? ' po-ov-diag' : '';
      const right = i >= m.categories.length / 2 ? ' data-tip-align="right"' : '';
      return v === undefined
        ? `<td class="po-ov-num po-ov-muted">${NONE}</td>`
        : `<td class="po-ov-num${diag}" data-tip="${esc(`${r.id}|c|${c.id}`)}"${right}><span${r.grading.categoryObs[c.id]?.length ? ' class="po-ov-tipv"' : ''}>${v}</span></td>`;
    })
    .join('');
  const { lines, sum } = linesOfRow(r);
  const dotted = poStudentObs(r).length ? ' class="po-ov-tipv"' : '';
  const tip = (col: string) => ` data-tip="${esc(`${r.id}|${col}`)}" data-tip-align="right"`;
  return (
    `<tr class="ov-row">${name}<td class="po-ov-label">${label}</td>${cats}` +
    `<td class="po-ov-num po-ov-pts"${tip('pts')}>${r.points === null ? NONE : `<span${dotted}>${r.points}</span>`}</td>` +
    `<td class="po-ov-num${lines.length ? (sum < 0 ? ' po-ov-minus' : '') : ' po-ov-muted'}"${tip('bm')}>${lines.length ? `<span${dotted}>${signed(sum)}</span>` : NONE}</td>` +
    `<td class="po-ov-num"${tip('cijfer')}>${ovPillHtml(r.grade)}</td></tr>`
  );
}

function footHtml(m: PoModel, rows: PoRow[]): string {
  const cell = (values: number[], diag = false) => {
    const s = columnStats(values);
    return {
      mean: `<td class="po-ov-num po-ov-foot-v${diag ? ' po-ov-diag' : ''}">${s.mean === null ? '' : formatFixed(s.mean)}</td>`,
      sd: `<td class="po-ov-num">${s.mean === null ? '' : esc(sdText(s.sd))}</td>`,
    };
  };
  const cols = [
    ...m.categories.map((c) => cell(catScores(rows, c.id), c.soort === 'diagnostisch')),
    cell(rows.map((r) => r.points).filter((p): p is number => p !== null)),
  ];
  const g = columnStats(gradesOf(rows));
  return (
    `<tr class="ov-foot ov-foot--mean"><td class="ov-foot__label">GEMIDDELDE</td><td></td>${cols.map((c) => c.mean).join('')}` +
    `<td></td><td class="po-ov-num">${ovPillHtml(g.mean)}</td></tr>` +
    `<tr class="ov-foot ov-foot--sd"><td class="ov-foot__label">STANDAARDDEVIATIE</td><td></td>${cols.map((c) => c.sd).join('')}` +
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
    `<span class="ov-card__spacer"></span><span class="ov-meanline">Beweeg over een score voor de observaties · categoriescores zijn van de projectgroep</span></div>`;
  if (!m.rows.length) return `${bar}<p class="hint ov-empty">Geen leerlingen bij deze PO.</p>`;
  const nCols = 2 + m.categories.length + 3;
  const head =
    `<tr><th class="ov-name-th">Naam</th><th class="po-ov-col-label">${view === 'klas' ? 'Projectgroep' : 'Klas'}</th>` +
    m.categories
      .map(
        (c) =>
          `<th class="po-ov-col-cat"><div>${esc(c.naam)}</div><div class="po-ov-sub">/ ${c.max ?? 0}${catTag(c)}</div></th>`,
      )
      .join('') +
    `<th class="po-ov-col-pts"><div>Punten</div><div class="po-ov-sub">/ ${m.max}</div></th>` +
    `<th class="po-ov-col-bm">Bonus / malus</th><th class="po-ov-col-grade">Cijfer</th></tr>`;
  const body = sections(m, view)
    .map(
      (s) =>
        `<tbody class="po-ov-section"><tr class="ov-section"><th class="ov-section__head" colspan="${nCols}" scope="colgroup">` +
        `${esc(s.name)} <span class="ov-section__extra">· ${esc(s.extra)}</span></th></tr>` +
        s.rows.map((r) => rowHtml(m, r, view)).join('') +
        (s.foot ? footHtml(m, s.rows) : '') +
        `</tbody>`,
    )
    .join('');
  return `${bar}<table class="ov-table po-ov-table"><thead>${head}</thead>${body}</table>`;
}

/** The tooltip of a cell key `<student>|c|<category>`, `<student>|pts`, `|bm` or `|cijfer`. */
export function poCellTip(
  m: PoModel,
  allObs: readonly Observatie[],
  key: string,
): TipContent | null {
  const [id, col, catId] = key.split('|');
  const r = m.rows.find((x) => x.id === id);
  if (!r?.group) return null;
  const byId = new Map(allObs.map((o) => [o.id, o]));
  if (col === 'c') {
    const c = m.categories.find((x) => x.id === catId);
    const v = c ? r.grading.scores[c.id] : undefined;
    if (!c || v === undefined) return null;
    const kind = c.soort === 'normaal' ? '' : ` (${c.soort})`;
    const levels = levelsOf(c, v).map((i) => levelText(c, i));
    return {
      head: `${c.naam}: ${v} / ${c.max ?? 0}${kind}`,
      sub: `${levels.length ? `Niveau ${levels.join(' en ')} · ` : ''}projectgroep ${r.group.name}`,
      obs: rowObs(r, m, byId, c.id),
    };
  }
  const obs = rowObs(r, m, byId);
  const { lines, sum } = linesOfRow(r);
  if (col === 'pts')
    return {
      head: `Punten: ${r.points ?? NONE} / ${m.max}`,
      sub: `Projectgroepcijfer ${formatGrade(r.rubricGrade)} (bonus telt mee, diagnostisch niet)`,
      obs,
    };
  if (col === 'bm')
    return {
      head: `Bonus / malus: ${lines.length ? signed(sum) : 'geen'}`,
      sub: lines.length ? lineList(lines) : 'Geen regels voor de groep of de leerling',
      obs,
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
  };
}
