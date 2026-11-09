// SPDX-License-Identifier: AGPL-3.0-or-later

// Pieces the test modals share (design spec 4.11): PTA and D tick boxes that
// exclude each other, the steppers and segmented buttons, and the block with
// an attempt's locked observaties.

import { esc } from '../components/dialog';
import { field, isTicked, setTick, tickBox } from '../components/form';
import { formatNumber } from '../domain/format';
import { Store } from '../store.js';
import { setSpinnerEnabled, setSpinnerValue, spinnerValue } from '../utils/spinners';

export const PTA_TITLE = 'PTA: de toets hoort bij het Programma van Toetsing en Afsluiting';
export const DIAG_TITLE = 'Diagnostisch: telt niet mee voor rapport of SE';
export const LOCKED_TITLE =
  'Deze toetseigenschap kan alleen worden aangepast bij de verzamelkaart, voor alle toetsen tegelijkertijd.';

const LOCK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

export interface StepperOptions {
  value: number;
  step: number;
  min: number;
  max: number;
  /** What the field shows; defaults to the value. */
  shown?: string;
  /** Not changeable here (top fields of an attempt); `disabled` keeps its look. */
  disabled?: boolean;
  label?: string;
}

/** A .num-spinner with an id. */
export function stepper(id: string, o: StepperOptions): string {
  const dis = o.disabled ? ' disabled' : '';
  return `<div class="num-spinner${o.disabled ? ' spinner-disabled' : ''}" id="${esc(id)}" data-val="${o.value}" data-step="${o.step}" data-min="${o.min}" data-max="${o.max}">
    <button type="button" class="spin-btn spin-minus" aria-label="Lager"${dis}>−</button>
    <input class="spin-val" value="${esc(o.shown ?? formatNumber(o.value))}"${o.label ? ` aria-label="${esc(o.label)}"` : ''}${dis} />
    <button type="button" class="spin-btn spin-plus" aria-label="Hoger"${dis}>+</button>
  </div>`;
}

/** A labelled stepper; a locked one explains why in its tooltip. */
export function stepperField(label: string, id: string, o: StepperOptions, locked = false): string {
  const control = stepper(id, { label, ...o, disabled: o.disabled || locked });
  return `<div class="form-group exam-stepper"${locked ? ` title="${esc(LOCKED_TITLE)}"` : ''}>
    <label>${esc(label)}</label>
    ${control}
  </div>`;
}

/** One-of-many buttons (Jaarlaag, Periode). `cls` and `data` name them for lookups. */
export function segmented(
  cls: string,
  data: string,
  values: readonly number[],
  selected: unknown,
  locked = false,
): string {
  return `<div class="btn-toggle-group exam-seg"${locked ? ` title="${esc(LOCKED_TITLE)}"` : ''}>${values
    .map(
      (n) =>
        `<button type="button" class="tog-btn ${cls}${locked ? ' tog-btn-disabled' : ''}${String(selected) === String(n) ? ' selected' : ''}" data-${data}="${n}"${locked ? ' disabled' : ''}>${n}</button>`,
    )
    .join('')}</div>`;
}

/** A Periode that can be switched off again: a second click clears it. */
export function wirePeriode(root: ParentNode): void {
  const btns = root.querySelectorAll<HTMLElement>('.per-btn:not(:disabled)');
  btns.forEach((btn) =>
    btn.addEventListener('click', () => {
      const already = btn.classList.contains('selected');
      btns.forEach((b) => b.classList.remove('selected'));
      if (!already) btn.classList.add('selected');
    }),
  );
}

/** The PTA and D boxes of a form. */
export function kindBoxFields(
  ids: { pta: string; diag: string },
  state: { pta: boolean; diag: boolean },
  locked = false,
): string {
  const box = (label: string, id: string, checked: boolean, title: string) =>
    field(
      label,
      tickBox(id, {
        checked,
        disabled: locked,
        title: locked ? LOCKED_TITLE : title,
        ariaLabel: title,
      }),
      { grow: 'none', center: true, className: 'u-mb-0', for: id },
    );
  return box('PTA', ids.pta, state.pta, PTA_TITLE) + box('D', ids.diag, state.diag, DIAG_TITLE);
}

export interface KindBoxControls {
  pta: HTMLElement;
  diag: HTMLElement;
  weging: HTMLElement;
  wegingSe: HTMLElement;
  /** After every change, and once at the start. */
  onChange?: (diagnostic: boolean) => void;
}

/**
 * PTA and D exclude each other. D sets Weging to 0 and disables it (unticking brings the old value
 * back, or 1). Weging SE applies only with PTA; it keeps its value while it does not (PLAN-2
 * decision 6, spec 4.11).
 */
export function wireKindBoxes(c: KindBoxControls): void {
  let wegingBefore: number | null = null;
  const sync = () => {
    const diag = isTicked(c.diag);
    setSpinnerEnabled(c.wegingSe, isTicked(c.pta), true);
    if (diag) {
      wegingBefore ??= spinnerValue(c.weging);
      setSpinnerValue(c.weging, 0);
    } else if (wegingBefore !== null) {
      setSpinnerValue(c.weging, wegingBefore > 0 ? wegingBefore : 1);
      wegingBefore = null;
    }
    setSpinnerEnabled(c.weging, !diag);
    c.onChange?.(diag);
  };
  const flip = (box: HTMLElement, other: HTMLElement) =>
    box.addEventListener('click', () => {
      const on = !isTicked(box);
      setTick(box, on);
      if (on) setTick(other, false);
      sync();
    });
  flip(c.pta, c.diag);
  flip(c.diag, c.pta);
  sync();
}

/** Shows a locked Weging SE as a dash when it does not apply. */
export function showLockedWegingSe(wegingSe: HTMLElement, pta: boolean): void {
  setSpinnerEnabled(wegingSe, false, !pta);
}

/** What the boxes and steppers come to for an exam. A diagnostic test is never PTA, weging 0. */
export function kindFields(
  diagnostic: boolean,
  pta: boolean,
  weging: number,
): { diagnostic: boolean; type: 'pta' | 'regular'; weging: number } {
  return {
    diagnostic,
    type: pta && !diagnostic ? 'pta' : 'regular',
    weging: diagnostic ? 0 : weging,
  };
}

/** The locked observaties of an attempt (F-12): read-only, changed through the original. */
export function lockedObsBlock(
  obsIds: readonly string[] | undefined,
  originalCode: string,
): string {
  const all: { id: string; naam?: string; icon?: string }[] = Store.getObservatiesSync();
  const chips = (obsIds ?? [])
    .map((id) => all.find((o) => o.id === id))
    .filter((o) => o !== undefined)
    .map(
      (o) =>
        `<span class="exam-obs-chip exam-obs-chip--locked"><span aria-hidden="true">${esc(o.icon)}</span>${esc(o.naam)}</span>`,
    )
    .join('');
  const code = esc(originalCode);
  return `<div class="exam-lock-block" id="f-obs-locked">
    <span class="exam-lock-title">${LOCK_ICON}Observaties worden overgenomen van ${code}</span>
    ${chips ? `<div class="exam-obs-chips">${chips}</div>` : `<span class="muted">${code} heeft nog geen observaties.</span>`}
    <span class="exam-lock-note">Je wijzigt ze via het origineel; ze gelden dan voor alle pogingen.</span>
  </div>`;
}
