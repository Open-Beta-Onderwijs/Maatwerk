// SPDX-License-Identifier: AGPL-3.0-or-later

// Content Security Policy (ADR-0002 section 7). No remote origins, no inline
// scripts or styles, no eval. Styles set through the CSSOM (el.style.x = …,
// as Chart.js and the grid do) are not affected by style-src.

import type { Plugin } from 'vite';

const COMMON = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  // pdf.js runs its worker from a bundled file
  'worker-src': ["'self'", 'blob:'],
  // editor.html and pdf-viewer.html
  'frame-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
};

const render = (directives: Record<string, string[]>) =>
  Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');

/** The app (tauri.conf.json app.security.csp; a test keeps them equal). */
export const APP_CSP = render({
  ...COMMON,
  'connect-src': ['ipc:', 'http://ipc.localhost'],
  // 'self', not 'none': editor.html and pdf-viewer.html are framed by the app (review 3a M1).
  'frame-ancestors': ["'self'"],
});

/**
 * The mock build in a browser, as a <meta> tag: no IPC, the PDF viewer loads
 * blob: URLs, and frame-ancestors is ignored in a meta tag.
 */
export const MOCK_CSP = render({ ...COMMON, 'connect-src': ["'self'", 'blob:'] });

/** Adds MOCK_CSP as a meta tag to every page of `vite build --mode mock`. */
export function mockCsp(): Plugin {
  let enabled = false;
  return {
    name: 'maatwerk-mock-csp',
    apply: 'build',
    configResolved(config) {
      enabled = config.mode === 'mock';
    },
    transformIndexHtml(html) {
      if (!enabled) return html;
      return html.replace(
        /<head>/,
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${MOCK_CSP}" />`,
      );
    },
  };
}
