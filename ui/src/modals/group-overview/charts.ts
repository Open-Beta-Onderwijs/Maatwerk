// SPDX-License-Identifier: AGPL-3.0-or-later

// Group overview, tabs Cijferverdeling, Boxplot and RTTI-analyse (spec 4.5.2-4.5.4; decisions
// 30-32): a histogram card per test (three per row, step 1), a boxplot row per test in its type
// colour, the RTTI-verloop over the year and an RTTI card per test (PO's left out, with a note).

import { stats } from '../../domain/statistics';
import { emptyHtml, examBadgeHtml, meanLineHtml } from '../../overview/common';
import { boxplotHtml } from '../../overview/boxplot';
import { histogramHtml, histogramModel } from '../../overview/histogram';
import { rttiCardHtml } from '../../overview/rtti-card';
import { rttiLegendHtml, rttiLineHtml, rttiLineModel } from '../../overview/rtti-line';
import { esc } from '../../utils/html';
import { columnGrades, rttiColumns, type GroupModel } from './model';

const NO_TESTS = 'Nog geen toetsen voor deze jaarlaag.';

export function verdelingHtml(m: GroupModel): string {
  if (!m.columns.length) return emptyHtml(NO_TESTS);
  const cards = m.columns
    .map((c, j) => {
      const grades = columnGrades(m, j);
      const title = c.original.title ?? '';
      return (
        `<div class="ov-card ov-card--small"><div class="ov-card__head">${examBadgeHtml(c.original)}<span class="ov-card__title" title="${esc(title)}">${esc(title)}</span></div>` +
        `<div class="ov-card__sub">${meanLineHtml(grades.length ? stats(grades) : null)}</div>` +
        histogramHtml(histogramModel(grades, 1, 100), {
          height: 100,
          label: `Cijferverdeling ${title}`,
        }) +
        `</div>`
      );
    })
    .join('');
  return `<div class="ov-grid ov-grid--3">${cards}</div>`;
}

export function boxHtml(
  m: GroupModel,
  nameOf: (s: GroupModel['rows'][number]['student']) => string,
): string {
  if (!m.columns.length) return emptyHtml(NO_TESTS);
  return boxplotHtml(
    m.columns.map((c, j) => ({
      labelHtml: `${examBadgeHtml(c.original)}<span title="${esc(c.original.title ?? '')}">${esc(c.original.title ?? '')}</span>`,
      kind: c.kind,
      points: m.rows
        .filter((r) => r.cells[j]!.grade !== null)
        .map((r) => ({ name: nameOf(r.student), grade: r.cells[j]!.grade! })),
    })),
  );
}

/** The note under the RTTI-verloop: PO's have no RTTI, diagnostic tests count for nothing. */
function rttiNote(m: GroupModel): string {
  const code = (c: GroupModel['columns'][number]) =>
    `${c.original.volgnummer ?? ''} ${c.original.title ?? ''}`.trim();
  const po = m.columns.filter((c) => c.po);
  const diag = m.columns.filter((c) => c.diagnostic && !c.po);
  const parts: string[] = [];
  if (po.length)
    parts.push(
      `${po.map(code).join(', ')} ${po.length === 1 ? 'is een praktische opdracht en heeft' : 'zijn praktische opdrachten en hebben'} geen RTTI-verdeling.`,
    );
  if (diag.length)
    parts.push(
      `${diag.map((c) => c.original.volgnummer ?? '').join(', ')} ${diag.length === 1 ? 'is' : 'zijn'} diagnostisch.`,
    );
  if (!parts.length) return '';
  return (
    `<div class="ov-note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>` +
    `<span>${esc(parts.join(' '))}</span></div>`
  );
}

/** The RTTI tab. `width`: the chart's width in px (measured from the pane). */
export function rttiHtml(m: GroupModel, width: number): string {
  const cols = rttiColumns(m);
  if (!cols.length) return `${emptyHtml('Nog geen RTTI-gegevens voor deze groep.')}${rttiNote(m)}`;
  const model = rttiLineModel(
    cols.map((c) => ({ exam: c.col.original, pcts: c.pcts })),
    Math.max(400, Math.round(width)),
    250,
  );
  const line =
    `<div class="ov-card"><h3 class="ov-card__h3">RTTI-verloop over het jaar</h3>${rttiLegendHtml()}` +
    rttiLineHtml(model, 'RTTI-verloop over het schooljaar') +
    rttiNote(m) +
    `</div>`;
  const cards = cols
    .map((c) =>
      rttiCardHtml({
        leadHtml: examBadgeHtml(c.col.original),
        title: c.col.original.title ?? '',
        pcts: c.pcts,
      }),
    )
    .join('');
  return `<div class="ov-stack">${line}<div class="ov-grid ov-grid--2 ov-grid--flush">${cards}</div></div>`;
}
