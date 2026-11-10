// SPDX-License-Identifier: AGPL-3.0-or-later

// Observatie toetstype (step 21, F-23, decision 23, spec 4.12): the form field "Toetstype" with
// the chips Toets and PO (one or both, never none; new observaties default to Toets) and the
// Observaties tab's filter chip. Kept apart from the JS screen (R-05: observaties.js converts in
// its area step).

import { choiceChip, type ChoiceChip } from '../components/choice-chip';
import { esc } from '../components/dialog';
import type { Rubric, Toetstype } from '../domain/rubric';
import { Store } from '../store.js';

export type ToetstypeFilter = 'alle' | Toetstype;

let chip: ChoiceChip<ToetstypeFilter> | null = null;

/** The filter chip, made once and kept between renders (a re-render keeps the choice). */
export function toetstypeFilterChip(onChange: () => void): ChoiceChip<ToetstypeFilter> {
  chip ??= choiceChip<ToetstypeFilter>({
    id: 'btn-filter-toetstype',
    label: 'Toetstype',
    options: [
      { value: 'alle', label: 'Alle toetstypes' },
      { value: 'toets', label: 'Toets' },
      { value: 'po', label: 'PO' },
    ],
    value: 'alle',
    onChange,
  });
  return chip;
}

/** Whether a rubric (rubric or category observaties) names the observatie. */
export function obsUsedInRubric(id: string): boolean {
  return (Store.getRubricsSync() as Rubric[]).some(
    (r) =>
      (r.obs_ids ?? []).includes(id) ||
      (r.categories ?? []).some((c) => (c.obs_ids ?? []).includes(id)),
  );
}

/**
 * The form field. An observatie a test uses keeps Toets; one a rubric uses keeps PO (so a test's
 * score grid and a rubric never show an observatie of the other kind).
 */
export function toetstypeField(
  selected: readonly Toetstype[],
  usedInTest: boolean,
  obsId?: string,
): string {
  const usedInRubric = obsId ? obsUsedInRubric(obsId) : false;
  const btn = (value: Toetstype, label: string, locked: boolean, why: string): string => {
    const on = selected.includes(value);
    const lock = locked && on;
    return `<button type="button" class="tog-btn tt-btn${on ? ' selected' : ''}${lock ? ' tog-btn-disabled' : ''}" data-tt="${value}" aria-pressed="${on}"${lock ? ` disabled title="${esc(why)}"` : ''}>${label}</button>`;
  };
  return `<div class="form-group">
      <label>Toetstype</label>
      <div class="btn-toggle-group" id="obs-tt-group">
        ${btn('toets', 'Toets', usedInTest, 'Een toets gebruikt deze observatie')}
        ${btn('po', 'PO', usedInRubric, 'Een rubric gebruikt deze observatie')}
      </div>
    </div>`;
}

/** The chosen toetstypes of the form; never empty. */
export function readToetstypes(root: ParentNode): Toetstype[] {
  const picked = [...root.querySelectorAll<HTMLElement>('.tt-btn.selected')]
    .map((b) => b.dataset.tt)
    .filter((t): t is Toetstype => t === 'toets' || t === 'po');
  return picked.length ? picked : ['toets'];
}
