// SPDX-License-Identifier: AGPL-3.0-or-later

// The "laatste / SE" swap of the student cards, years 4-6 (spec 4.3: all cards in sync). One clock
// for the whole app: `data-card-swap` on <html> flips between "a" and "b" every half cycle and
// cards.css cross-fades the two values. Every card follows the same attribute, so cards added
// later or scrolled into view are in step without any work per card.
//
// Perf hotfix 0.24.1: before, every card ran its own CSS animation and the app set each one's
// startTime through getAnimations(), a style computation per card (seconds on a full list).

/** Half of the 9 s cycle: each value shows ~3,8 s plus the 0,7 s cross-fade. */
export const SWAP_HALF_MS = 4500;

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the clock (once; later calls do nothing). "laatste" shows first. */
export function startSwapClock(): void {
  if (timer) return;
  const root = document.documentElement;
  root.dataset.cardSwap = 'a';
  timer = setInterval(() => {
    // A hidden window has nothing to show; the next tick carries on.
    if (document.hidden) return;
    root.dataset.cardSwap = root.dataset.cardSwap === 'b' ? 'a' : 'b';
  }, SWAP_HALF_MS);
}

/** Stops the clock (tests). */
export function stopSwapClock(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
