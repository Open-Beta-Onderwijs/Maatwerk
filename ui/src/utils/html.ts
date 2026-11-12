// SPDX-License-Identifier: AGPL-3.0-or-later

// HTML escaping without the DOM (usable from Node tests too).

/** Escapes text for HTML content and attribute values. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
