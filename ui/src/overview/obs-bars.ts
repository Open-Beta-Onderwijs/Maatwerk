// SPDX-License-Identifier: AGPL-3.0-or-later

// Observatie bars (design spec 3.10): a row per observatie with its icon, name, a bar and
// "n (p%)"; alphabetical unless the caller groups them (per category in the PO overview).
// `obsGroupBarsHtml` adds a thin bar per group under each observatie (exam overview).

import type { Observatie } from '../domain/types';
import { esc } from '../utils/html';
import { pctOf } from './common';

export interface ObsBarRow {
  obs: Observatie;
  n: number;
  /** The students the percentage is of. */
  of: number;
}

/** Observaties by name, as the overviews list them. */
export function byObsName(a: Observatie, b: Observatie): number {
  return (a.naam ?? '').localeCompare(b.naam ?? '', 'nl');
}

function bar(n: number, of: number, color?: string): string {
  const p = pctOf(n, of);
  return (
    `<div class="ov-obs__track"><div class="ov-obs__bar" data-w="${p}%"${color ? ` data-bg="${color}"` : ''}></div></div>` +
    `<span class="ov-obs__n">${n} (${p}%)</span>`
  );
}

function head(o: Observatie): string {
  return `<span class="ov-obs__icon" aria-hidden="true">${esc(o.icon ?? '')}</span><span class="ov-obs__name">${esc(o.naam ?? '')}</span>`;
}

export function obsBarsHtml(rows: ObsBarRow[]): string {
  return `<div class="ov-obs">${rows
    .map(
      (r) =>
        `<div class="ov-obs__row" title="${esc(`${r.n} van ${r.of} leerlingen`)}">${head(r.obs)}${bar(r.n, r.of)}</div>`,
    )
    .join('')}</div>`;
}

export interface ObsGroupSeries {
  name: string;
  color: string;
}

export interface ObsGroupRow {
  obs: Observatie;
  /** Per series: n of `of`. */
  values: { n: number; of: number }[];
}

/** A legend of the series and per observatie a thin bar per series. */
export function obsGroupBarsHtml(series: ObsGroupSeries[], rows: ObsGroupRow[]): string {
  const legend = `<div class="ov-legend">${series
    .map(
      (s) => `<span><span class="ov-legend__key" data-bg="${s.color}"></span>${esc(s.name)}</span>`,
    )
    .join('')}</div>`;
  const body = rows
    .map(
      (r) =>
        `<div class="ov-obs__group"><div class="ov-obs__row ov-obs__row--head">${head(r.obs)}</div>` +
        r.values
          .map(
            (v, i) =>
              `<div class="ov-obs__row ov-obs__row--thin" title="${esc(`${series[i]!.name}: ${v.n} van ${v.of} leerlingen`)}"><span class="ov-obs__series">${esc(series[i]!.name)}</span>${bar(v.n, v.of, series[i]!.color)}</div>`,
          )
          .join('') +
        `</div>`,
    )
    .join('');
  return `${legend}<div class="ov-obs">${body}</div>`;
}
