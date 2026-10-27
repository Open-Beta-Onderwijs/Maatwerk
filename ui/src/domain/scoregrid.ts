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

import { calcResults } from './grades';
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
  return Number(String(v).trim().replace(',', '.'));
}

export function scoreCellText(v: unknown): string {
  return String(v).replace('.', ',');
}

/** A typed grade (comma or point) rounded to one decimal; NaN when not 1–10. */
export function parseGradeInput(raw: unknown): number {
  const n = parseScoreNum(raw);
  if (isNaN(n) || n < 1 || n > 10) return NaN;
  return Math.round(n * 10) / 10;
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

/** A grade with one decimal and a comma; '—' for none. */
export function formatGrade(g: number | null | undefined): string {
  if (g === null || g === undefined) return '—';
  return (Math.round(g * 10) / 10).toFixed(1).replace('.', ',');
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
  row[N + 3 + TOFF] =
    res.hasBonus && res.scored > res.normalMax
      ? `${res.scored} / ${res.normalMax} (+)`
      : `${res.scored} / ${res.normalMax}`;
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
  const examMaxTotal = exam.questions.reduce((s, q) => s + q.max_points, 0);
  const totaals: number[] = [],
    grades: number[] = [];

  for (let r = 0; r < summaryIdx; r++) {
    const totaalStr = gridData[r]![N + 3 + TOFF];
    const gradeStr = gridData[r]![N + 4 + TOFF];
    if (totaalStr) {
      // U5: parseInt truncates half points ("7.5 / 16" counts as 7).
      const scored = parseInt(String(totaalStr), 10);
      if (!isNaN(scored)) totaals.push(scored);
    }
    if (gradeStr && gradeStr !== '—') {
      const g = parseFloat(String(gradeStr).replace(',', '.'));
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
  const meanTotaal =
    totaals.length > 0 ? totaals.reduce((a, b) => a + b, 0) / totaals.length : null;
  const meanGrade = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
  clearSpecialRow(avgRow);
  avgRow[N + 3 + TOFF] =
    meanTotaal !== null ? meanTotaal.toFixed(1).replace('.', ',') + ' / ' + examMaxTotal : '';
  avgRow[N + 4 + TOFF] = meanGrade !== null ? meanGrade.toFixed(1).replace('.', ',') : '';

  // Std dev row
  if (stdIdx == null) return;
  const sdRow = gridData[stdIdx]!;
  function sdFn(arr: number[], mean: number) {
    if (arr.length < 2) return null;
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  }
  const sdTotaal = meanTotaal !== null ? sdFn(totaals, meanTotaal) : null;
  const sdGrade = meanGrade !== null ? sdFn(grades, meanGrade) : null;
  clearSpecialRow(sdRow);
  sdRow[N + 3 + TOFF] = sdTotaal !== null ? sdTotaal.toFixed(1).replace('.', ',') : '';
  sdRow[N + 4 + TOFF] = sdGrade !== null ? sdGrade.toFixed(1).replace('.', ',') : '';
}
