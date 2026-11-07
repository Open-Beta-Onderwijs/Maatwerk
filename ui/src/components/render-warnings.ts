// SPDX-License-Identifier: AGPL-3.0-or-later

// Typst warnings above a generated PDF (F-04): the rapport and the opdrachten
// dialogs. The PDF is made; a warning says something may look wrong in it,
// e.g. a character no font has. Folded by default: the count is the message,
// the Typst texts are for whoever fixes the text.

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** The panel for `warnings`, or '' when there are none. */
export function renderWarningsHtml(warnings: readonly string[] | undefined): string {
  if (!warnings?.length) return '';
  const n = warnings.length;
  const title =
    n === 1
      ? '1 waarschuwing bij het maken van de PDF'
      : `${n} waarschuwingen bij het maken van de PDF`;
  return `<details class="render-warnings">
  <summary>${title}: controleer de PDF.</summary>
  ${warnings.map((w) => `<pre>${esc(w)}</pre>`).join('')}
</details>`;
}
