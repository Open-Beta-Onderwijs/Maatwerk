// SPDX-License-Identifier: AGPL-3.0-or-later

// The AI panel's left edge as a drag handle (backlog "Resizable AI panel", user 2026-11-19):
// 380 px (board 59) is the minimum; wider by dragging, up to what leaves the editor and the
// preview room. A double click resets to 380 px, the arrow keys move it by 20 px
// (role="separator"). The width is saved per user once a drag or key press ends, like the
// editor divider (divider.ts).

import { AI_PANEL_WIDTH, clampAiPanelWidth } from '../domain/preferences';

export interface PanelResizeOptions {
  /** The flex row holding the editor, the preview, the panel and the rail. */
  host: HTMLElement;
  panel: HTMLElement;
  handle: HTMLElement;
  /** Called after a change ends (pointer up, key press, double click). */
  save: (width: number) => void;
  /** Called on every change (the preview re-fits its pages). */
  onChange?: () => void;
}

const KEY_STEP = 20;
const KEY_SAVE_DELAY_MS = 500;
/** What the editor, the divider, the preview and the rail keep at least next to the panel. */
export const KEEP_FREE_PX = 560;

/** The widest the panel may be in a row `hostWidth` wide (never under the minimum). */
export function maxPanelWidth(hostWidth: number): number {
  return Math.max(AI_PANEL_WIDTH.min, Math.min(AI_PANEL_WIDTH.max, hostWidth - KEEP_FREE_PX));
}

export function mountPanelResize({ host, panel, handle, save, onChange }: PanelResizeOptions): {
  set: (width: number) => void;
} {
  let width: number = AI_PANEL_WIDTH.initial;
  let saved = width;
  let keyTimer: ReturnType<typeof setTimeout> | null = null;

  const fit = (v: number) =>
    Math.min(clampAiPanelWidth(v), maxPanelWidth(host.getBoundingClientRect().width));
  /** Shows `width`, narrower when the window has no room for it. */
  const apply = () => {
    const shown = fit(width);
    panel.style.width = `${shown}px`;
    handle.setAttribute('aria-valuenow', String(shown));
    handle.setAttribute('aria-valuetext', `${shown} pixels`);
    onChange?.();
  };
  const set = (v: number) => {
    width = fit(v);
    apply();
  };
  const commit = () => {
    if (width === saved) return;
    saved = width;
    save(width);
  };

  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Breedte AI-assistent');
  handle.setAttribute('aria-valuemin', String(AI_PANEL_WIDTH.min));
  handle.setAttribute('aria-valuemax', String(AI_PANEL_WIDTH.max));
  handle.title = 'Sleep om de breedte te wijzigen; dubbelklik voor de standaardbreedte';
  handle.tabIndex = 0;
  apply();

  let drag: { x: number; width: number } | null = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, width: fit(width) };
    host.classList.add('is-resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    // The handle is on the panel's left edge: dragging left makes it wider.
    if (drag) set(drag.width + (drag.x - e.clientX));
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    host.classList.remove('is-resizing');
    commit();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => {
    set(AI_PANEL_WIDTH.initial);
    commit();
  });
  handle.addEventListener('keydown', (e) => {
    const cur = fit(width);
    const target =
      e.key === 'ArrowLeft'
        ? cur + KEY_STEP
        : e.key === 'ArrowRight'
          ? cur - KEY_STEP
          : e.key === 'Home'
            ? AI_PANEL_WIDTH.min
            : e.key === 'End'
              ? AI_PANEL_WIDTH.max
              : null;
    if (target === null) return;
    e.preventDefault();
    set(target);
    if (keyTimer !== null) clearTimeout(keyTimer);
    keyTimer = setTimeout(() => {
      keyTimer = null;
      commit();
    }, KEY_SAVE_DELAY_MS);
  });
  // A narrower window keeps the panel inside it; a wider one gives the chosen width back.
  let shownBefore = fit(width);
  new ResizeObserver(() => {
    const shown = fit(width);
    if (shown === shownBefore) return;
    shownBefore = shown;
    apply();
  }).observe(host);
  return {
    // The saved width, kept also when this window is too narrow for it now.
    set: (v: number) => {
      width = clampAiPanelWidth(v);
      saved = width;
      apply();
    },
  };
}
