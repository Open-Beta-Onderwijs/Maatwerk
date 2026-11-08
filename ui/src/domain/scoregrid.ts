// SPDX-License-Identifier: AGPL-3.0-or-later

// Score grid logic (score modal, docs/specs/score-grid.md): input parsing, row
// status, and the computed columns and summary rows of a group's grid. Moved
// out of screens/scores.js in Step 3b; golden: scoregrid.json.
//
// Column layout of a grid row (N questions, O observaties, TOFF = O > 0 ? O + 1 : 0):
//   0..1        = id, naam
//   2..N+1      = question scores
//   N+2         = spacer1
//   N+3..N+2+O  = obs checkboxes (if O > 0)
//   N+3+O       = spacer2 (if O > 0)
//   N+3+TOFF    = Totaal
//   N+4+TOFF    = Cijfer
//   N+5+TOFF    = spacer3
//   N+6+TOFF    = R%, then T1%, T2%, I%

import { round1 } from './core';
import { formatFixed, formatGrade, formatNumber, parseDecimal, parseDecimalLoose } from './format';
import { calcResults } from './grades';
import { stats } from './statistics';
import type { Exam, Override, Question, QuestionScores } from './types';

export type GridCell = string | boolean | number | null | undefined;

/** What recomputeRow derived for a row's Cijfer cell (look and tooltip). */
export interface GradeInfo {
  calculatedGrade: number | null;
  overridden: boolean;
  stale: boolean;
  berekend: number | null;
}

/** Rows of one group's grid; `overrides` and `gradeInfo` are indexed by row. */
export type GridData = GridCell[][] & {
  overrides?: Record<number, Override | undefined>;
  gradeInfo?: Record<number, GradeInfo>;
};

type GridExam = Pick<Exam, 'n_term' | 'questions'>;

/** Scores may be typed with a decimal comma or point; the grid shows a comma. */
export function parseScoreNum(v: unknown): number {
  return parseDecimal(v);
}

export function scoreCellText(v: unknown): string {
  return formatNumber(String(v));
}

/** A typed grade (comma or point) rounded to one decimal; NaN when not 1–10. */
export function parseGradeInput(raw: unknown): number {
  const n = parseScoreNum(raw);
  if (isNaN(n) || n < 1 || n > 10) return NaN;
  return round1(n);
}

export function sameOverride(
  a: Partial<Override> | null | undefined,
  b: Partial<Override> | null | undefined,
): boolean {
  return (
    (a?.cijfer ?? null) === (b?.cijfer ?? null) && (a?.berekend ?? null) === (b?.berekend ?? null)
  );
}

/**
 * How typed input is shown in the grid (`cell`) and stored (`value`):
 * empty → removed, N → null (not evaluated), valid number → number,
 * anything else → kept as typed so it can be corrected.
 */
export function normalizeScore(
  input: unknown,
  q: Pick<Question, 'max_points'>,
): { cell: string; value: number | string | null | undefined } {
  const raw = String(input ?? '').trim();
  if (raw === '') return { cell: '', value: undefined };
  if (raw.toUpperCase() === 'N') return { cell: 'N', value: null };
  const num = parseScoreNum(raw);
  if (isNaN(num) || num < 0 || num > q.max_points) return { cell: raw, value: raw };
  return { cell: scoreCellText(num), value: num };
}

/**
 * Status of a student row, shown on its # and Naam cells: 'invalid' (a score
 * that is not N or 0…max), 'partial' (some questions entered) or 'ok'.
 */
export function computeRowStatus(
  row: GridCell[] | undefined,
  exam: Pick<Exam, 'questions'>,
): 'ok' | 'partial' | 'invalid' {
  if (!row || row[0] === '__avg__' || row[0] === '__std__') return 'ok';
  let filled = 0,
    invalid = false;
  for (let qi = 0; qi < exam.questions.length; qi++) {
    const q = exam.questions[qi]!;
    const val = row[2 + qi];
    if (val === '' || val === undefined || val === null) continue;
    filled++;
    const upper = String(val).toUpperCase().trim();
    if (upper === 'N') continue;
    const num = parseScoreNum(val);
    if (isNaN(num) || num < 0 || num > q.max_points) invalid = true;
  }
  if (invalid) return 'invalid';
  if (filled > 0 && filled < exam.questions.length) return 'partial';
  return 'ok';
}

/**
 * Fills the computed columns (Totaal, Cijfer, R%…I%) of row `rowIdx` from its
 * question cells. A grade overwritten by the teacher (gridData.overrides[rowIdx])
 * replaces the calculated one; gridData.gradeInfo[rowIdx] tells the renderer about it.
 */
export function recomputeRow(gridData: GridData, exam: GridExam, rowIdx: number, O = 0): void {
  const N = exam.questions.length;
  const TOFF = O > 0 ? O + 1 : 0;
  const row = gridData[rowIdx]!;

  const questionScores: QuestionScores = {};
  exam.questions.forEach((q, qi) => {
    const raw = row[2 + qi];
    if (raw === '' || raw === undefined || raw === null) return;
    const s = String(raw).toUpperCase().trim();
    if (s === 'N') {
      questionScores[q.id] = null;
      return;
    }
    const n = parseScoreNum(raw);
    questionScores[q.id] = isNaN(n) ? (raw as string) : n;
  });

  const override = gridData.overrides?.[rowIdx];
  const setGradeInfo = (res: ReturnType<typeof calcResults>) => {
    if (!gridData.gradeInfo) return;
    gridData.gradeInfo[rowIdx] = {
      calculatedGrade: res.calculatedGrade,
      overridden: res.overridden,
      stale: res.overrideStale,
      berekend: override?.berekend ?? null,
    };
  };

  if (Object.keys(questionScores).length === 0) {
    setGradeInfo(calcResults(exam, {}, override));
    row[N + 2] = ''; // spacer1
    if (O > 0) row[N + 3 + O] = ''; // spacer2
    row[N + 3 + TOFF] = '';
    row[N + 4 + TOFF] = override ? formatGrade(override.cijfer) : '';
    row[N + 5 + TOFF] = '';
    row[N + 6 + TOFF] = '';
    row[N + 7 + TOFF] = '';
    row[N + 8 + TOFF] = '';
    row[N + 9 + TOFF] = '';
    return;
  }

  const res = calcResults(exam, questionScores, override);
  setGradeInfo(res);
  const pct = (v: number | 'NVT') => (v === 'NVT' ? 'NVT' : v + '%');
  row[N + 2] = ''; // spacer1
  if (O > 0) row[N + 3 + O] = ''; // spacer2 — obs cols untouched
  // Decimal comma (B5); the core's totals have no floating-point noise (decision 3).
  const totaal = `${formatNumber(res.scored)} / ${formatNumber(res.normalMax)}`;
  row[N + 3 + TOFF] = res.hasBonus && res.scored > res.normalMax ? `${totaal} (+)` : totaal;
  row[N + 4 + TOFF] = res.grade !== null ? formatGrade(res.grade) : '';
  row[N + 5 + TOFF] = ''; // spacer3
  row[N + 6 + TOFF] = pct(res.R);
  row[N + 7 + TOFF] = pct(res.T1);
  row[N + 8 + TOFF] = pct(res.T2);
  row[N + 9 + TOFF] = pct(res.I);
}

/** Fills the "Gemiddelde" (summaryIdx) and "Standaarddeviatie" (stdIdx) rows. */
export function recomputeSummaryRow(
  gridData: GridData,
  summaryIdx: number,
  stdIdx: number | null | undefined,
  exam: GridExam,
  O = 0,
): void {
  const N = exam.questions.length;
  const TOFF = O > 0 ? O + 1 : 0;
  // The max of the normal questions, as each row shows (B4, decision 12).
  const { normalMax } = calcResults(exam, {});
  const totaals: number[] = [],
    grades: number[] = [];

  for (let r = 0; r < summaryIdx; r++) {
    const totaalStr = gridData[r]![N + 3 + TOFF];
    const gradeStr = gridData[r]![N + 4 + TOFF];
    if (totaalStr) {
      // The points before " / " in the row's Totaal, half points included (B4, U5).
      const scored = parseDecimalLoose(totaalStr);
      if (!isNaN(scored)) totaals.push(scored);
    }
    if (gradeStr && gradeStr !== '—') {
      const g = parseDecimalLoose(gradeStr);
      if (!isNaN(g)) grades.push(g);
    }
  }

  function clearSpecialRow(row: GridCell[]) {
    row[N + 2] = ''; // spacer1
    if (O > 0) {
      for (let i = 0; i < O; i++) row[N + 3 + i] = '';
      row[N + 3 + O] = ''; // spacer2
    }
    for (let c = N + 3 + TOFF; c <= N + 9 + TOFF; c++) row[c] = '';
  }

  // Avg row
  const avgRow = gridData[summaryIdx]!;
  const totaalStats = stats(totaals);
  const gradeStats = stats(grades);
  clearSpecialRow(avgRow);
  avgRow[N + 3 + TOFF] = totaalStats
    ? `${formatFixed(totaalStats.mean)} / ${formatNumber(normalMax)}`
    : '';
  avgRow[N + 4 + TOFF] = gradeStats ? formatFixed(gradeStats.mean) : '';

  // Std dev row
  if (stdIdx == null) return;
  const sdRow = gridData[stdIdx]!;
  clearSpecialRow(sdRow);
  sdRow[N + 3 + TOFF] = totaalStats ? formatFixed(totaalStats.sd) : '';
  sdRow[N + 4 + TOFF] = gradeStats ? formatFixed(gradeStats.sd) : '';
}
