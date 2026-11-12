// SPDX-License-Identifier: AGPL-3.0-or-later

// One group's score grid in the score modal: scores, observaties and overwritten grades,
// typed, pasted or cut; undo; colleagues' changes and cursors; the numpad keys
// (docs/specs/score-grid.md).

import { escHtml, persistentError, toast } from '../../app.js';
import {
  createScoreGrid,
  type CellChange,
  type CellValue,
  type KeyContext,
  type ScoreGrid,
} from '../../components/score-grid/score-grid';
import {
  computeRowStatus,
  normalizeScore,
  parseGradeInput,
  recomputeRow,
  recomputeSummaryRow,
  sameOverride,
  scoreCellText,
  type GridData,
} from '../../domain/scoregrid';
import type { Exam, Observatie, Override, ScoreRecord, Student } from '../../domain/types';
import * as Presence from '../../presence.js';
import { Store } from '../../store.js';
import { showCellMenu, type CellMenuItem } from './cell-menu';
import { gridColumns, gridLayout, isObsCol, isQCol, type RowStatus } from './cells';
import {
  REMOTE_FLASH_MS,
  asOneStep,
  cellKey,
  changedInBackground,
  isUnsaved,
  pendingSaves,
  pushHistory,
  saveCell,
  session,
  type RemoteCursor,
} from './session';

export function createGroupGrid(
  container: HTMLElement,
  exam: Exam,
  students: Student[],
  gridData: GridData,
  year: string,
  obsArr: Observatie[] = [],
): ScoreGrid {
  const layout = gridLayout(exam, obsArr.length, gridData);
  const { O, firstQCol, lastQCol, obsStart, lastObsCol, gradeCol, summaryIdx, stdIdx } = layout;
  const firstDataRow = 0;
  const lastDataRow = layout.lastDataRow;
  const overrides = (gridData.overrides ??= {});
  const gradeInfo = (gridData.gradeInfo ??= {});

  const editableCols = [
    ...Array.from({ length: layout.N }, (_, i) => firstQCol + i),
    ...Array.from({ length: O }, (_, i) => obsStart + i),
  ];
  const qCol = (col: number) => isQCol(layout, col);
  const obsCol = (col: number) => isObsCol(layout, col);

  // The first empty question column of a row, or null when all are filled.
  function firstEmptyQ(row: number): number | null {
    for (let c = firstQCol; c <= lastQCol; c++) {
      const v = gridData[row]![c];
      if (v === '' || v === undefined || v === null) return c;
    }
    return null;
  }
  function goTo(row: number, col: number | undefined): void {
    if (row < firstDataRow || row > lastDataRow || col === undefined || col < 0) return;
    grid.selectCell(row, col);
  }

  let selectedCell = { row: -1, col: -1 };

  // ── Saving & background changes ───────────────────────────────────────────
  const save = (row: number, col: number, write: () => Promise<unknown>) =>
    saveCell(students[row], col, write);
  // Saves are queued and may run after a switch of subject: pin this one.
  const subject = Store.getActiveSubject();

  // Cells recently changed by someone else ("row:col" -> time the flash ends).
  const flashUntil = new Map<string, number>();

  // Apply a score file saved by another teacher to this student's row.
  function applyRemoteRecord(studentId: string, rec: ScoreRecord | null): void {
    const row = students.findIndex((st) => String(st.id) === String(studentId));
    if (row < 0 || grid.isDestroyed) return;
    const examScores = rec?.scores?.[exam.id] ?? {};
    const obsIds = rec?.observations?.[exam.id] ?? [];
    const editing = grid.getEditingCell();
    const isEditing = (col: number) => !!editing && editing[0] === row && editing[1] === col;
    let changed = false;
    const setCell = (col: number, value: CellValue) => {
      if (gridData[row]![col] === value) return;
      if (isEditing(col)) return;
      if (pendingSaves.has(cellKey(students[row], col))) return;
      gridData[row]![col] = value;
      flashUntil.set(`${row}:${col}`, Date.now() + REMOTE_FLASH_MS);
      changed = true;
    };
    exam.questions.forEach((q, qi) => {
      const v = examScores[q.id];
      setCell(firstQCol + qi, v === undefined ? '' : v === null ? 'N' : scoreCellText(v));
    });
    obsArr.forEach((o, oi) => setCell(obsStart + oi, obsIds.includes(o.id)));
    const override = rec?.overrides?.[exam.id];
    if (
      !sameOverride(override, overrides[row]) &&
      !pendingSaves.has(cellKey(students[row], gradeCol)) &&
      !isEditing(gradeCol)
    ) {
      overrides[row] = override;
      flashUntil.set(`${row}:${gradeCol}`, Date.now() + REMOTE_FLASH_MS);
      changed = true;
    }
    if (!changed) return;
    refreshRow(row);
    const rows = [row, summaryIdx, stdIdx];
    setTimeout(() => {
      if (!grid.isDestroyed) grid.render({ rows });
    }, REMOTE_FLASH_MS + 50);
  }
  session.rowUpdaters.push(applyRemoteRecord);

  // ── Colleagues' cursors ───────────────────────────────────────────────────
  // Drawn as an overlay (thick coloured border + name flag) on the group's section, because
  // table cells clip their content.
  let remoteCursors: RemoteCursor[] = [];
  const layer = container.parentElement!;
  layer.style.position = 'relative';

  function cellOf({ studentId, questionId }: RemoteCursor): { row: number; col: number } | null {
    const row = students.findIndex((st) => String(st.id) === String(studentId));
    if (row < 0) return null;
    if (String(questionId).startsWith('obs:')) {
      const oi = obsArr.findIndex((o) => `obs:${o.id}` === questionId);
      return oi < 0 ? null : { row, col: obsStart + oi };
    }
    const qi = exam.questions.findIndex((q) => q.id === questionId);
    return qi < 0 ? null : { row, col: firstQCol + qi };
  }

  function drawCursors(): void {
    layer.querySelectorAll(':scope > .remote-cursor').forEach((n) => n.remove());
    if (grid.isDestroyed) return;
    const base = layer.getBoundingClientRect();
    for (const cursor of remoteCursors) {
      const cell = cellOf(cursor);
      const td = cell && grid.getCell(cell.row, cell.col);
      if (!td) continue;
      const r = td.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'remote-cursor';
      box.style.cssText =
        `left:${r.left - base.left}px;top:${r.top - base.top}px;` +
        `width:${r.width}px;height:${r.height}px;--cursor-color:${cursor.color}`;
      box.innerHTML = `<span class="remote-cursor-flag">${escHtml(cursor.name)}</span>`;
      layer.appendChild(box);
    }
  }

  session.cursorUpdaters.push((cursors) => {
    remoteCursors = cursors;
    drawCursors();
  });

  // ── Row status and highlight ──────────────────────────────────────────────
  const rowStatus: RowStatus[] = gridData.map((r) => computeRowStatus(r, exam));

  function decorate(td: HTMLTableCellElement, row: number, col: number): void {
    const flashEnd = flashUntil.get(`${row}:${col}`);
    const flashing = flashEnd !== undefined && flashEnd > Date.now();
    if (flashEnd !== undefined && !flashing) flashUntil.delete(`${row}:${col}`);
    td.style.boxShadow = flashing ? `inset 0 0 0 2px ${session.remoteFlashColor}` : '';
    // A save of this cell failed: it is retried when the value is typed again.
    td.classList.toggle('cell-unsaved', row <= lastDataRow && isUnsaved(students[row], col));
    const onRow = row === selectedCell.row;
    const onCol = col === selectedCell.col;
    if (!onRow && !onCol) return;
    const alpha = onRow && onCol ? 0.16 : 0.08;
    // backgroundImage overlays on top of the background colour already set.
    td.style.backgroundImage = `linear-gradient(rgba(74,144,217,${alpha}), rgba(74,144,217,${alpha}))`;
  }

  // Recompute a student's row and the summary rows after a change, and redraw them (only
  // them: a modal can hold 10,000 cells).
  function refreshRow(row: number): void {
    rowStatus[row] = computeRowStatus(gridData[row], exam);
    recomputeRow(gridData, exam, row, O);
    recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, O);
    grid.render({ rows: [row, summaryIdx, stdIdx] });
  }

  // ── Scores ────────────────────────────────────────────────────────────────
  // Typed, pasted or cleared in a question cell. The cell shows the new value at once; the
  // save is queued (saveCell), so fast entry is never lost (U2).
  function scoreTyped(row: number, col: number, oldVal: CellValue, newVal: CellValue): void {
    const student = students[row];
    const q = exam.questions[col - firstQCol];
    if (!student || !q) return;
    const next = normalizeScore(newVal, q);
    const before = normalizeScore(oldVal, q).cell;
    // Unchanged: nothing to do, unless the last save of this cell failed.
    if (next.cell === before && !isUnsaved(student, col)) return;

    // Undo/redo only apply while the cell still holds the value this entry left behind (a
    // colleague may have changed it).
    const applyScore = (str: CellValue) => {
      const { cell, value } = normalizeScore(str, q);
      gridData[row]![col] = cell;
      refreshRow(row);
      return save(row, col, () => Store.setScore(student.id, exam.id, q.id, value, year, subject));
    };
    pushHistory({
      undo: () =>
        gridData[row]![col] === next.cell
          ? applyScore(oldVal)
          : changedInBackground('ongedaan gemaakt'),
      redo: () =>
        gridData[row]![col] === before
          ? applyScore(newVal)
          : changedInBackground('opnieuw uitgevoerd'),
    });
    void applyScore(newVal);
    // Anything that is not empty, N or a number 0…max is kept as typed.
    if (typeof next.value === 'string') {
      persistentError(
        `Ongeldige score "${next.value}" voor vraag ${q.section ?? ''}${q.number ?? ''} (max ${q.max_points}). Controleer en herstel.`,
      );
    }
  }

  // ── Observaties ───────────────────────────────────────────────────────────
  // Check or uncheck observatie obsIdx for the student on `row`: undoable and saved at once.
  // Used by the checkboxes, the 0/1 keys, F1, F2, … and paste.
  function setObs(row: number, obsIdx: number, checked: boolean): void {
    const col = obsStart + obsIdx;
    const obs = obsArr[obsIdx];
    const student = students[row];
    if (!obs || !student) return;
    const prevVal = gridData[row]![col] === true;
    const apply = (val: boolean) => {
      gridData[row]![col] = val;
      recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, O); // the ticked count
      grid.render({ rows: [row, summaryIdx] });
      return save(row, col, () =>
        Store.setObservation(student.id, exam.id, obs.id, val, year, subject),
      );
    };
    pushHistory({
      undo: () =>
        gridData[row]![col] === checked ? apply(prevVal) : changedInBackground('ongedaan gemaakt'),
      redo: () =>
        gridData[row]![col] === prevVal
          ? apply(checked)
          : changedInBackground('opnieuw uitgevoerd'),
    });
    void apply(checked);
  }

  // ── Overwritten grades ────────────────────────────────────────────────────
  // Set (cijfer) or remove (null) the overwritten grade of the student on `row`: undoable and
  // saved at once. `berekend` remembers the calculated grade, so a later change of it can be
  // flagged.
  function setGradeOverride(row: number, cijfer: number | null): void {
    const student = students[row];
    if (!student) return;
    const prev = overrides[row];
    const calc = gradeInfo[row]?.calculatedGrade ?? null;
    const next: Override | undefined = cijfer === null ? undefined : { cijfer, berekend: calc };
    const apply = (ov: Override | undefined) => {
      overrides[row] = ov;
      refreshRow(row);
      return save(row, gradeCol, () =>
        Store.setGradeOverride(
          student.id,
          exam.id,
          ov?.cijfer ?? null,
          ov?.berekend,
          year,
          subject,
        ),
      );
    };
    pushHistory({
      undo: () =>
        sameOverride(overrides[row], next) ? apply(prev) : changedInBackground('ongedaan gemaakt'),
      redo: () =>
        sameOverride(overrides[row], prev)
          ? apply(next)
          : changedInBackground('opnieuw uitgevoerd'),
    });
    void apply(next);
  }

  // Typed into the Cijfer cell: a grade overwrites, empty restores the calculated one.
  function gradeTyped(row: number, oldVal: CellValue, newVal: CellValue): void {
    const raw = String(newVal ?? '').trim();
    const prev = overrides[row];
    const retry = isUnsaved(students[row], gradeCol);
    if (raw === '') {
      if (prev || retry) setGradeOverride(row, null);
      return; // the calculated grade can't be removed
    }
    const cijfer = parseGradeInput(raw);
    if (isNaN(cijfer)) {
      toast(`Ongeldig cijfer "${raw}": vul een cijfer van 1,0 tot en met 10,0 in.`, 'error');
      return;
    }
    // Unchanged: nothing to do, except confirming a flagged override again, which accepts the
    // new calculated grade, or retrying a failed save.
    const unchanged = prev ? cijfer === prev.cijfer : raw === String(oldVal ?? '').trim();
    if (unchanged && !gradeInfo[row]?.stale && !retry) return;
    setGradeOverride(row, cijfer);
  }

  // Edits from the grid: typed, pasted (also into observaties, U4), cut or cleared. One
  // paste, cut or Delete is one undo step.
  function onGridChange(changes: CellChange[]): void {
    asOneStep(() => {
      for (const { row, col, oldValue, newValue } of changes) {
        if (row > lastDataRow) continue;
        if (col === gradeCol) gradeTyped(row, oldValue, newValue);
        else if (qCol(col)) scoreTyped(row, col, oldValue, newValue);
        else if (obsCol(col)) setObs(row, col - obsStart, newValue === true);
      }
    });
  }

  // Right-click on an overwritten grade: "Berekend cijfer herstellen".
  container.addEventListener('contextmenu', (e) => {
    const td = (e.target as Element).closest('td');
    if (!td || grid.isDestroyed) return;
    const coords = grid.getCoords(td);
    if (!coords || coords.col !== gradeCol || coords.row < 0 || coords.row >= summaryIdx) return;
    const ov = overrides[coords.row];
    if (!ov) return;
    e.preventDefault();
    const items: CellMenuItem[] = [
      {
        icon: '↺',
        label: 'Berekend cijfer herstellen',
        run: () => setGradeOverride(coords.row, null),
      },
    ];
    // Accepting the new calculated grade = setting the same grade again.
    if (gradeInfo[coords.row]?.stale) {
      items.push({
        icon: '✓',
        label: 'Waarschuwing negeren',
        run: () => setGradeOverride(coords.row, ov.cijfer),
      });
    }
    showCellMenu(e.clientX, e.clientY, items);
  });

  const columns = gridColumns({ exam, obs: obsArr, data: gridData, layout, rowStatus, decorate });

  // ── Keyboard ──────────────────────────────────────────────────────────────
  // Runs before the grid's own handling (arrows, typing, Escape, F2, Delete). Returns true
  // when the key was handled here.
  function onKeyDown(event: KeyboardEvent, { row, col, editing }: KeyContext): boolean {
    if (row >= summaryIdx) return false;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };

    // Numpad dot → write N directly into the question cell (also while typing, which
    // discards the typed value).
    if (event.code === 'NumpadDecimal' && session.numpadDotIsN && qCol(col)) {
      if (editing) grid.cancelEditing();
      onGridChange([{ row, col, oldValue: gridData[row]![col] as CellValue, newValue: 'N' }]);
      return handled();
    }

    // Enter / Numpad Enter / multiply → confirm the edit + the next editable cell.
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'NumpadMultiply') {
      if (editing) grid.finishEditing();
      if (col === gradeCol) {
        // Cijfer: confirm and go to the next student's grade.
        if (row < lastDataRow) goTo(row + 1, col);
        return handled();
      }
      const pos = editableCols.indexOf(col);
      if (pos !== editableCols.length - 1) {
        goTo(row, editableCols[pos + 1]);
      } else if (row < lastDataRow) {
        // Last editable cell, next student exists: first empty question or the same column.
        goTo(row + 1, firstEmptyQ(row + 1) ?? col);
      }
      return handled();
    }

    // Tab → next question, then the observaties, then the next student's first question;
    // stops after the last student. Shift+Tab: the previous one.
    if (event.key === 'Tab' && (qCol(col) || obsCol(col))) {
      if (editing) grid.finishEditing();
      const pos = editableCols.indexOf(col);
      if (event.shiftKey) {
        if (pos > 0) goTo(row, editableCols[pos - 1]);
      } else if (pos < editableCols.length - 1) {
        goTo(row, editableCols[pos + 1]);
      } else if (row < lastDataRow) {
        goTo(row + 1, firstQCol);
      }
      return handled();
    }

    // F1, F2, … → toggle observatie 1, 2, … of this student, without moving the selection
    // or closing an open editor (as the reference).
    const fKey = /^F(\d{1,2})$/.exec(event.key);
    if (fKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      const obsIdx = Number(fKey[1]) - 1;
      if (obsIdx >= O) return false;
      setObs(row, obsIdx, gridData[row]![obsStart + obsIdx] !== true);
      return handled();
    }

    // The keys below only apply when not typing in a cell.
    if (editing) return false;

    // Numpad divide → previous editable cell.
    if (event.code === 'NumpadDivide') {
      const pos = editableCols.indexOf(col);
      if (pos > 0) goTo(row, editableCols[pos - 1]);
      return handled();
    }

    // Numpad minus / plus → previous / next student (first empty question, or the same col).
    if (event.code === 'NumpadSubtract' || event.code === 'NumpadAdd') {
      const targetRow = event.code === 'NumpadAdd' ? row + 1 : row - 1;
      if (targetRow >= firstDataRow && targetRow <= lastDataRow) {
        goTo(targetRow, firstEmptyQ(targetRow) ?? col);
      }
      return handled();
    }

    if (event.key === 'Home') {
      if (qCol(col)) goTo(row, firstQCol);
      else if (obsCol(col)) goTo(row, col === obsStart ? firstQCol : obsStart);
      return handled();
    }

    if (event.key === 'End') {
      if (qCol(col)) goTo(row, col === lastQCol && O > 0 ? lastObsCol : lastQCol);
      else if (obsCol(col)) goTo(row, lastObsCol);
      return handled();
    }

    // Observatie cells: 0 unchecks, 1 checks (other printable keys do nothing).
    if (obsCol(col) && (event.key === '0' || event.key === '1')) {
      setObs(row, col - obsStart, event.key === '1');
      return handled();
    }

    return false;
  }

  const grid = createScoreGrid(container, {
    data: gridData as CellValue[][],
    columns,
    isEditable(row, col) {
      if (row === summaryIdx || row === stdIdx) return false;
      // Score cols, observaties, and Cijfer (typing there overwrites the grade).
      return qCol(col) || obsCol(col) || col === gradeCol;
    },
    renderCell(td, row, col, value) {
      columns[col]?.render(td, row, col, value);
    },
    onChange: onGridChange,
    onSelect(row, col) {
      const student = row < summaryIdx ? students[row] : undefined;
      if (student) {
        const q = exam.questions[col - firstQCol];
        const o = obsArr[col - obsStart];
        if (qCol(col) && q) Presence.setPosition(student.id, q.id);
        else if (obsCol(col) && o) Presence.setPosition(student.id, `obs:${o.id}`);
      }
      // Redraw the cross-hair (G58): the old and the new row and column.
      const prev = selectedCell;
      selectedCell = { row, col };
      grid.render({ rows: [prev.row, row], cols: [prev.col, col] });
    },
    onRender() {
      if (remoteCursors.length) drawCursors();
    },
    onKeyDown,
  });

  return grid;
}
