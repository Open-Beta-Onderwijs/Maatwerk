// SPDX-License-Identifier: AGPL-3.0-or-later

// The columns of a group's score grid (design spec 4.10, board 13): where each kind of column
// sits, its heading and how its cells look. Row layout: docs at the top of domain/scoregrid.ts.
// The looks are classes in styles/scores.css; only the grade cell's colour is computed.

import { esc } from '../../utils/html';
import type { CellValue, Column } from '../../components/score-grid/score-grid';
import { formatGrade, parseDecimalLoose } from '../../domain/format';
import { gradeCellColor } from '../../domain/grade-colors';
import { qKind } from '../../domain/grades';
import { parseScoreNum, type GridData } from '../../domain/scoregrid';
import type { Exam, Observatie, Question } from '../../domain/types';

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

/** Column widths (board 13); # and Naam stick to the left. */
export const COL_WIDTH = { nr: 72, name: 190, question: 38, spacer: 10, obs: 32 } as const;

// A grid cell's text as a number; null when empty or not a number.
const cellNumber = (v: unknown): number | null => {
  const n = v === '' || v == null ? NaN : parseDecimalLoose(v);
  return Number.isFinite(n) ? n : null;
};

/** Tint of a score cell: full, partial, zero, N (not made) or not a valid score. */
export function scoreTint(value: CellValue, q: Pick<Question, 'max_points'>): string {
  if (value === '' || value === false || value === true) return '';
  if (String(value).toUpperCase().trim() === 'N') return 'sc-n';
  const num = parseScoreNum(value);
  if (isNaN(num) || num < 0 || num > q.max_points) return 'sc-bad';
  if (num === 0) return 'sc-zero';
  return num === q.max_points ? 'sc-full' : 'sc-part';
}

/** Tint of an R/T1/T2/I percentage: ≥ 80 green, ≥ 55 yellow, else red; NVT muted. */
export function pctTint(value: CellValue): string {
  if (value === 'NVT') return 'sc-pct--nvt';
  const pct = cellNumber(value);
  if (pct === null) return '';
  return pct >= 80 ? 'sc-full' : pct >= 55 ? 'sc-part' : 'sc-zero';
}

const ROW_STATUS_TITLE: Record<string, string> = {
  invalid: 'Deze leerling heeft een ongeldige score.',
  partial: 'Nog niet alle scores van deze leerling zijn ingevuld.',
  override: 'Het cijfer van deze leerling is met de hand overschreven.',
};

export function gridColumns(ctx: CellContext): GridColumn[] {
  const { exam, obs, data, layout, rowStatus, decorate } = ctx;
  const { summaryIdx, stdIdx, O } = layout;
  const isSummary = (row: number) => row === summaryIdx || row === stdIdx;
  const summaryClass = (td: HTMLTableCellElement, row: number) => {
    td.classList.add('sc-sum');
    if (row === summaryIdx) td.classList.add('sc-sum-first');
  };

  // Question heading: RTTI tag and points (small), then the section and number.
  const qHeader = (q: Question) => {
    const kind = qKind(q);
    const title =
      kind === 'bonus'
        ? ' title="Bonusvraag"'
        : kind === 'diag'
          ? ' title="Diagnostische vraag"'
          : '';
    return (
      `<span class="sc-qh"${title}>` +
      `<span class="hdr-rtti">${esc(q.rtti)}</span>` +
      `<span class="hdr-pts">${esc(String(q.max_points))}p</span>` +
      `<span class="hdr-opgave">${esc(String(q.section ?? ''))}</span>` +
      `<span class="hdr-vraag">${esc(String(q.number ?? ''))}</span></span>`
    );
  };
  const qHeaderClass = (q: Question) =>
    qKind(q) === 'bonus' ? 'sg-hdr-bonus' : qKind(q) === 'diag' ? 'sg-hdr-diag' : undefined;
  const obsHeader = (o: Observatie, oi: number) =>
    `<span class="hdr-obs" role="img" aria-label="${esc(o.naam ?? '')}" title="${esc(o.naam ?? '')}${oi < 12 ? ` (F${oi + 1})` : ''}">${esc(o.icon ?? '')}</span>`;
  const pctHeader = (k: string) =>
    `<span class="sc-pct-key sc-pct-key--${k.toLowerCase()}" aria-hidden="true"></span>${k}%`;

  function nrRenderer(td: HTMLTableCellElement, row: number, col: number): void {
    td.classList.add('sc-stick0');
    if (isSummary(row)) {
      summaryClass(td, row);
      td.textContent = '';
    } else {
      const status = rowStatus[row] ?? 'ok';
      const mark = status !== 'ok' ? status : data.gradeInfo?.[row]?.overridden ? 'override' : null;
      if (mark) {
        td.classList.add(`sc-row--${mark}`);
        td.title = ROW_STATUS_TITLE[mark] ?? '';
      }
    }
    decorate(td, row, col);
  }

  function nameRenderer(td: HTMLTableCellElement, row: number, col: number): void {
    td.classList.add('sc-stick1', 'sc-name');
    if (isSummary(row)) {
      summaryClass(td, row);
      td.classList.add('sc-sum-label');
    } else if (rowStatus[row] === 'invalid') {
      td.classList.add('sc-name--invalid');
    }
    decorate(td, row, col);
  }

  function scoreRenderer(
    td: HTMLTableCellElement,
    row: number,
    col: number,
    value: CellValue,
  ): void {
    const q = exam.questions[col - layout.firstQCol];
    if (isSummary(row)) summaryClass(td, row);
    else if (q) {
      const kind = qKind(q);
      if (kind !== 'normal') td.classList.add(kind === 'bonus' ? 'sc-bonus' : 'sc-diag');
      const tint = scoreTint(value, q);
      if (tint) td.classList.add(tint);
    }
    decorate(td, row, col);
  }

  function obsRenderer(
    td: HTMLTableCellElement,
    row: number,
    col: number,
    value: CellValue,
  ): void {
    if (isSummary(row)) {
      summaryClass(td, row);
      // The grid empties read-only checkbox cells: write the ticked count (decision 29).
      td.textContent = typeof value === 'string' ? value : '';
    }
    decorate(td, row, col);
  }

  function totalRenderer(
    td: HTMLTableCellElement,
    row: number,
    col: number,
    value: CellValue,
  ): void {
    td.classList.add('sc-total');
    if (isSummary(row)) summaryClass(td, row);
    if (row === stdIdx && value !== '') td.textContent = `± ${String(value)}`;
    decorate(td, row, col);
  }

  function gradeRenderer(
    td: HTMLTableCellElement,
    row: number,
    col: number,
    value: CellValue,
  ): void {
    td.classList.add('sc-grade');
    if (row === stdIdx) {
      summaryClass(td, row);
      if (value !== '') td.textContent = `± ${String(value)}`;
    } else {
      if (row === summaryIdx) summaryClass(td, row);
      const fill = gradeCellColor(cellNumber(value));
      if (fill) {
        td.style.backgroundColor = fill; // keeps the cross-hair's background-image
        td.classList.add('sc-grade--filled');
      }
    }
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

  function pctRenderer(td: HTMLTableCellElement, row: number, col: number, value: CellValue): void {
    td.classList.add('sc-pct');
    if (isSummary(row)) summaryClass(td, row);
    else {
      const tint = pctTint(value);
      if (tint) td.classList.add(tint);
    }
    decorate(td, row, col);
  }

  function spacerRenderer(td: HTMLTableCellElement, row: number, col: number): void {
    td.classList.add('sc-spacer');
    decorate(td, row, col);
  }

  // Column order: #, Naam, scores, spacer, observaties + spacer, Totaal, Cijfer, spacer, RTTI.
  const spacer: GridColumn = {
    width: COL_WIDTH.spacer,
    header: '',
    headerClass: 'sc-spacer',
    render: spacerRenderer,
  };
  return [
    { width: COL_WIDTH.nr, header: '#', headerClass: 'sg-left sc-stick0', render: nrRenderer },
    {
      width: COL_WIDTH.name,
      header: 'Naam',
      headerClass: 'sg-left sc-stick1',
      render: nameRenderer,
    },
    ...exam.questions.map((q) => ({
      width: COL_WIDTH.question,
      header: qHeader(q),
      headerClass: qHeaderClass(q),
      render: scoreRenderer,
    })),
    spacer,
    ...(O > 0
      ? [
          ...obs.map((o, oi): GridColumn => ({
            width: COL_WIDTH.obs,
            header: obsHeader(o, oi),
            kind: 'checkbox',
            render: obsRenderer,
          })),
          spacer,
        ]
      : []),
    { width: 76, header: 'Totaal', render: totalRenderer },
    { width: 60, header: 'Cijfer', render: gradeRenderer },
    spacer,
    ...['R', 'T1', 'T2', 'I'].map((k) => ({
      width: 52,
      header: pctHeader(k),
      render: pctRenderer,
    })),
  ];
}
