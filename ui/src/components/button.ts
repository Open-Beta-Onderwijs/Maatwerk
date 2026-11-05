// SPDX-License-Identifier: AGPL-3.0-or-later

// Busy state of a .btn (design spec 3.1): spinner plus a label such as
// "Bezig…", disabled while busy, the original label back afterwards.

const LABEL = 'maatwerkIdleLabel';

export function setBusy(btn: HTMLButtonElement, busy: boolean, label = 'Bezig…'): void {
  if (busy) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.dataset[LABEL] = btn.textContent ?? '';
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    btn.textContent = label;
  } else {
    if (btn.getAttribute('aria-busy') !== 'true') return;
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.textContent = btn.dataset[LABEL] ?? btn.textContent;
    delete btn.dataset[LABEL];
  }
}
