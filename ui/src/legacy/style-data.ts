// SPDX-License-Identifier: AGPL-3.0-or-later

// The strict CSP (ui/vite/csp.ts) blocks style="" attributes. Static styles
// are CSS classes; values computed at render time (a grade colour, a chart
// height) are written as one of these data attributes and applied through
// the CSSOM, which the CSP allows. Only this fixed list is supported, so
// injected markup cannot set arbitrary styles.

const PROPS: Record<string, string> = {
  'data-bg': 'background',
  'data-color': 'color',
  'data-border-color': 'border-color',
  'data-badge-color': '--badge-color',
  'data-w': 'width',
  'data-h': 'height',
  'data-min-w': 'min-width',
  // Initially hidden elements that JS shows with el.style.display = ''.
  'data-display': 'display',
};

const ATTRS = Object.keys(PROPS);
const SELECTOR = ATTRS.map((a) => `[${a}]`).join(',');

// Applied once and the attribute removed, like an inline style that is parsed
// once: moving the element later (app.js moves the filter bar) or changing
// el.style afterwards behaves as it did with style="".
function apply(el: Element): void {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return;
  for (const attr of ATTRS) {
    const value = el.getAttribute(attr);
    if (value === null) continue;
    el.style.setProperty(PROPS[attr]!, value);
    el.removeAttribute(attr);
  }
}

/** Applies the style data of `root` and its descendants. */
export function applyStyleData(root: ParentNode): void {
  if (root instanceof Element) apply(root);
  root.querySelectorAll(SELECTOR).forEach(apply);
}

/**
 * Keeps style data applied for everything added to the document later. The
 * observer runs as a microtask: before the next paint, but after the rest of
 * the current task. Code that measures layout or toggles el.style right after
 * setting innerHTML must call applyStyleData first (showModal in app.js does).
 */
export function watchStyleData(doc: Document = document): void {
  applyStyleData(doc);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') apply(r.target as Element);
      else r.addedNodes.forEach((n) => n instanceof Element && applyStyleData(n));
    }
  }).observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}
