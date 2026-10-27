// SPDX-License-Identifier: AGPL-3.0-or-later

// A small spreadsheet-like grid on a <table> for the score modal (ADR-0004,
// docs/specs/score-grid.md). It owns selection, the cell editor, checkbox
// cells and copy/paste; everything about scores (what a value means, how it is
// saved, colours) stays with the owner through the callbacks below.
//
// The owner keeps the data: the grid reads `data[row][col]` when it renders
// and reports edits through `onChange`, but never writes the data itself.

export type CellValue = string | boolean;

export interface Column {
  width: number;
  /** Header HTML; the owner escapes any text in it. */
  header: string;
  headerClass?: string;
  /** `checkbox` cells show a checkbox for `data[row][col] === true`. */
  kind?: 'text' | 'checkbox';
}

export interface CellChange {
  row: number;
  col: number;
  oldValue: CellValue;
  /** Typed or pasted text; a boolean for checkbox cells. */
  newValue: CellValue;
}

/** `edit`: the editor or a checkbox; `paste`: Ctrl+V; `clear`: Delete/Backspace. */
export type ChangeSource = 'edit' | 'paste' | 'clear';

export interface KeyContext {
  row: number;
  col: number;
  editing: boolean;
}

export interface ScoreGridOptions {
  data: CellValue[][];
  columns: Column[];
  isEditable(row: number, col: number): boolean;
  /** Styles a cell after the grid has reset it and set its text or checkbox. */
  renderCell?(td: HTMLTableCellElement, row: number, col: number, value: CellValue): void;
  onChange(changes: CellChange[], source: ChangeSource): void;
  onSelect?(row: number, col: number): void;
  onRender?(): void;
  /** Runs before the grid's own key handling; return true when the key was handled. */
  onKeyDown?(event: KeyboardEvent, ctx: KeyContext): boolean;
}

export interface ScoreGrid {
  /** The grid's root element (focusable, contains the table and the editor). */
  readonly element: HTMLElement;
  readonly table: HTMLTableElement;
  readonly isDestroyed: boolean;
  /**
   * Redraws the cells from the data: all of them, or only those in one of
   * `rows` or `cols` (cheaper while typing in a large grid).
   */
  render(region?: RenderRegion): void;
  selectCell(row: number, col: number): void;
  /** The current cell, or null before the first selection. */
  getSelected(): [number, number] | null;
  isEditing(): boolean;
  /** The cell with the open editor, or null. */
  getEditingCell(): [number, number] | null;
  /** Commits the open editor (reports the change); does nothing when closed. */
  finishEditing(): void;
  /** Closes the open editor without a change. */
  cancelEditing(): void;
  getCell(row: number, col: number): HTMLTableCellElement | null;
  getCoords(td: Element): { row: number; col: number } | null;
  destroy(): void;
}

export interface RenderRegion {
  rows?: number[];
  cols?: number[];
}

interface Pos {
  row: number;
  col: number;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** Tab-separated text, one line per row (spreadsheet clipboard format). */
export function toClipboardText(values: string[][]): string {
  return values.map((r) => r.join('\t')).join('\n');
}

/** Parses spreadsheet clipboard text; a trailing line break adds no row. */
export function parseClipboardText(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.split('\t'));
}

/** Pasted text for a checkbox cell: true, false, or null when it means neither. */
export function parseCheckboxText(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (['1', 'true', 'x', 'ja', 'waar'].includes(t)) return true;
  if (['0', 'false', '', 'nee', 'onwaar'].includes(t)) return false;
  return null;
}

export function createScoreGrid(container: HTMLElement, options: ScoreGridOptions): ScoreGrid {
  const { data, columns } = options;
  const rowCount = data.length;
  const colCount = columns.length;

  const root = document.createElement('div');
  root.className = 'score-grid';
  root.tabIndex = 0;
  const table = document.createElement('table');
  table.className = 'score-grid-table';
  root.appendChild(table);

  const colgroup = document.createElement('colgroup');
  let tableWidth = 0;
  for (const c of columns) {
    const col = document.createElement('col');
    col.style.width = `${c.width}px`;
    colgroup.appendChild(col);
    tableWidth += c.width;
  }
  table.style.width = `${tableWidth}px`;
  table.appendChild(colgroup);

  const thead = table.createTHead();
  const headRow = thead.insertRow();
  for (const c of columns) {
    const th = document.createElement('th');
    th.innerHTML = c.header;
    if (c.headerClass) th.className = c.headerClass;
    headRow.appendChild(th);
  }

  const tbody = table.createTBody();
  const cells: HTMLTableCellElement[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const tr = tbody.insertRow();
    const rowCells: HTMLTableCellElement[] = [];
    for (let c = 0; c < colCount; c++) rowCells.push(tr.insertCell());
    cells.push(rowCells);
  }
  container.appendChild(root);

  let destroyed = false;
  let current: Pos | null = null;
  let anchor: Pos | null = null;
  let dragging = false;
  // The open editor: its cell, and whether it was opened by typing (then the
  // arrow keys commit and move, as in a spreadsheet).
  let editor: { input: HTMLInputElement; pos: Pos; typed: boolean } | null = null;

  const isCheckbox = (col: number) => columns[col]?.kind === 'checkbox';
  const valueAt = (row: number, col: number): CellValue => data[row]?.[col] ?? '';
  const inside = (row: number, col: number) =>
    row >= 0 && row < rowCount && col >= 0 && col < colCount;

  function range(): { top: number; left: number; bottom: number; right: number } | null {
    if (!current || !anchor) return null;
    return {
      top: Math.min(current.row, anchor.row),
      left: Math.min(current.col, anchor.col),
      bottom: Math.max(current.row, anchor.row),
      right: Math.max(current.col, anchor.col),
    };
  }

  function renderCell(row: number, col: number): void {
    const td = cells[row]![col]!;
    const value = valueAt(row, col);
    const editable = options.isEditable(row, col);
    td.style.cssText = '';
    td.title = '';
    td.className = editable ? '' : 'sg-readonly';
    if (isCheckbox(col)) {
      let box = td.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (editable) {
        if (!box) {
          td.textContent = '';
          box = document.createElement('input');
          box.type = 'checkbox';
          box.tabIndex = -1;
          td.appendChild(box);
        }
        box.checked = value === true;
      } else if (box || td.textContent) {
        td.textContent = '';
      }
      td.classList.add('sg-checkbox');
    } else {
      const text = String(value ?? '');
      if (td.textContent !== text) td.textContent = text;
    }
    options.renderCell?.(td, row, col, value);
  }

  // Cells that carry the `current` or `area` class, so a new selection only
  // touches what changes.
  let marked: HTMLTableCellElement[] = [];

  function renderSelection(): void {
    for (const td of marked) td.classList.remove('current', 'area');
    marked = [];
    const area = range();
    if (!current || !area) return;
    if (area.top !== area.bottom || area.left !== area.right) {
      for (let r = area.top; r <= area.bottom; r++) {
        for (let c = area.left; c <= area.right; c++) {
          const td = cells[r]![c]!;
          td.classList.add('area');
          marked.push(td);
        }
      }
    }
    const td = cells[current.row]![current.col]!;
    td.classList.add('current');
    marked.push(td);
  }

  function render(region?: RenderRegion): void {
    if (destroyed) return;
    if (!region) {
      for (let r = 0; r < rowCount; r++) for (let c = 0; c < colCount; c++) renderCell(r, c);
    } else {
      const rows = new Set((region.rows ?? []).filter((r) => r >= 0 && r < rowCount));
      for (const r of rows) for (let c = 0; c < colCount; c++) renderCell(r, c);
      for (const c of new Set(region.cols ?? [])) {
        if (c < 0 || c >= colCount) continue;
        for (let r = 0; r < rowCount; r++) if (!rows.has(r)) renderCell(r, c);
      }
    }
    // renderCell resets the class names.
    for (const td of marked) td.classList.remove('current', 'area');
    marked = [];
    renderSelection();
    if (editor) placeEditor();
    options.onRender?.();
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function focusGrid(): void {
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
  }

  function select(row: number, col: number, extend = false): void {
    if (destroyed || !inside(row, col)) return;
    if (editor && (editor.pos.row !== row || editor.pos.col !== col)) finishEditing();
    const changed = !current || current.row !== row || current.col !== col;
    current = { row, col };
    if (!extend || !anchor) anchor = { row, col };
    renderSelection();
    focusGrid();
    cells[row]![col]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (changed) options.onSelect?.(row, col);
  }

  // ── Editor ─────────────────────────────────────────────────────────────────

  function placeEditor(): void {
    if (!editor) return;
    const td = cells[editor.pos.row]![editor.pos.col]!;
    const base = root.getBoundingClientRect();
    const r = td.getBoundingClientRect();
    const s = editor.input.style;
    s.left = `${r.left - base.left}px`;
    s.top = `${r.top - base.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
  }

  function startEditing(initial: string, typed: boolean): void {
    if (!current || editor) return;
    const { row, col } = current;
    if (isCheckbox(col) || !options.isEditable(row, col)) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'score-grid-editor';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = initial;
    editor = { input, pos: { row, col }, typed };
    root.appendChild(input);
    placeEditor();
    input.focus({ preventScroll: true });
    input.setSelectionRange(initial.length, initial.length);
    // Clicking elsewhere in the page commits, as in a spreadsheet.
    input.addEventListener('blur', () => {
      if (editor?.input === input) finishEditing();
    });
  }

  function closeEditor(): { pos: Pos; text: string } | null {
    if (!editor) return null;
    const { input, pos } = editor;
    editor = null;
    const hadFocus = document.activeElement === input;
    input.remove();
    if (hadFocus) root.focus({ preventScroll: true });
    return { pos, text: input.value };
  }

  function finishEditing(): void {
    const closed = closeEditor();
    if (!closed) return;
    const { row, col } = closed.pos;
    options.onChange([{ row, col, oldValue: valueAt(row, col), newValue: closed.text }], 'edit');
  }

  function cancelEditing(): void {
    closeEditor();
  }

  // ── Changes ────────────────────────────────────────────────────────────────

  function emit(changes: CellChange[], source: ChangeSource): void {
    if (changes.length) options.onChange(changes, source);
  }

  function clearRange(): void {
    const area = range();
    if (!area) return;
    const changes: CellChange[] = [];
    for (let r = area.top; r <= area.bottom; r++) {
      for (let c = area.left; c <= area.right; c++) {
        if (isCheckbox(c) || !options.isEditable(r, c) || valueAt(r, c) === '') continue;
        changes.push({ row: r, col: c, oldValue: valueAt(r, c), newValue: '' });
      }
    }
    emit(changes, 'clear');
  }

  function copyText(): string | null {
    const area = range();
    if (!area) return null;
    const values: string[][] = [];
    for (let r = area.top; r <= area.bottom; r++) {
      const line: string[] = [];
      for (let c = area.left; c <= area.right; c++) {
        const v = valueAt(r, c);
        line.push(isCheckbox(c) ? (v === true ? '1' : '0') : String(v ?? ''));
      }
      values.push(line);
    }
    return toClipboardText(values);
  }

  function paste(text: string): void {
    const area = range();
    if (!area) return;
    const block = parseClipboardText(text);
    const changes: CellChange[] = [];
    block.forEach((line, dr) => {
      line.forEach((raw, dc) => {
        const r = area.top + dr;
        const c = area.left + dc;
        if (!inside(r, c) || !options.isEditable(r, c)) return;
        if (isCheckbox(c)) {
          const checked = parseCheckboxText(raw);
          if (checked === null || checked === (valueAt(r, c) === true)) return;
          changes.push({ row: r, col: c, oldValue: valueAt(r, c), newValue: checked });
        } else {
          changes.push({ row: r, col: c, oldValue: valueAt(r, c), newValue: raw });
        }
      });
    });
    // Select what was pasted, as spreadsheets do.
    const bottom = Math.min(rowCount - 1, area.top + block.length - 1);
    const right = Math.min(colCount - 1, area.left + Math.max(...block.map((l) => l.length)) - 1);
    anchor = { row: area.top, col: area.left };
    current = { row: area.top, col: area.left };
    renderSelection();
    emit(changes, 'paste');
    anchor = { row: bottom, col: right };
    renderSelection();
  }

  const ownsFocus = () => root.contains(document.activeElement) && !editor;

  function onCopy(e: ClipboardEvent): void {
    if (!ownsFocus()) return;
    const text = copyText();
    if (text === null) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', text);
  }

  function onPaste(e: ClipboardEvent): void {
    if (!ownsFocus()) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text === undefined) return;
    e.preventDefault();
    paste(text);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  function move(dr: number, dc: number, extend: boolean): void {
    if (!current) return;
    const row = Math.max(0, Math.min(rowCount - 1, current.row + dr));
    const col = Math.max(0, Math.min(colCount - 1, current.col + dc));
    select(row, col, extend);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (destroyed || !current) return;
    // Undo/redo belong to the owner's history (score modal, G46).
    if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return;
    const ctx: KeyContext = { row: current.row, col: current.col, editing: !!editor };
    if (options.onKeyDown?.(e, ctx)) return;

    if (editor) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelEditing();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finishEditing();
        move(1, 0, false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        finishEditing();
        move(0, e.shiftKey ? -1 : 1, false);
      } else if (
        e.key in ARROWS &&
        (editor.typed || e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        e.preventDefault();
        finishEditing();
        const [dr, dc] = ARROWS[e.key]!;
        move(dr, dc, false);
      }
      return;
    }

    if (e.key in ARROWS) {
      e.preventDefault();
      const [dr, dc] = ARROWS[e.key]!;
      move(dr, dc, e.shiftKey);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1, false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      move(1, 0, false);
    } else if (e.key === 'F2') {
      e.preventDefault();
      startEditing(String(valueAt(current.row, current.col) ?? ''), false);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearRange();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      anchor = { row: 0, col: 0 };
      current = { row: rowCount - 1, col: colCount - 1 };
      renderSelection();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing replaces the cell's value; on checkbox cells it does nothing (U19).
      e.preventDefault();
      startEditing(e.key, true);
    }
  }

  // ── Mouse ──────────────────────────────────────────────────────────────────

  function coordsOf(target: EventTarget | null): Pos | null {
    const td = (target as Element | null)?.closest?.('td');
    return td && table.contains(td) ? getCoords(td) : null;
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.target === editor?.input) return;
    const pos = coordsOf(e.target);
    if (!pos) return;
    // Keep the focus on the grid (no text selection, no focus on the checkbox).
    e.preventDefault();
    if (e.button === 2) {
      const area = range();
      const inArea =
        area &&
        pos.row >= area.top &&
        pos.row <= area.bottom &&
        pos.col >= area.left &&
        pos.col <= area.right;
      if (!inArea) select(pos.row, pos.col);
      return;
    }
    if (e.button !== 0) return;
    select(pos.row, pos.col, e.shiftKey);
    dragging = true;
  }

  function onMouseOver(e: MouseEvent): void {
    if (!dragging) return;
    if (!(e.buttons & 1)) {
      dragging = false;
      return;
    }
    const pos = coordsOf(e.target);
    if (pos) select(pos.row, pos.col, true);
  }

  const onMouseUp = () => {
    dragging = false;
  };

  function onClick(e: MouseEvent): void {
    const box = e.target as HTMLInputElement;
    if (box.type !== 'checkbox') return;
    const pos = coordsOf(box);
    if (!pos) return;
    // The data decides what the box shows; report the toggle instead.
    const was = valueAt(pos.row, pos.col) === true;
    box.checked = was;
    emit([{ row: pos.row, col: pos.col, oldValue: was, newValue: !was }], 'edit');
  }

  function onDblClick(e: MouseEvent): void {
    const pos = coordsOf(e.target);
    if (!pos || editor) return;
    select(pos.row, pos.col);
    startEditing(String(valueAt(pos.row, pos.col) ?? ''), false);
  }

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('mousedown', onMouseDown);
  root.addEventListener('mouseover', onMouseOver);
  root.addEventListener('click', onClick);
  root.addEventListener('dblclick', onDblClick);
  document.addEventListener('mouseup', onMouseUp);
  // Copy and paste events go to the body when the focused element is not
  // editable, so they are caught on the document.
  document.addEventListener('copy', onCopy);
  document.addEventListener('paste', onPaste);

  function getCell(row: number, col: number): HTMLTableCellElement | null {
    return cells[row]?.[col] ?? null;
  }

  function getCoords(td: Element): Pos | null {
    const cell = td as HTMLTableCellElement;
    const tr = cell.parentElement as HTMLTableRowElement | null;
    if (!tr || tr.parentElement !== tbody) return null;
    return { row: tr.sectionRowIndex, col: cell.cellIndex };
  }

  function destroy(): void {
    if (destroyed) return;
    closeEditor();
    destroyed = true;
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('paste', onPaste);
    root.remove();
  }

  render();

  return {
    element: root,
    table,
    get isDestroyed() {
      return destroyed;
    },
    render,
    selectCell: (row, col) => select(row, col),
    getSelected: () => (current ? [current.row, current.col] : null),
    isEditing: () => !!editor,
    getEditingCell: () => (editor ? [editor.pos.row, editor.pos.col] : null),
    finishEditing,
    cancelEditing,
    getCell,
    getCoords,
    destroy,
  };
}
