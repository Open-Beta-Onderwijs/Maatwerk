// SPDX-License-Identifier: AGPL-3.0-or-later
// PDF inspection for Typst goldens: page count, page sizes and text per page.

import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Text per page, one string per page. Items are joined in content-stream order;
 * pdf.js marks line ends with hasEOL. Whitespace runs collapse to one space per
 * line so tiny layout changes in spacing do not matter, but every glyph does.
 */
export async function inspectPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const task = getDocument({ data, verbosity: 0, isEvalSupported: false, useSystemFonts: false });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const [x0, y0, x1, y1] = page.view;
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      const lines = text
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      pages.push({ size: [round2(x1 - x0), round2(y1 - y0)], text: lines.join('\n') });
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await task.destroy();
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
