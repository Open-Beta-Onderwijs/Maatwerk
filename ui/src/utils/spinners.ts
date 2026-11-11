// SPDX-License-Identifier: AGPL-3.0-or-later

// Steppers (.num-spinner): a number field with − and + buttons (design spec
// 3.2). The current value lives in data-val; the field shows it with a
// decimal comma. Markup:
//
//   <div class="num-spinner" data-val="1" data-step="0.5" data-min="0" data-max="100">
//     <button type="button" class="spin-btn spin-minus">−</button>
//     <input class="spin-val" value="1" />
//     <button type="button" class="spin-btn spin-plus">+</button>
//   </div>

import { formatFixed, formatNumber, parseDecimalLoose } from '../domain/format';

function num(v: string | undefined, fallback: number): number {
  return v === undefined ? fallback : parseFloat(v);
}

/** Wires every .num-spinner inside `root`. */
export function wireSpinners(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.num-spinner').forEach((sp) => {
    const step = num(sp.dataset.step, 1);
    const min = num(sp.dataset.min, 0);
    const max = num(sp.dataset.max, 999);
    const s = step.toString();
    const dot = s.indexOf('.');
    const dec = dot < 0 ? 0 : s.length - dot - 1;
    const inp = sp.querySelector<HTMLInputElement>('.spin-val');
    if (!inp) return;
    const current = () => num(sp.dataset.val, 0);

    function set(v: number) {
      v = Math.min(max, Math.max(min, Math.round(v / step) * step));
      v = parseFloat(v.toFixed(dec));
      sp.dataset.val = String(v);
      inp!.value = formatFixed(v, dec);
    }

    sp.querySelector('.spin-minus')?.addEventListener('click', () => set(current() - step));
    sp.querySelector('.spin-plus')?.addEventListener('click', () => set(current() + step));

    inp.addEventListener('change', () => {
      const v = parseDecimalLoose(inp.value);
      if (!isNaN(v)) set(v);
      else inp.value = formatFixed(current(), dec);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        set(current() + step);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        set(current() - step);
      }
    });
  });
}

/** The current value of a .num-spinner element. */
export function spinnerValue(sp: HTMLElement | null | undefined): number {
  return parseDecimalLoose(
    sp?.dataset?.val ?? sp?.querySelector<HTMLInputElement>('.spin-val')?.value ?? '0',
  );
}

/** Set a .num-spinner from code. */
export function setSpinnerValue(sp: HTMLElement, value: number): void {
  sp.dataset.val = String(value);
  const inp = sp.querySelector<HTMLInputElement>('.spin-val');
  if (inp) inp.value = formatNumber(value);
}

/**
 * Enable or disable a .num-spinner. It keeps its value; `blank` shows a dash while it is disabled
 * (a Weging SE that does not apply, design spec 4.11).
 */
export function setSpinnerEnabled(sp: HTMLElement, enabled: boolean, blank = false): void {
  sp.classList.toggle('spinner-disabled', !enabled);
  sp.querySelectorAll<HTMLButtonElement>('.spin-btn').forEach((b) => {
    b.disabled = !enabled;
  });
  const inp = sp.querySelector<HTMLInputElement>('.spin-val');
  if (!inp) return;
  inp.disabled = !enabled;
  inp.value = !enabled && blank ? '—' : formatNumber(num(sp.dataset.val, 0));
}
