// SPDX-License-Identifier: AGPL-3.0-or-later

// Group overview, tab Resultaten (spec 4.5.1, board 45; decisions 28, 29): rows of 30 px, test
// columns grouped by PERIODE, then JAAR with "gem." and (examendossier groups) "SE". Names as
// links with "· leerlingnummer" and the trend arrow; grade pills with the resit dot and the grade
// tooltip; a sticky tfoot with GEMIDDELDE and STANDAARDDEVIATIE.

import { formatGrade } from '../../domain/format';
import { testKindLabel } from '../../domain/test-type';
import type { Observatie } from '../../domain/types';
import { examBadgeHtml, ovPillHtml } from '../../overview/common';
import { gradeWithDotHtml, resitSubline } from '../../overview/resit-dot';
import {
  averagesStats,
  columnStats,
  meanSdRowsHtml,
  type FootColumn,
} from '../../overview/sections';
import type { TipContent } from '../../overview/tooltip';
import { trendArrowHtml } from '../../screens/cards/card-html';
import { esc } from '../../utils/html';
import { columnGrades, type Cell, type Column, type GroupModel } from './model';

export interface NameOf {
  (s: GroupModel['rows'][number]['student']): string;
}

function examTitle(c: Column): string {
  return `${c.original.title ?? ''}${c.diagnostic ? ' (telt niet mee)' : ''}`;
}

/** The tooltip of a cell (decision 29). */
export function cellTip(
  col: Column,
  cell: Cell,
  observaties: ReadonlyMap<string, Observatie>,
): TipContent {
  const head = `${col.original.volgnummer ?? ''} ${col.original.title ?? ''}: ${formatGrade(cell.grade)}`;
  let sub: string;
  if (col.po) {
    sub = cell.unplaced
      ? 'Niet ingedeeld in een projectgroep'
      : `Praktische opdracht${cell.projectgroep ? ` · projectgroep ${cell.projectgroep}` : ''}`;
    if (cell.resit) sub = `${resitSubline(cell.resit, cell.originalGrade)} · ${sub}`;
  } else if (col.diagnostic) sub = 'Diagnostisch, telt niet mee';
  else if (cell.resit) sub = resitSubline(cell.resit, cell.originalGrade);
  else sub = testKindLabel(col.kind);
  const obs = cell.obs
    .map((id) => observaties.get(id))
    .filter((o): o is Observatie => !!o)
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'));
  return { head, sub, obs: cell.grade === null && !obs.length ? null : obs };
}

export function resultatenHtml(m: GroupModel, nameOf: NameOf): string {
  const jaarSpan = m.showSe ? 2 : 1;
  const groupRow =
    `<tr class="ov-head-group"><th class="ov-head-gap"></th>` +
    m.periodes.map((p) => `<th colspan="${p.span}" class="gl-th">${esc(p.label)}</th>`).join('') +
    `<th colspan="${jaarSpan}" class="gl-th gl-th--jaar">JAAR</th></tr>`;
  const headRow =
    `<tr><th class="ov-name-th">Naam</th>` +
    m.columns
      .map((c) => `<th class="gl-col">${examBadgeHtml(c.original, examTitle(c))}</th>`)
      .join('') +
    `<th class="gl-col gl-col--jaar ov-col-jaar" title="Gewogen jaargemiddelde">gem.</th>` +
    (m.showSe
      ? `<th class="gl-col gl-col--jaar ov-col-jaar" title="Gemiddelde examendossier">SE</th>`
      : '') +
    `</tr>`;
  const half = m.columns.length / 2;
  const body = m.rows
    .map((r, i) => {
      const s = r.student;
      const name =
        `<td class="ov-name-td"><span class="ov-name">` +
        `<button type="button" class="ov-name__link student-name-btn" data-action="open-student-from-group" data-id="${esc(s.id)}">${esc(nameOf(s))}</button>` +
        `<span class="ov-name__nr">· ${esc(s.id)}</span>` +
        (r.trend ? trendArrowHtml(r.trend) : '') +
        `</span></td>`;
      const cells = r.cells
        .map((cell, j) => {
          const col = m.columns[j]!;
          const pill = ovPillHtml(cell.grade, col.diagnostic);
          const align = j >= half && j > 0 ? ' data-tip-align="right"' : '';
          return `<td class="gl-cell" data-tip="${i}|${j}"${align} tabindex="-1">${gradeWithDotHtml(pill, cell.resit, { dotted: cell.obs.length > 0 })}</td>`;
        })
        .join('');
      const jaar =
        `<td class="ov-col-jaar">${ovPillHtml(r.yearAvg)}</td>` +
        (m.showSe ? `<td class="ov-col-jaar">${ovPillHtml(r.seAvg)}</td>` : '');
      return `<tr class="ov-row">${name}${cells}${jaar}</tr>`;
    })
    .join('');
  const foot: FootColumn[] = [
    ...m.columns.map((c, j) => ({
      cell: columnStats(columnGrades(m, j)),
      diagnostic: c.diagnostic,
    })),
    {
      cell: averagesStats(m.rows.map((r) => r.yearAvg).filter((g): g is number => g !== null)),
      className: 'ov-col-jaar',
    },
    ...(m.showSe
      ? [
          {
            cell: averagesStats(m.rows.map((r) => r.seAvg).filter((g): g is number => g !== null)),
            className: 'ov-col-jaar',
          },
        ]
      : []),
  ];
  return (
    `<table class="ov-table gl-table"><thead>${groupRow}${headRow}</thead>` +
    `<tbody>${body}</tbody><tfoot>${meanSdRowsHtml(foot)}</tfoot></table>`
  );
}
