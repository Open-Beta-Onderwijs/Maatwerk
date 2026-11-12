// SPDX-License-Identifier: AGPL-3.0-or-later

// The open score modal's shared state (spec docs/specs/score-grid.md): the group grids, the save
// queue, the undo history and the hooks for colleagues' changes. One modal at a time.

import { persistentError, toast } from '../../app.js';
import type { ScoreGrid } from '../../components/score-grid/score-grid';
import { recomputeRow, recomputeSummaryRow, type GridData } from '../../domain/scoregrid';
import type { Exam, Observatie, ScoreRecord, Student } from '../../domain/types';
import * as Presence from '../../presence.js';
import { READ_ONLY_SAVE_TEXT, isReadOnlyError, noteReadOnly } from '../../services/read-only';
import { Store } from '../../store.js';

/** A colleague's position in a grid (presence). */
export interface RemoteCursor {
  studentId: string;
  questionId: string;
  color: string;
  name: string;
}

/** One undo step; returns false when the cell was changed by someone else since. */
export interface HistoryEntry {
  undo(): unknown;
  redo(): unknown;
}

const MAX_HISTORY = 50;
export const REMOTE_FLASH_MS = 2000;
export const REMOTE_FLASH_COLOR = '#f5a623';

export const session = {
  activeExam: null as Exam | null,
  /** Observaties of the exam, by name. */
  activeObs: [] as Observatie[],
  activeGridData: [] as GridData[],
  gridInstances: [] as ScoreGrid[],
  /** One per group grid: applies a colleague's score file to that student's row. */
  rowUpdaters: [] as ((studentId: string, rec: ScoreRecord | null) => void)[],
  /** One per group grid: draws colleagues' positions in that grid. */
  cursorUpdaters: [] as ((cursors: RemoteCursor[]) => void)[],
  /** Groups, students and observaties shown; a change of these reloads the modal. */
  activeRoster: null as string | null,
  /**
   * Grows on every (re)build and teardown: a group grid still waiting for idle time checks it
   * and gives up when its build was replaced (Step 7c).
   */
  buildToken: 0,
  /** Outline of cells changed by a colleague: the colour of the most recent editor here. */
  remoteFlashColor: REMOTE_FLASH_COLOR,
  /** Numpad '.' writes N (toggle in the header; kept for the rest of the app session). */
  numpadDotIsN: true,
  /** Called after a save starts or ends (the footer's save status). */
  onSaveState: null as (() => void) | null,
};

// ── Saving ───────────────────────────────────────────────────────────────────

// Saves run one after the other, in the order they were made: a value typed while an earlier
// save is still in flight is queued, never dropped (U2).
let saveChain: Promise<unknown> = Promise.resolve();
// Cells with a save in flight ("studentId:col" -> count). Background updates skip these, so a
// slightly older file on disk never overwrites fresh input.
export const pendingSaves = new Map<string, number>();
// Cells whose last save failed ("studentId:col"); typing the same value again retries (G53).
const unsavedCells = new Set<string>();

export const cellKey = (student: Student | undefined, col: number) => `${student?.id}:${col}`;
export const isUnsaved = (student: Student | undefined, col: number) =>
  unsavedCells.has(cellKey(student, col));
/** Number of cells whose last save failed. */
export const unsavedCount = () => unsavedCells.size;

export function renderAllGrids(): void {
  session.gridInstances.forEach((g) => g.render());
}

/**
 * Queues `write` (a Store call saving one cell of `student`) behind the saves before it. The
 * cell counts as "save in flight" from now on, so background updates leave it alone. A conflict
 * rejects the returned promise (reported by the global handler in app.js); any other failure
 * is shown and marks the cell as not saved.
 */
export function saveCell(
  student: Student | undefined,
  col: number,
  write: () => Promise<unknown>,
): Promise<unknown> {
  const key = cellKey(student, col);
  pendingSaves.set(key, (pendingSaves.get(key) ?? 0) + 1);
  session.onSaveState?.();
  Presence.markEdit();
  const run = saveChain.then(async () => {
    try {
      await write();
      if (unsavedCells.delete(key)) renderAllGrids();
    } catch (err) {
      const e = err as { code?: string; message?: string } | null;
      if (e?.code === 'conflict') throw err;
      if (isReadOnlyError(err)) noteReadOnly();
      // U3: any other failure (locked file, broken JSON, disk full) was silently lost.
      unsavedCells.add(key);
      renderAllGrids();
      persistentError(
        isReadOnlyError(err)
          ? READ_ONLY_SAVE_TEXT
          : `Score niet opgeslagen (${student ? Store.fullName(student) : 'onbekend'}): ${e?.message ?? err}. Controleer de gedeelde map en voer de score opnieuw in.`,
      );
    } finally {
      const n = (pendingSaves.get(key) ?? 1) - 1;
      if (n > 0) pendingSaves.set(key, n);
      else pendingSaves.delete(key);
      session.onSaveState?.();
    }
  });
  saveChain = run.catch(() => {});
  return run;
}

/** Resolves when every queued score save has run (before a change of user or subject). */
export function scoreSavesDone(): Promise<unknown> {
  return saveChain;
}

export async function waitForPendingSaves(timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (pendingSaves.size > 0 && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function changedInBackground(action: string): false {
  toast(`Niet ${action}: deze score is intussen door een collega gewijzigd.`, 'info');
  return false;
}

// ── Undo / redo ──────────────────────────────────────────────────────────────

let scoreHistory: HistoryEntry[] = [];
let redoHistory: HistoryEntry[] = [];
let undoKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
let undoBtnEl: HTMLButtonElement | null = null;
let redoBtnEl: HTMLButtonElement | null = null;
// While set, pushHistory collects entries here (one undo step for a paste or Delete of a
// range, review 3b m6).
let historyBatch: HistoryEntry[] | null = null;

function updateUndoRedoBtns(): void {
  if (undoBtnEl) undoBtnEl.disabled = scoreHistory.length === 0;
  if (redoBtnEl) redoBtnEl.disabled = redoHistory.length === 0;
}

export function pushHistory(entry: HistoryEntry): void {
  if (historyBatch) {
    historyBatch.push(entry);
    return;
  }
  scoreHistory.push(entry);
  if (scoreHistory.length > MAX_HISTORY) scoreHistory.shift();
  redoHistory = []; // a new action clears the redo stack
  updateUndoRedoBtns();
}

/** Runs `fn` with every pushed entry collected into one undo step. */
export function asOneStep(fn: () => void): void {
  const batch: HistoryEntry[] = [];
  historyBatch = batch;
  try {
    fn();
  } finally {
    historyBatch = null;
  }
  if (batch.length === 1) pushHistory(batch[0]!);
  else if (batch.length > 1) {
    // Entries changed by a colleague in the meantime are skipped one by one.
    pushHistory({
      undo: async () => {
        for (const e of [...batch].reverse()) await e.undo();
      },
      redo: async () => {
        for (const e of batch) await e.redo();
      },
    });
  }
}

export async function undoLast(): Promise<void> {
  const entry = scoreHistory.pop();
  if (!entry) return;
  redoHistory.push(entry);
  // An entry returns false when the cell was changed by someone else since; it is then
  // dropped instead of overwriting their value.
  if ((await entry.undo()) === false) redoHistory.pop();
  updateUndoRedoBtns();
}

export async function redoLast(): Promise<void> {
  const entry = redoHistory.pop();
  if (!entry) return;
  scoreHistory.push(entry);
  if ((await entry.redo()) === false) scoreHistory.pop();
  updateUndoRedoBtns();
}

/** Wires the undo/redo buttons and Ctrl+Z / Ctrl+Y (also from the grid, G46, U1). */
export function wireHistory(undoBtn: HTMLButtonElement, redoBtn: HTMLButtonElement): void {
  undoBtnEl = undoBtn;
  redoBtnEl = redoBtn;
  undoBtn.addEventListener('click', () => void undoLast());
  redoBtn.addEventListener('click', () => void redoLast());
  updateUndoRedoBtns();
  undoKeydownHandler = (e) => {
    // While typing in a cell, Ctrl+Z undoes the typing (native text undo).
    if ((e.target as Element | null)?.classList?.contains('score-grid-editor')) return;
    const key = e.key.toLowerCase(); // 'Z' with Shift or Caps Lock
    const mod = e.ctrlKey || e.metaKey; // Cmd on macOS (step 16a)
    if (mod && !e.shiftKey && key === 'z') {
      e.preventDefault();
      void undoLast();
    }
    if ((mod && key === 'y') || (mod && e.shiftKey && key === 'z')) {
      e.preventDefault();
      void redoLast();
    }
  };
  document.addEventListener('keydown', undoKeydownHandler);
}

// ── Teardown ─────────────────────────────────────────────────────────────────

export function destroyGridInstances(): void {
  session.buildToken++;
  session.gridInstances.forEach((g) => g.destroy());
  session.gridInstances = [];
  unsavedCells.clear();
  session.rowUpdaters = [];
  session.cursorUpdaters = [];
  session.activeRoster = null;
  session.activeGridData = [];
  session.activeExam = null;
  session.activeObs = [];
}

// Everything the score modal set up: the grids, the undo history and its buttons, and the
// Ctrl+Z / Ctrl+Y listener. loadScoreGrid only replaces the grids, so the listener and buttons
// stay wired (U1).
export function resetScoreModal({ keepGrids = false } = {}): void {
  if (!keepGrids) destroyGridInstances();
  scoreHistory = [];
  redoHistory = [];
  undoBtnEl = null;
  redoBtnEl = null;
  session.onSaveState = null;
  if (undoKeydownHandler) {
    document.removeEventListener('keydown', undoKeydownHandler);
    undoKeydownHandler = null;
  }
}

/** Recalculates totals, grades and summary rows of every group (e.g. after an N-term change). */
export function recomputeAllRows(): void {
  const exam = session.activeExam;
  if (!exam) return;
  const O = session.activeObs.length;
  session.activeGridData.forEach((gd) => {
    const ai = gd.findIndex((r) => r[0] === '__avg__');
    const si = gd.findIndex((r) => r[0] === '__std__');
    for (let ri = 0; ri < ai; ri++) recomputeRow(gd, exam, ri, O);
    recomputeSummaryRow(gd, ai, si, exam, O);
  });
  renderAllGrids();
}
