// SPDX-License-Identifier: AGPL-3.0-or-later

// Pieces shared by the Observaties and Opdrachten cards (design spec 4.16, 4.17; boards 57, 58):
// the jaarlagen as six boxes and the count beside the filter chips.

import { esc } from '../../components/dialog';
import { VAK_CHIPS } from '../../domain/vakken';

/** Vak codes to UI labels; `wi` is an observatie made on the Wiskunde tab before step 30. */
const VAK_LABEL: Record<string, string> = { wi: 'Wiskunde', ...Object.fromEntries(VAK_CHIPS) };

/** "Havo, Vwo · Natuurkunde, Scheikunde" above the footer; a missing part is left out. */
export function metaLine(
  schoolsoort: readonly string[] | undefined,
  vakken: readonly string[] | undefined,
): string {
  const ss = (schoolsoort ?? []).join(', ');
  const vak = (vakken ?? []).map((v) => VAK_LABEL[v] ?? v).join(', ');
  return [ss, vak].filter(Boolean).join(' · ');
}

/** The six jaarlagen, the active ones in accent tint (spec 4.16). */
export function jaarlagenBoxes(jaarlagen: readonly (string | number)[] | undefined): string {
  const on = new Set((jaarlagen ?? []).map(String));
  const boxes = [1, 2, 3, 4, 5, 6]
    .map((n) => `<span class="icard-jl${on.has(String(n)) ? ' icard-jl--on' : ''}">${n}</span>`)
    .join('');
  const label = on.size
    ? `Jaarlagen ${[...on].sort((a, b) => Number(a) - Number(b)).join(', ')}`
    : 'Geen jaarlagen';
  return `<span class="icard-jls" role="img" title="Jaarlagen" aria-label="${esc(label)}">${boxes}</span>`;
}

/** "1 observatie", "12 observaties". */
export function countText(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The count at the right end of a screen's filter row (made once, text updated per render). */
export function setFilterCount(rowId: string, text: string): void {
  const row = document.getElementById(rowId);
  if (!row) return;
  let el = row.querySelector<HTMLElement>('.filter-count');
  if (!el) {
    el = document.createElement('span');
    el.className = 'filter-count';
    el.setAttribute('aria-live', 'polite');
    row.append(el);
  }
  el.textContent = text;
}
