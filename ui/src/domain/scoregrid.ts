// SPDX-License-Identifier: AGPL-3.0-or-later

// Score grid logic (score modal, docs/specs/score-grid.md): input parsing, row
// status, and the computed columns and summary rows of a group's grid. Moved
// out of the score modal (now screens/scores/) in Step 3b; golden: scoregrid.json.
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
import { classQuestions, stats } from './statistics';
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

/** A row's question cells as the core reads them: empty left out, N null, a number, or the text. */
function rowQuestionScores(row: GridCell[], exam: Pick<Exam, 'questions'>): QuestionScores {
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
    questionScores[q.id] = isNaN(n) ? String(raw) : n;
  });
  return questionScores;
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
  const questionScores = rowQuestionScores(row, exam);

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
    // Only rows with a grade, as on the exam card (decision 26).
    if (totaalStr && gradeStr && gradeStr !== '—') {
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

  // Step 25 (decision 29): per question the class average as on the rapport (N counts 0, empty
  // is left out); per observatie how many are ticked; per RTTI category the mean of the
  // percentages of the rows with a grade (NVT left out), whole percent.
  const rows = gridData.slice(0, summaryIdx);
  const perStudent = rows.map((row) => rowQuestionScores(row, exam));
  const perQuestion = classQuestions(exam.questions, perStudent);
  exam.questions.forEach((q, qi) => {
    const anyEntry = perStudent.some((s) => q.id in s);
    avgRow[2 + qi] = anyEntry ? formatFixed(perQuestion[qi]!.classAvg) : '';
  });
  for (let i = 0; i < O; i++) {
    avgRow[N + 3 + i] = rows.length ? String(rows.filter((r) => r[N + 3 + i] === true).length) : '';
  }
  const graded = rows.filter((r) => {
    const g = r[N + 4 + TOFF];
    return g && g !== '—';
  });
  for (let k = 0; k < 4; k++) {
    const col = N + 6 + TOFF + k;
    const pcts = graded
      .map((r) => parseDecimalLoose(r[col]))
      .filter((p): p is number => Number.isFinite(p));
    const mean = stats(pcts)?.mean;
    avgRow[col] = mean !== undefined ? `${formatFixed(mean, 0)}%` : graded.length ? 'NVT' : '';
  }

  // Std dev row
  if (stdIdx == null) return;
  const sdRow = gridData[stdIdx]!;
  clearSpecialRow(sdRow);
  sdRow[N + 3 + TOFF] = totaalStats ? formatFixed(totaalStats.sd) : '';
  sdRow[N + 4 + TOFF] = gradeStats ? formatFixed(gradeStats.sd) : '';
}

/** The status line of a group in the score modal (board 13) and how it reads. */
export interface GroupStatus {
  text: string;
  /** `ok`: every score entered; `todo`: some missing; `bad`: an invalid score. */
  level: 'ok' | 'todo' | 'bad';
}

/**
 * "alle scores ingevuld", "nog geen scores" or "<k> nog niet compleet", with
 * "<k> met een ongeldige score" first when there are any. A student is complete when every
 * question has an entry (N counts) and none is invalid.
 */
export function groupStatus(rows: GridCell[][], exam: Pick<Exam, 'questions'>): GroupStatus {
  const N = exam.questions.length;
  let invalid = 0,
    incomplete = 0,
    anyEntry = false;
  for (const row of rows) {
    const status = computeRowStatus(row, exam);
    let filled = 0;
    for (let qi = 0; qi < N; qi++) {
      const v = row[2 + qi];
      if (v !== '' && v !== undefined && v !== null) filled++;
    }
    if (filled > 0) anyEntry = true;
    if (status === 'invalid') invalid++;
    else if (filled < N) incomplete++;
  }
  if (invalid > 0) {
    const rest = incomplete > 0 ? `, ${incomplete} nog niet compleet` : '';
    return { text: `${invalid} met een ongeldige score${rest}`, level: 'bad' };
  }
  if (!anyEntry && rows.length > 0 && N > 0) return { text: 'nog geen scores', level: 'todo' };
  if (incomplete > 0) return { text: `${incomplete} nog niet compleet`, level: 'todo' };
  return { text: 'alle scores ingevuld', level: 'ok' };
}
