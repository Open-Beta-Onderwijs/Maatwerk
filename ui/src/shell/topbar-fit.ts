// SPDX-License-Identifier: AGPL-3.0-or-later

// The top bar on a narrow window (user 2026-11-10), in two steps, each only when the tabs do not
// fit: first the wordmark goes and only the logo stays (`topbar--narrow`); then the inactive tabs
// show only their icon (`topbar--icons`), their name a tooltip and still the accessible name. The
// active tab keeps its name. Measured, not a fixed breakpoint: the tabs differ per role (teacher,
// admin) and the font per platform.

const NARROW = 'topbar--narrow';
const ICONS = 'topbar--icons';

function overflows(nav: HTMLElement): boolean {
  return nav.scrollWidth > nav.clientWidth;
}

/** Tooltips only while the names are hidden; otherwise they would repeat the visible text. */
function setTooltips(nav: HTMLElement, on: boolean): void {
  nav.querySelectorAll<HTMLElement>('.nav-btn').forEach((btn) => {
    const name = btn.querySelector('span')?.textContent?.trim() ?? '';
    if (on && name) btn.title = name;
    else btn.removeAttribute('title');
  });
}

/** Takes the steps one by one, as far as needed for every tab to fit. */
export function fitTopbar(): void {
  const bar = document.getElementById('topbar');
  const nav = document.getElementById('main-nav');
  if (!bar || !nav || bar.classList.contains('hidden')) return;
  // Measure from the widest form (same frame: no flicker).
  bar.classList.remove(NARROW, ICONS);
  if (overflows(nav)) bar.classList.add(NARROW);
  if (overflows(nav)) bar.classList.add(ICONS);
  setTooltips(nav, bar.classList.contains(ICONS));
}

/** Refits on every size change of the bar and when tabs are shown, hidden or activated. */
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
