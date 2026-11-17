// SPDX-License-Identifier: AGPL-3.0-or-later

// The divider between the editor and the preview (F-16, design spec 4.8): 10 px with a 4×44 grip,
// dragged between 25% and 75%, a double click resets to 50%, the arrow keys move it by 2%
// (role="separator"). The ratio is saved per user (decision 3) once a drag or key press ends.

import { EDITOR_SPLIT, clampEditorSplit } from '../domain/preferences';

export interface DividerOptions {
  /** The flex row holding the left pane, the divider and the right pane. */
  host: HTMLElement;
  left: HTMLElement;
  divider: HTMLElement;
  initial: number;
  /** Called after a change ends (pointer up, key press, double click). */
  save: (split: number) => void;
  /** Called on every change (the preview re-fits its pages). */
  onChange?: () => void;
}

const KEY_STEP = 0.02;
/** Key presses in a row save once, after this pause. */
const KEY_SAVE_DELAY_MS = 500;

export function mountDivider({ host, left, divider, initial, save, onChange }: DividerOptions): {
  set: (split: number) => void;
} {
  let split = clampEditorSplit(initial);
  let saved = split;
  let keyTimer: ReturnType<typeof setTimeout> | null = null;

  const apply = () => {
    left.style.flexBasis = `${split * 100}%`;
    divider.setAttribute('aria-valuenow', String(Math.round(split * 100)));
    divider.setAttribute('aria-valuetext', `${Math.round(split * 100)}% editor`);
    onChange?.();
  };
  const commit = () => {
    if (split === saved) return;
    saved = split;
    save(split);
  };
  const set = (v: number) => {
    split = clampEditorSplit(v);
    apply();
  };

  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-valuemin', String(EDITOR_SPLIT.min * 100));
  divider.setAttribute('aria-valuemax', String(EDITOR_SPLIT.max * 100));
  divider.tabIndex = 0;
  apply();

  let drag: { x: number; split: number; width: number } | null = null;
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, split, width: host.getBoundingClientRect().width };
    host.classList.add('is-resizing');
  });
  divider.addEventListener('pointermove', (e) => {
    if (!drag || drag.width <= 0) return;
    set(drag.split + (e.clientX - drag.x) / drag.width);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    host.classList.remove('is-resizing');
    commit();
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
  divider.addEventListener('dblclick', () => {
    set(EDITOR_SPLIT.initial);
    commit();
  });
  divider.addEventListener('keydown', (e) => {
    const step =
      e.key === 'ArrowLeft'
        ? -KEY_STEP
        : e.key === 'ArrowRight'
          ? KEY_STEP
          : e.key === 'Home'
            ? EDITOR_SPLIT.min - split
            : e.key === 'End'
              ? EDITOR_SPLIT.max - split
              : 0;
    if (step === 0) return;
    e.preventDefault();
    set(split + step);
    if (keyTimer !== null) clearTimeout(keyTimer);
    keyTimer = setTimeout(() => {
      keyTimer = null;
      commit();
    }, KEY_SAVE_DELAY_MS);
  });
  // A position from outside (the saved one) is the saved state: a double click back to 50% then
  // counts as a change (review 30-31 m1).
  return {
    set: (v: number) => {
      set(v);
      saved = split;
    },
  };
}
