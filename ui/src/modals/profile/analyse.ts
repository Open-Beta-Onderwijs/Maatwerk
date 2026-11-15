// SPDX-License-Identifier: AGPL-3.0-or-later

// Profile, tab Analyse (spec 4.15.2, board 44). "RTTI-scores per toets" for a school year or the
// examendossier: an RTTI card per graded attempt (PO's left out, with a note; B15: every
// attempt, the SE filter takes resits of PTA tests too) and a "Gemiddeld" card with an accent
// border, pooled over the attempts that count (decision 7). "Observaties per schooljaar": a table
// observatie × schooljaar with heat cells "n×" and Totaal.

import { isPo } from '../../domain/po';
import { RTTI_CATS } from '../../domain/rtti-names';
import { pooledRtti, rttiGemHistory, rttiPercents } from '../../domain/statistics';
import type { Observatie } from '../../domain/types';
import { examBadgeHtml } from '../../overview/common';
import { rttiCardHtml } from '../../overview/rtti-card';
import { rttiLegendHtml } from '../../overview/rtti-line';
import { esc } from '../../utils/html';
import { attemptCode } from '../../domain/exam-info';
import type { ProfileData, ProfileTest } from './data';

const NOTE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>';

/** The attempts of a school year, or of the examendossier (`se`). */
export function rttiTests(d: ProfileData, key: string): ProfileTest[] {
  return d.attempts.filter((t) =>
    key === 'se' ? t.exam.type === 'pta' : t.exam.academic_year === key,
  );
}

const pctsOf = (t: ProfileTest) =>
  RTTI_CATS.map((c) => {
    const v = t.res[c];
    return typeof v === 'number' ? v : null;
  });

export function rttiCardsHtml(d: ProfileData, key: string, yearLabel: (yr: string) => string) {
  const tests = rttiTests(d, key);
  const pos = tests.filter((t) => isPo(t.exam));
  const rtti = tests.filter((t) => !isPo(t.exam));
  const gem = rttiPercents(pooledRtti(rttiGemHistory(d.history, key)), [...RTTI_CATS]);
  const cards = rtti
    .map((t) =>
      rttiCardHtml({ leadHtml: examBadgeHtml(t.exam), title: t.exam.title ?? '', pcts: pctsOf(t) }),
    )
    .join('');
  const avgTitle = `Gemiddeld ${key === 'se' ? 'examendossier' : yearLabel(key)}`;
  const avg = rtti.length
    ? rttiCardHtml({ title: avgTitle, pcts: gem }).replace(
        'ov-card ov-rcard',
        'ov-card ov-rcard pf-rcard--avg',
      )
    : '';
  const note = pos.length
    ? `<div class="ov-note">${NOTE_ICON}<span>${esc(
        pos.map((t) => `${attemptCode(t.exam)} ${t.exam.title ?? ''}`.trim()).join(', ') +
          (pos.length === 1
            ? ' is een praktische opdracht en heeft geen RTTI-verdeling; die staat niet in deze grafiek.'
            : ' zijn praktische opdrachten en hebben geen RTTI-verdeling; die staan niet in deze grafiek.'),
      )}</span></div>`
    : '';
  if (!rtti.length)
    return `<p class="hint ov-empty">Geen toetsen met RTTI-scores in deze selectie.</p>${note}`;
  return `${rttiLegendHtml()}<div class="ov-grid pf-rgrid">${cards}${avg}</div>${note}`;
}

export function obsTableHtml(d: ProfileData, yearLabel: (yr: string) => string): string {
  const byId = new Map(d.observaties.map((o) => [o.id, o]));
  const ids = [...new Set(d.years.flatMap((yr) => Object.keys(d.obsPerYear[yr] ?? {})))];
  const rows = ids
    .map((id) => byId.get(id))
    .filter((o): o is Observatie => !!o)
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'));
  if (!rows.length) return '<p class="hint ov-empty">Nog geen observaties.</p>';
  const max = Math.max(
    1,
    ...rows.flatMap((o) => d.years.map((yr) => d.obsPerYear[yr]?.[o.id] ?? 0)),
  );
  const head =
    `<tr><th class="ov-heat__name">Observatie</th>` +
    d.years.map((yr) => `<th>${esc(yearLabel(yr))}</th>`).join('') +
    `<th class="ov-heat__tot-th">Totaal</th></tr>`;
  const body = rows
    .map((o) => {
      let total = 0;
      const cells = d.years
        .map((yr) => {
          const n = d.obsPerYear[yr]?.[o.id] ?? 0;
          total += n;
          if (!n) return `<td><span class="ov-heat__cell ov-heat__cell--none">—</span></td>`;
          const k = n / max;
          const pct = Math.round(((24 + k * 190) / 255) * 100);
          return `<td><span class="ov-heat__cell${k > 0.55 ? ' ov-heat__cell--strong' : ''}" data-bg="color-mix(in srgb, var(--accent) ${pct}%, transparent)">${n}×</span></td>`;
        })
        .join('');
      return (
        `<tr><td class="ov-heat__name"><span class="ov-name"><span class="ov-obs__icon" aria-hidden="true">${esc(o.icon ?? '')}</span>${esc(o.naam ?? '')}</span></td>` +
        `${cells}<td class="ov-heat__tot">${total}</td></tr>`
      );
    })
    .join('');
  return `<table class="ov-heat"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
