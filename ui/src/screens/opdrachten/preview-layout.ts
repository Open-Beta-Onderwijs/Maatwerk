// SPDX-License-Identifier: AGPL-3.0-or-later

// Where the Opdracht cards stand (design spec 4.17, board 58): closed, three columns over the
// full width (column gap 36, row gap 16); with the preview open, two narrower columns in the left
// half (gap 24) while the panel takes the right half, 36 px apart. Cards keep their height.

export const CARD_H = 196;
export const ROW_GAP = 16;
const COL_GAP = 36;
const COL_GAP_OPEN = 24;

export interface Slot {
  x: number;
  y: number;
  w: number;
}

/** The width of the left half (the cards) and the panel when the preview is open. */
export function halfWidth(width: number): number {
  return width / 2 - COL_GAP / 2;
}

/** The slot of every card, in list order. */
export function cardSlots(n: number, width: number, open: boolean): Slot[] {
  const cols = open ? 2 : 3;
  const gap = open ? COL_GAP_OPEN : COL_GAP;
  const area = open ? halfWidth(width) : width;
  const w = (area - (cols - 1) * gap) / cols;
  return Array.from({ length: n }, (_, i) => ({
    x: (i % cols) * (w + gap),
    y: Math.floor(i / cols) * (CARD_H + ROW_GAP),
    w,
  }));
}

/** The height of the cards' area. */
export function gridHeight(n: number, open: boolean): number {
  const rows = Math.ceil(n / (open ? 2 : 3));
  return rows ? rows * CARD_H + (rows - 1) * ROW_GAP : 0;
}

/** Which page is in view: the last one whose top is above a third of the viewport. */
export function pageInView(tops: readonly number[], scrollTop: number, viewH: number): number {
  const line = scrollTop + viewH / 3;
  let page = 0;
  tops.forEach((t, i) => {
    if (t <= line) page = i;
  });
  return page;
}
