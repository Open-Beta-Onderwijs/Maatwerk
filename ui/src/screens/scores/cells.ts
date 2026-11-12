// SPDX-License-Identifier: AGPL-3.0-or-later

// The columns of a group's score grid: where each kind of column sits, its heading and how its
// cells look. Row layout: docs at the top of domain/scoregrid.ts.

import { escHtml } from '../../app.js';
import type { CellValue, Column } from '../../components/score-grid/score-grid';
import { formatGrade, parseDecimalLoose } from '../../domain/format';
import { gradeCellColor, rttiPctCellColor, sdCellColor } from '../../domain/grade-colors';
import { qKind } from '../../domain/grades';
import { parseScoreNum, type GridData } from '../../domain/scoregrid';
import type { Exam, Observatie } from '../../domain/types';

export type RowStatus = 'ok' | 'partial' | 'invalid';

/** Where the columns and rows of one group's grid are. */
export interface GridLayout {
  /** Questions and observaties. */
  N: number;
  O: number;
  firstQCol: number;
  lastQCol: number;
  /** First observatie column (only meaningful when O > 0). */
  obsStart: number;
  lastObsCol: number;
  totalCol: number;
  gradeCol: number;
  /** The GEMIDDELDE and STANDAARDDEVIATIE rows. */
  summaryIdx: number;
  stdIdx: number;
  lastDataRow: number;
}

export function gridLayout(exam: Exam, O: number, data: GridData): GridLayout {
  const N = exam.questions.length;
  const summaryIdx = data.findIndex((r) => r[0] === '__avg__');
  const TOFF = O > 0 ? O + 1 : 0;
  return {
    N,
    O,
    firstQCol: 2,
    lastQCol: N + 1,
    obsStart: N + 3,
    lastObsCol: O > 0 ? N + 3 + O - 1 : -1,
    totalCol: N + 3 + TOFF,
    gradeCol: N + 4 + TOFF,
    summaryIdx,
    stdIdx: data.findIndex((r) => r[0] === '__std__'),
    lastDataRow: summaryIdx - 1,
  };
}

export const isQCol = (l: GridLayout, col: number) => col >= l.firstQCol && col <= l.lastQCol;
export const isObsCol = (l: GridLayout, col: number) =>
  l.O > 0 && col >= l.obsStart && col <= l.lastObsCol;

/** What the renderers read of the group grid. */
export interface CellContext {
  exam: Exam;
  obs: Observatie[];
  data: GridData;
  layout: GridLayout;
  rowStatus: RowStatus[];
  /** Selection cross-hair, a colleague's flash and the "not saved" mark. */
  decorate(td: HTMLTableCellElement, row: number, col: number): void;
}

export interface GridColumn extends Column {
  render(td: HTMLTableCellElement, row: number, col: number, value: CellValue): void;
}

// A grid cell's text as a number; null when empty or not a number.
const cellNumber = (v: unknown): number | null => {
  const n = v === '' || v == null ? NaN : parseDecimalLoose(v);
  return Number.isFinite(n) ? n : null;
};

export function gridColumns(ctx: CellContext): GridColumn[] {
  const { exam, obs, data, layout, rowStatus, decorate } = ctx;
  const { summaryIdx, stdIdx, O } = layout;
  const isSummary = (row: number) => row === summaryIdx || row === stdIdx;

  // Question headers: RTTI (top) → pts → section → number (bottom).
  const qHeader = (q: Exam['questions'][number]) => {
    const kind = qKind(q);
    const parts =
      `<span class="hdr-rtti">${escHtml(q.rtti)}</span>` +
      `<span class="hdr-pts">${q.max_points}p</span>`;
    if (kind !== 'normal') {
      const tooltip = kind === 'bonus' ? 'Bonusvraag' : 'Diagnostische vraag';
      return (
        `<span class="u-text-subtle u-italic" title="${tooltip}">${parts}` +
        `<span class="u-text-subtle hdr-opgave">${escHtml(String(q.section ?? ''))}</span>` +
        `<span class="u-text-subtle hdr-vraag">${escHtml(String(q.number ?? ''))}</span></span>`
      );
    }
    return (
      parts +
      `<span class="hdr-opgave">${escHtml(String(q.section ?? ''))}</span>` +
      `<span class="hdr-vraag">${escHtml(String(q.number ?? ''))}</span>`
    );
  };
  // Tint bonus/diag question headers to match the cell background.
  const qHeaderClass = (q: Exam['questions'][number]) =>
    qKind(q) === 'bonus' ? 'sg-hdr-bonus' : qKind(q) === 'diag' ? 'sg-hdr-diag' : undefined;
  const obsHeader = (o: Observatie, oi: number) =>
    `<span class="hdr-obs" title="${escHtml(o.naam ?? '')}${oi < 12 ? ` (F${oi + 1})` : ''}">${escHtml(o.icon ?? '')}</span>`;

  // Background of the # and Naam cells: red for invalid scores, yellow for missing scores,
  // light blue for an overwritten grade.
  function rowBackground(row: number, status: RowStatus | null): string {
    if (isSummary(row)) return '#e8ecf2';
    if (status === 'invalid') return '#ff0033';
    if (status === 'partial') return '#fff3cd';
    if (data.gradeInfo?.[row]?.overridden) return '#dce9fa';
    return '#f8f9fb';
  }

  function idRenderer(td: HTMLTableCellElement, row: number, col: number): void {
    const status = isSummary(row) ? null : (rowStatus[row] ?? 'ok');
    td.style.background = rowBackground(row, status);
    td.style.color = status === 'invalid' ? '#fff' : '';
    td.style.textAlign = 'center';
    if (isSummary(row)) td.style.color = 'transparent';
    decorate(td, row, col);
  }

  function naamRenderer(td: HTMLTableCellElement, row: number, col: number): void {
    const special = isSummary(row);
    const status = special ? null : (rowStatus[row] ?? 'ok');
    td.style.background = rowBackground(row, status);
    td.style.color = status === 'invalid' ? '#fff' : special ? 'var(--muted, #7f8c8d)' : '#000';
    td.style.fontWeight = special ? '700' : '400';
    td.style.fontStyle = special ? 'italic' : 'normal';
    decorate(td, row, col);
  }

  function calcCentered(td: HTMLTableCellElement, row: number, col: number): void {
    td.style.textAlign = 'center';
    td.style.background = isSummary(row) ? '#dde4f0' : '#eef2f7';
    td.style.fontWeight = '600';
    decorate(td, row, col);
  }

  function gradeRenderer(
    td: HTMLTableCellElement,
    row: number,
    col: number,
    value: CellValue,
  ): void {
    td.style.textAlign = 'center';
    td.style.fontWeight = 'bold';
    td.style.color = '#000';
    if (row === stdIdx) td.style.background = sdCellColor(cellNumber(value)) || '#dde4f0';
    else if (row === summaryIdx) {
      td.style.background = gradeCellColor(cellNumber(value)) || '#dde4f0';
    } else td.style.background = gradeCellColor(cellNumber(value)) || '#eef2f7';
    const info = row < summaryIdx ? data.gradeInfo?.[row] : undefined;
    const overridden = !!info?.overridden;
    td.classList.toggle('grade-override', overridden);
    td.classList.toggle('grade-override-stale', overridden && !!info?.stale);
    td.title =
      info && overridden
        ? `Met de hand overschreven cijfer. Berekend cijfer: ${formatGrade(info.calculatedGrade)}.` +
          (info.stale
            ? `\nLet op: het berekende cijfer is gewijzigd sinds het overschrijven (was ${formatGrade(info.berekend)}). Vul het cijfer opnieuw in om dit te bevestigen.`
            : '') +
          `\nLeegmaken of rechtermuisklik herstelt het berekende cijfer.`
        : '';
    decorate(td, row, col);
  }

  function rttiRenderer(
    td: HTMLTableCellElement,
    row: number,
    col: number,
    value: CellValue,
  ): void {
    td.style.textAlign = 'center';
    td.style.fontWeight = '500';
    td.style.background =
      row === summaryIdx
        ? '#e8ecf2'
        : rttiPctCellColor(value === 'NVT' ? null : cellNumber(value)) || '#eef2f7';
    decorate(td, row, col);
  }

  function scoreRenderer(
    td: HTMLTableCellElement,
    row: number,
    col: number,
    value: CellValue,
  ): void {
    td.style.textAlign = 'center';
    if (isSummary(row)) {
      td.style.background = '#e8ecf2';
      decorate(td, row, col);
      return;
    }
    const q = exam.questions[col - 2];
    const kind = q ? qKind(q) : 'normal';
    // Bonus: always blue; Diag: always gray, regardless of value.
    if (kind === 'bonus') {
      td.style.background = '#cce5ff';
      td.style.fontStyle = 'italic';
    } else if (kind === 'diag') {
      td.style.background = '#d0d6df';
      td.style.fontStyle = 'italic';
    }
    if (!value || !q) {
      decorate(td, row, col);
      return;
    }
    const upper = String(value).toUpperCase().trim();
    if (upper === 'N') {
      td.style.background = '#d0d6df';
      td.style.color = '#4a5568';
      td.style.fontWeight = '600';
      decorate(td, row, col);
      return;
    }
    const num = parseScoreNum(value);
    if (isNaN(num) || num < 0 || num > q.max_points) {
      td.style.background = '#ff0033';
      td.style.color = '#fff';
      td.style.fontWeight = '700';
      decorate(td, row, col);
      return;
    }
    if (kind === 'normal') {
      if (value === '0') td.style.background = '#f8d7da';
      else if (num === q.max_points) td.style.background = '#d4edda';
      else td.style.background = '#fff3cd';
    }
    decorate(td, row, col);
  }

  function obsRenderer(td: HTMLTableCellElement, row: number, col: number): void {
    if (isSummary(row)) td.style.background = '#e8ecf2';
    decorate(td, row, col);
  }

  const plain = (td: HTMLTableCellElement, row: number, col: number) => decorate(td, row, col);

  // Column order: #, Naam, scores, spacer1, obs + spacer2, Totaal, Cijfer, spacer3, RTTI.
  const spacer: GridColumn = { width: 20, header: '', render: plain };
  return [
    { width: 72, header: '#', render: idRenderer },
    { width: 150, header: 'Naam', headerClass: 'sg-left', render: naamRenderer },
    ...exam.questions.map((q) => ({
      width: 32,
      header: qHeader(q),
      headerClass: qHeaderClass(q),
      render: scoreRenderer,
    })),
    spacer,
    ...(O > 0
      ? [
          ...obs.map((o, oi): GridColumn => ({
            width: 28,
            header: obsHeader(o, oi),
            kind: 'checkbox',
            render: obsRenderer,
          })),
          spacer,
        ]
      : []),
    { width: 72, header: 'Totaal', render: calcCentered },
    { width: 52, header: 'Cijfer', render: gradeRenderer },
    spacer,
    ...['R%', 'T1%', 'T2%', 'I%'].map((header) => ({ width: 44, header, render: rttiRenderer })),
  ];
}
