// SPDX-License-Identifier: AGPL-3.0-or-later

// The Opdracht card (design spec 4.17, board 58, PLAN-2 decision 47): name and ⋮, the description,
// "<schoolsoort> · <vakken>", and a bottom row with the jaarlagen and the linked observaties'
// icons. Pure: the screen (opdrachten.ts) wires the clicks.

import { cardMenuButton } from '../../components/card-menu';
import { esc } from '../../components/dialog';
import type { Observatie, Opdracht } from '../../domain/types';
import { VAK_CHIPS } from '../../domain/vakken';
import { jaarlagenBoxes } from '../cards/item-card';

const SUBJECT_LABEL: Record<string, string> = Object.fromEntries(VAK_CHIPS);

export interface OpdFields extends Opdracht {
  beschrijving?: string;
}

/** "Havo, Vwo · Natuurkunde, Scheikunde"; a missing part is left out, both missing: "". */
export function opdMetaLine(o: OpdFields): string {
  const ss = (o.schoolsoort ?? []).join(', ');
  const vakken = (o.vakken ?? []).map((v) => SUBJECT_LABEL[v] ?? v).join(', ');
  return [ss, vakken].filter(Boolean).join(' · ');
}

/** Sort: lowest jaarlaag first (none last), then the name. */
export function compareOpdrachten(a: OpdFields, b: OpdFields): number {
  const low = (o: OpdFields) =>
    Math.min(...(o.jaarlagen?.length ? o.jaarlagen.map(Number) : [Infinity]));
  const la = low(a);
  const lb = low(b);
  if (la !== lb) return la < lb ? -1 : 1;
  return (a.naam ?? '').localeCompare(b.naam ?? '', 'nl');
}

export function opdCardHtml(o: OpdFields, obsById: ReadonlyMap<string, Observatie>): string {
  const linked = (o.observaties ?? []).map((id) => obsById.get(id)).filter(Boolean) as Observatie[];
  const icons = linked.length
    ? `<span class="icard-obs" role="img" aria-label="${esc(`Observaties: ${linked.map((x) => x.naam ?? '').join(', ')}`)}">${linked
        .map((x) => `<span title="${esc(x.naam ?? '')}">${esc(x.icon ?? '')}</span>`)
        .join('')}</span>`
    : '';
  const meta = opdMetaLine(o);
  return `
    <article class="icard icard--opd" data-opd-card="${esc(o.id)}" title="Klik voor een voorbeeld">
      <div class="icard-head">
        <button type="button" class="icard-title" data-action="preview" data-id="${esc(o.id)}" title="${esc(o.naam ?? '')}" aria-controls="opd-preview" aria-expanded="false">${esc(o.naam ?? '')}</button>
        ${cardMenuButton({ action: 'opd-menu', id: o.id })}
      </div>
      <div class="icard-desc">${esc(o.beschrijving ?? '')}</div>
      <div class="icard-meta">${meta ? esc(meta) : '—'}</div>
      <div class="icard-foot">
        ${jaarlagenBoxes(o.jaarlagen)}
        <span class="icard-spacer"></span>
        ${icons}
      </div>
    </article>`;
}
