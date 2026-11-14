// SPDX-License-Identifier: AGPL-3.0-or-later

// Group overview, tab Observaties (spec 4.5.5, decision 34): observatie (icon and name,
// alphabetical) × test and PO badges; "n (p%)" of the group with an accent tint by intensity;
// empty where the observatie does not fit the test (its toetstypes), "—" for none; Totaal =
// times given this year.

import { emptyHtml, examBadgeHtml, pctOf } from '../../overview/common';
import type { Observatie } from '../../domain/types';
import { esc } from '../../utils/html';
import { obsRows, type GroupModel } from './model';

/** The tint of a count: stronger with more students; full at half the group (board 45). */
export function heatPct(n: number, groupSize: number): number {
  if (!n || !groupSize) return 0;
  const k = Math.min(1, n / (groupSize * 0.5));
  return Math.round(((24 + k * 190) / 255) * 100);
}

export function observatiesHtml(m: GroupModel, observaties: Observatie[]): string {
  const rows = obsRows(m, observaties);
  if (!m.columns.length) return emptyHtml('Nog geen toetsen voor deze jaarlaag.');
  if (!rows.length)
    return emptyHtml('Nog geen observaties gekoppeld aan de toetsen van deze groep.');
  const size = m.rows.length;
  const head =
    `<tr><th class="ov-heat__name">Observatie</th>` +
    m.columns.map((c) => `<th>${examBadgeHtml(c.original, c.original.title ?? '')}</th>`).join('') +
    `<th class="ov-heat__tot-th">Totaal</th></tr>`;
  const body = rows
    .map((r) => {
      const cells = r.counts
        .map((n) => {
          if (n === null)
            return `<td><span class="ov-heat__cell" title="Past niet bij deze toets"></span></td>`;
          if (n === 0)
            return `<td><span class="ov-heat__cell ov-heat__cell--none" title="0 van ${size} leerlingen">—</span></td>`;
          const pct = heatPct(n, size);
          const strong = n / (size * 0.5) > 0.55 ? ' ov-heat__cell--strong' : '';
          return `<td><span class="ov-heat__cell${strong}" title="${n} van ${size} leerlingen" data-bg="color-mix(in srgb, var(--accent) ${pct}%, transparent)">${n} (${pctOf(n, size)}%)</span></td>`;
        })
        .join('');
      return (
        `<tr><td class="ov-heat__name"><span class="ov-name"><span class="ov-obs__icon" aria-hidden="true">${esc(r.obs.icon ?? '')}</span>${esc(r.obs.naam ?? '')}</span></td>` +
        `${cells}<td class="ov-heat__tot" title="Keer gegeven dit schooljaar">${r.total}×</td></tr>`
      );
    })
    .join('');
  return (
    `<p class="ov-intro">Aantal leerlingen per toets bij wie de observatie is aangevinkt, met het percentage van de groep. Bij een PO telt elk lid van de projectgroep.</p>` +
    `<table class="ov-heat"><thead>${head}</thead><tbody>${body}</tbody></table>`
  );
}
