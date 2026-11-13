// SPDX-License-Identifier: AGPL-3.0-or-later

// The splash screen (F-06, design spec 4.1) lives in index.html so it paints
// before this bundle runs. The start-up code updates its status line and
// removes it once the first screen (login, folder choice, migration or an
// error) is rendered.

/** Sets the splash's status line ("Gegevens laden…"); a no-op once it is gone. */
export function setSplashStatus(text: string, doc: Document = document): void {
  const status = doc.getElementById('splash-status');
  if (status) status.textContent = text;
}

/** Fades the splash out and removes it; safe to call more than once. */
export function hideSplash(doc: Document = document): void {
  const splash = doc.getElementById('splash');
  if (!splash || splash.dataset.leaving) return;
  splash.dataset.leaving = '1';
  splash.classList.add('splash--leaving');
  const done = () => splash.remove();
  const reduced = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    done();
    return;
  }
  splash.addEventListener('transitionend', done, { once: true });
  // In case no transition runs (hidden window, no layout).
  setTimeout(done, 400);
}
