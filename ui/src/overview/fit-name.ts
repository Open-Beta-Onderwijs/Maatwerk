// SPDX-License-Identifier: AGPL-3.0-or-later

// The name column of the exam and PO overview tables (user 2026-11-15): 360px when there is
// room, otherwise as wide as the pane allows once the other columns have theirs, but never
// narrower than the names themselves (then the pane scrolls sideways).

export const NAME_COL_MAX = 360;

const TABLE = '.ov-table.xo-table, .ov-table.po-ov-table';
const observed = new WeakSet<HTMLElement>();

/**
 * The width of the name column: the room left beside the other columns, between the names' own
 * width and the max. Border-box widths (a table cell's `min-width` is its border box).
 */
export function nameColumnWidth(avail: number, rest: number, natural: number): number {
  return Math.max(natural, Math.min(NAME_COL_MAX, avail - rest));
}

/** Sizes the name column of the table in `pane`; does nothing while the pane is hidden. */
export function fitNameColumn(pane: HTMLElement): void {
  const table = pane.querySelector<HTMLElement>(TABLE);
  const th = table?.querySelector<HTMLElement>('thead th.ov-name-th');
  if (!table || !th || !pane.clientWidth) return;
  const cs = getComputedStyle(pane);
  const avail =
    pane.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
  th.style.minWidth = '0px';
  const natural = th.offsetWidth;
  const rest = table.offsetWidth - natural;
  th.style.minWidth = `${nameColumnWidth(avail, rest, natural)}px`;
}

/** Fits now and again whenever the pane changes size (shown, window resized). */
export function keepNameColumnFitted(pane: HTMLElement): void {
  fitNameColumn(pane);
  if (observed.has(pane)) return;
  observed.add(pane);
  new ResizeObserver(() => fitNameColumn(pane)).observe(pane);
}
