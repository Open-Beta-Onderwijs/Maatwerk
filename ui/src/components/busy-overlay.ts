// SPDX-License-Identifier: AGPL-3.0-or-later

// A blocking busy message over the whole window (step 37, user): a spinner and one Dutch line,
// e.g. "Gegevens opslaan, dan afsluiten…" while the app saves before it closes. Above dialogs;
// nothing under it can be clicked. Nested calls stack: the newest text shows, and the overlay
// goes when the last one is hidden.

let overlay: HTMLElement | null = null;
const texts: string[] = [];

function render(): void {
  if (!texts.length) {
    overlay?.remove();
    overlay = null;
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'busy-overlay';
    overlay.setAttribute('role', 'alert');
    overlay.setAttribute('aria-busy', 'true');
    overlay.innerHTML =
      '<div class="busy-overlay__box"><span class="busy-overlay__spin" aria-hidden="true"></span><span class="busy-overlay__text"></span></div>';
    document.body.appendChild(overlay);
  }
  overlay.querySelector('.busy-overlay__text')!.textContent = texts.at(-1)!;
}

/** Shows `text` over the window until the returned function is called (once is enough). */
export function showBusy(text: string): () => void {
  if (typeof document === 'undefined') return () => {}; // unit tests without a DOM
  const entry = text;
  texts.push(entry);
  render();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = texts.lastIndexOf(entry);
    if (i >= 0) texts.splice(i, 1);
    render();
  };
}
