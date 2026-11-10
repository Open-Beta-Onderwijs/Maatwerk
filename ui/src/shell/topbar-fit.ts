// SPDX-License-Identifier: AGPL-3.0-or-later

// The top bar on a narrow window (user 2026-11-10): when the tabs do not fit, the wordmark goes
// and only the logo stays (`#topbar.topbar--narrow`). Measured, not a fixed breakpoint: the tabs
// differ per role (teacher, admin) and the font per platform.

const NARROW = 'topbar--narrow';

/** Shows the wordmark only when every tab still fits next to it. */
export function fitTopbar(): void {
  const bar = document.getElementById('topbar');
  const nav = document.getElementById('main-nav');
  if (!bar || !nav || bar.classList.contains('hidden')) return;
  // Measure with the wordmark (same frame: no flicker), then keep it only if nothing overflows.
  bar.classList.remove(NARROW);
  if (nav.scrollWidth > nav.clientWidth) bar.classList.add(NARROW);
}

/** Refits on every size change of the bar and when tabs are shown or hidden (login, role). */
export function watchTopbar(): void {
  const bar = document.getElementById('topbar');
  const nav = document.getElementById('main-nav');
  if (!bar || !nav) return;
  new ResizeObserver(() => fitTopbar()).observe(bar);
  new MutationObserver(() => fitTopbar()).observe(nav, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  // The bar is shown at login: fit then. Only that change counts; fitTopbar changes the class too.
  let hidden = bar.classList.contains('hidden');
  new MutationObserver(() => {
    const now = bar.classList.contains('hidden');
    if (now !== hidden) {
      hidden = now;
      fitTopbar();
    }
  }).observe(bar, { attributes: true, attributeFilter: ['class'] });
  void document.fonts?.ready.then(fitTopbar);
}
