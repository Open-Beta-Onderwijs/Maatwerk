// SPDX-License-Identifier: AGPL-3.0-or-later

// RTTI card (design spec 3.10): badge and title, four bars in the RTTI colours (2.6) with the
// percentage above, R/T1/T2/I below. A category without points shows "NVT" and a 2 px line.

import { RTTI_CATS, RTTI_NAMES } from '../domain/rtti-names';
import { esc } from '../utils/html';

/** Bar area height in px; 100 % fills it minus room for the value. */
const AREA = 170;
const ROOM = 30;

export interface RttiCardOptions {
  /** Badge (and anything else before the title) as HTML; the caller escapes it. */
  leadHtml?: string;
  title: string;
  /** R, T1, T2, I in percent; null where there are no such points. */
  pcts: (number | null)[];
}

export function rttiCardHtml({ leadHtml = '', title, pcts }: RttiCardOptions): string {
  const bars = RTTI_CATS.map((c, i) => {
    const v = pcts[i];
    const h = v == null ? 2 : Math.max(2, Math.round((v / 100) * (AREA - ROOM)));
    const text = v == null ? 'NVT' : `${v}%`;
    return (
      `<div class="ov-rcard__col" title="${esc(`${c} ${RTTI_NAMES[c]}: ${text}`)}">` +
      `<span class="ov-rcard__v${v == null ? ' ov-rcard__v--nvt' : ''}">${text}</span>` +
      `<div class="ov-rcard__bar ov-rtti--${c.toLowerCase()}" data-h="${h}px"></div></div>`
    );
  }).join('');
  const keys = RTTI_CATS.map((c) => `<span>${c}</span>`).join('');
  const label = `RTTI ${title}: ${RTTI_CATS.map((c, i) => `${c} ${pcts[i] ?? 'NVT'}${pcts[i] == null ? '' : '%'}`).join(', ')}`;
  return (
    `<div class="ov-card ov-rcard"><div class="ov-card__head">${leadHtml}<span class="ov-card__title">${esc(title)}</span></div>` +
    `<div class="ov-rcard__bars" role="img" aria-label="${esc(label)}">${bars}</div>` +
    `<div class="ov-rcard__keys">${keys}</div></div>`
  );
}
