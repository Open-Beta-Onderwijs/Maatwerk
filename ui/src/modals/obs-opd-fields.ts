// SPDX-License-Identifier: AGPL-3.0-or-later

// The chip fields that Observatie bewerken and Opdracht bewerken share (design spec 4.12, board
// 15): Schoolsoort, Vakken and Jaarlagen as toggle buttons.

import { escHtml } from '../app.js';
import { Store } from '../store.js';

export const SCHOOLSOORTEN = [
  'Vmbo-bb',
  'Vmbo-kb',
  'Vmbo-gl',
  'Vmbo-tl',
  'Havo',
  'Vwo',
  'Gymnasium',
] as const;

/** The vak codes of observaties and opdrachten (wiskunde in its variants). */
export const VAK_CHIPS: readonly [code: string, label: string][] = [
  ['bio', 'Biologie'],
  ['nat', 'Natuurkunde'],
  ['schk', 'Scheikunde'],
  ['wisob', 'Wis OB'],
  ['wisa', 'WisA'],
  ['wisb', 'WisB'],
  ['wisc', 'WisC'],
  ['wisd', 'WisD'],
];

export const JAARLAGEN = ['1', '2', '3', '4', '5', '6'] as const;

/** A labelled group of toggle buttons; `id` is the group's element id, `attr` its data key. */
export function chipField({
  label,
  id,
  attr,
  items,
  selected,
  disabled = [],
  square = false,
}: {
  label: string;
  id: string;
  attr: string;
  items: readonly (readonly [string, string])[];
  selected: readonly string[];
  disabled?: readonly string[];
  square?: boolean;
}): string {
  const buttons = items
    .map(([key, text]) => {
      const on = selected.includes(key);
      const off = disabled.includes(key);
      return `<button type="button" class="tog-btn chip-btn${square ? ' chip-btn--square' : ''}${on ? ' selected' : ''}${off ? ' tog-btn-disabled' : ''}"
        data-${attr}="${escHtml(key)}" aria-pressed="${on}"${off ? ' disabled' : ''}>${escHtml(text)}</button>`;
    })
    .join('');
  return `<div class="form-group">
      <span class="form-label" id="${id}-label">${escHtml(label)}</span>
      <div class="btn-toggle-group" id="${id}" role="group" aria-labelledby="${id}-label">${buttons}</div>
    </div>`;
}

/** Schoolsoort chips; the school's own schoolsoorten only, when it set them. */
export function schoolsoortField(id: string, selected: readonly string[]): string {
  const school = (Store.getSchoolSync().schoolsoort ?? []) as string[];
  return chipField({
    label: 'Schoolsoort',
    id,
    attr: 'ss',
    items: SCHOOLSOORTEN.map((s) => [s, s] as const),
    selected,
    disabled: school.length ? SCHOOLSOORTEN.filter((s) => !school.includes(s)) : [],
  });
}

export function vakkenField(id: string, selected: readonly string[]): string {
  return chipField({ label: 'Vakken', id, attr: 'vak', items: VAK_CHIPS, selected });
}

export function jaarlagenField(id: string, selected: readonly (string | number)[]): string {
  return chipField({
    label: 'Jaarlagen',
    id,
    attr: 'jl',
    items: JAARLAGEN.map((j) => [j, j] as const),
    selected: selected.map(String),
    square: true,
  });
}

/** Toggling: every enabled chip of the groups flips on click; `onChange` after each flip. */
export function wireChips(root: HTMLElement, groupIds: string[], onChange?: () => void): void {
  for (const id of groupIds) {
    root.querySelector(`#${id}`)?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.chip-btn');
      if (!b || b.disabled) return;
      b.classList.toggle('selected');
      b.setAttribute('aria-pressed', String(b.classList.contains('selected')));
      onChange?.();
    });
  }
}

/** The selected keys of a chip group. */
export function readChips(root: HTMLElement, id: string, attr: string): string[] {
  return [...root.querySelectorAll<HTMLElement>(`#${id} .chip-btn.selected`)].map(
    (b) => b.dataset[attr]!,
  );
}
