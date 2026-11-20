// SPDX-License-Identifier: AGPL-3.0-or-later

// Keeps the "laatste / SE" swap of every student card in step (spec 4.3: all cards in sync), also
// for cards added later: their CSS animations start at time 0.
//
// Perf hotfix 0.24.1: this ran per card, between the writes that fill the cards, so every
// getAnimations() flushed style for the whole list (seconds on a full Leerlingen list). Now the
// requests of a frame are merged and run in the next one: first all reads, then all writes, and
// a span is synced once. Per element, not document.getAnimations(): that one leaves out the cards
// out of view (`content-visibility: auto`), which would start out of step when scrolled to.

const SPANS = '.s-card__swap > span';
const roots = new Set<ParentNode>();
const done = new WeakSet<Element>();
let pending = false;

/** Puts the swap animations under `root` at time 0, in the next frame. */
export function syncSwaps(root: ParentNode = document): void {
  roots.add(root);
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const spans: Element[] = [];
    for (const r of roots) {
      for (const el of r.querySelectorAll(SPANS)) {
        if (!done.has(el)) spans.push(el);
      }
    }
    roots.clear();
    const animations = spans.flatMap((el) => {
      done.add(el);
      return el.getAnimations();
    });
    for (const a of animations) a.startTime = 0;
  });
}
