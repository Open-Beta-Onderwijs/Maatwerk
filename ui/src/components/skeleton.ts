// SPDX-License-Identifier: AGPL-3.0-or-later

// Placeholders while data lazy-loads (V-09, design spec 3.4): the final
// layout with skeleton blocks of the same size as the real content, so a
// modal or screen does not change size or jump when the data arrives.
// Sizes go through the style data attributes (legacy/style-data.ts: the CSP
// forbids style="").

function size(v: number | string): string {
  return typeof v === 'number' ? `${v}px` : v;
}

/** A grade pill placeholder (44×24, radius 6). */
export function skelPill(): string {
  return '<span class="skel skel--pill" aria-hidden="true"></span>';
}

/** A text line placeholder (one line of body text high). */
export function skelLine(width: number | string = '100%'): string {
  return `<span class="skel skel--line" aria-hidden="true" data-w="${size(width)}"></span>`;
}

/** A block of a fixed height: a chart area, a list row, a page. */
export function skelBlock(height: number | string, width: number | string = '100%'): string {
  return `<span class="skel skel--block" aria-hidden="true" data-w="${size(width)}" data-h="${size(height)}"></span>`;
}

/** `n` list rows of `height` px. */
export function skelRows(n: number, height: number): string {
  return `<span class="skel-rows" aria-hidden="true">${Array.from({ length: n }, () =>
    skelBlock(height),
  ).join('')}</span>`;
}

/** Placeholders with a status label for screen readers. */
export function skelRegion(inner: string, label = 'Laden…'): string {
  return `<div class="skel-region" role="status" aria-busy="true"><span class="skel-sr">${label}</span>${inner}</div>`;
}
