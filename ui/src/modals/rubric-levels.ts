// SPDX-License-Identifier: AGPL-3.0-or-later

// The parts of one category in the rubric editor (spec 4.13, board 16), as HTML: the level
// display (a number row 0..max, one bar per level spanning exactly its boxes; scores no level
// covers in red) and the level rows (van-tot, titel, uitleg). Pure: no state, no listeners.

import { esc } from '../components/dialog';
import {
  MAX_LEVELS,
  MIN_LEVELS,
  SOORTEN,
  type CategoryCheck,
  type RubricCategory,
} from '../domain/rubric';

/** The display stops drawing boxes above this max (the rule still applies). */
const MAX_DRAWN = 60;

function whole(x: number | null): number | null {
  return x !== null && Number.isInteger(x) && x >= 0 ? x : null;
}

/** "2–4  Voldoende" or "3". */
function rangeLabel(min: number, max: number, titel: string | undefined): string {
  const range = min === max ? `${min}` : `${min}–${max}`;
  return titel ? `${range}  ${titel}` : range;
}

/** The number row and the bars; empty while the max is not a usable whole number. */
export function levelDisplay(cat: RubricCategory, check: CategoryCheck | undefined): string {
  const max = whole(cat.max);
  if (max === null || max < 1 || max > MAX_DRAWN) return '';
  const cells = max + 1;
  const uncovered = new Set(check?.uncovered ?? []);
  const numbers = Array.from({ length: cells }, (_, n) => {
    const gap = uncovered.has(n);
    return `<span class="rubric-scale-n${gap ? ' rubric-scale-n--gap' : ''}">${n}</span>`;
  }).join('');
  const bars = cat.niveaus
    .map((lv, i) => {
      const lo = whole(lv.min);
      const hi = whole(lv.max);
      if (lo === null || hi === null || lo > hi || hi > max) return '';
      const left = (lo / cells) * 100;
      const width = ((hi - lo + 1) / cells) * 100;
      const label = rangeLabel(lo, hi, lv.titel);
      return `<div class="rubric-bar" data-bar="${left} ${width} ${i}" title="${esc(label)}">${esc(label)}</div>`;
    })
    .join('');
  return `<div class="rubric-display" aria-hidden="true" data-cells="${cells}" data-rows="${cat.niveaus.length}">
    <div class="rubric-scale">${numbers}</div>
    <div class="rubric-bars">${bars}</div>
  </div>`;
}

/**
 * Sets the display's geometry as CSS variables. The CSP blocks style="" attributes, so the
 * markup carries numbers and this writes them through the CSSOM (as legacy/style-data.ts).
 */
export function applyLevelDisplay(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.rubric-display[data-cells]').forEach((d) => {
    d.style.setProperty('--cells', String(Number(d.dataset.cells)));
    d.style.setProperty('--rows', String(Number(d.dataset.rows)));
  });
  root.querySelectorAll<HTMLElement>('.rubric-bar[data-bar]').forEach((b) => {
    const [l = 0, w = 0, row = 0] = (b.dataset.bar ?? '').split(' ').map(Number);
    b.style.setProperty('--l', `${l}%`);
    b.style.setProperty('--w', `${w}%`);
    b.style.setProperty('--row', String(row));
  });
}

const num = (v: number | null): string => (v === null ? '' : String(v));

/** One input per bound; red when the check names the level or a shared bound. */
export function levelRows(cat: RubricCategory, check: CategoryCheck | undefined): string {
  const bad = new Set(check?.badLevels ?? []);
  const count = (key: 'min' | 'max', v: number | null): number =>
    v === null ? 0 : cat.niveaus.filter((l) => l[key] === v).length;
  const rows = cat.niveaus
    .map((lv, i) => {
      const badMin = bad.has(i) || count('min', lv.min) > 1;
      const badMax = bad.has(i) || count('max', lv.max) > 1;
      const nr = i + 1;
      return `<div class="rubric-level" data-level="${i}">
        <span class="rubric-level-range">
          <input class="rubric-num${badMin ? ' is-invalid' : ''}" data-field="min" inputmode="numeric" value="${esc(num(lv.min))}" aria-label="Niveau ${nr} van" />–<input class="rubric-num${badMax ? ' is-invalid' : ''}" data-field="max" inputmode="numeric" value="${esc(num(lv.max))}" aria-label="Niveau ${nr} tot en met" />
        </span>
        <input class="rubric-level-title" data-field="titel" value="${esc(lv.titel ?? '')}" placeholder="Titel (optioneel)" aria-label="Niveau ${nr} titel" />
        <input class="rubric-level-text${check?.missingUitleg.includes(i) ? ' is-invalid' : ''}" data-field="uitleg" value="${esc(lv.uitleg)}" placeholder="Uitleg" aria-label="Niveau ${nr} uitleg" />
        <button type="button" class="btn btn--icon rubric-level-del" data-action="del-level" aria-label="Niveau ${nr} verwijderen" title="Niveau verwijderen"${cat.niveaus.length <= MIN_LEVELS ? ' disabled' : ''}>×</button>
      </div>`;
    })
    .join('');
  const n = cat.niveaus.length;
  const maxText = whole(cat.max) ?? 'het maximum';
  return `${rows}
    <div class="rubric-level-add">
      <button type="button" class="btn btn--secondary btn--sm rubric-dashed" data-action="add-level"${n >= MAX_LEVELS ? ' disabled' : ''}>+ Niveau (${n} van ${MAX_LEVELS})</button>
      <span class="muted small">Intervallen mogen overlappen, maar delen geen begin of eind en dekken samen 0 tot en met ${esc(maxText)}.</span>
    </div>`;
}

/** Normaal / Bonus / Diagnostisch as a solid segmented control. */
export function soortSegmented(cat: RubricCategory, locked: boolean): string {
  return `<div class="btn-toggle-group exam-seg rubric-seg" role="radiogroup" aria-label="Soort">
    ${SOORTEN.map(
      (s) =>
        `<button type="button" role="radio" class="tog-btn${s.value === cat.soort ? ' selected' : ''}${locked ? ' tog-btn-disabled' : ''}" data-action="soort" data-soort="${s.value}" aria-checked="${s.value === cat.soort}"${locked ? ' disabled' : ''}>${s.label}</button>`,
    ).join('')}
  </div>`;
}

/** An observatie chip; `remove` adds a × that takes it out of the list. */
export function obsChip(o: { id: string; naam?: string; icon?: string }, remove: boolean): string {
  return `<span class="rubric-obs-chip" data-obs-id="${esc(o.id)}"><span aria-hidden="true">${esc(o.icon ?? '')}</span>${esc(o.naam ?? o.id)}${
    remove
      ? `<button type="button" class="rubric-obs-x" data-action="del-obs" aria-label="${esc(o.naam ?? o.id)} weghalen">×</button>`
      : ''
  }</span>`;
}
