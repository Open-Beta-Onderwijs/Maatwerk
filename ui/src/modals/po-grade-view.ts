// SPDX-License-Identifier: AGPL-3.0-or-later

// The markup and the line drafts of "Projectgroep beoordelen" (po-beoordelen.ts; step 23b, board
// 18). Pure: builds HTML from the dialog's state; every text is escaped here.

import { esc } from '../components/dialog';
import { poLineValid } from '../domain/grades';
import { lineText, parseLineValue, type GroupGrading } from '../domain/po-grading';
import type { RubricCategory } from '../domain/rubric';
import type { PoLine } from '../domain/types';

export interface LineDraft {
  label: string;
  /** As typed; saved only when it is a valid line value. */
  text: string;
}

export interface Obs {
  id: string;
  naam: string;
  icon?: string;
}

/** A stored line for editing, its value exactly as stored (review 23 M2). */
export const draftOf = (l: PoLine): LineDraft => ({
  label: l.label,
  text: l.value === null ? '' : lineText(l.value),
});

/** The lines of `drafts` that count (decision 28); the rest stays in the dialog only. */
export function validLines(drafts: readonly LineDraft[]): PoLine[] {
  return drafts
    .map((d) => ({ label: d.label.trim(), value: parseLineValue(d.text) }))
    .filter((l): l is PoLine & { value: number } => l.value !== null && poLineValid(l.value));
}

export const lineInvalid = (d: LineDraft): boolean => {
  const v = parseLineValue(d.text);
  return d.text.trim() !== '' && (v === null || !poLineValid(v));
};

/** Score ticks under a slider: every point up to 20, then every 5th or 10th. */
export function ticks(max: number): number[] {
  const step = max <= 20 ? 1 : max <= 50 ? 5 : 10;
  const out: number[] = [];
  for (let i = 0; i <= max; i += step) out.push(i);
  if (out[out.length - 1] !== max) out.push(max);
  return out;
}

function levelRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`;
}

export function chipHtml(o: Obs, on: boolean, attrs: string): string {
  return `<button type="button" class="po-gr-chip${on ? ' po-gr-chip--on' : ''}" aria-pressed="${on}" ${attrs}><span aria-hidden="true">${esc(o.icon ?? '')}</span>${esc(o.naam)}</button>`;
}

function levelsHtml(c: RubricCategory, v: number | undefined): string {
  return c.niveaus
    .map((n) => {
      const [min, max] = [n.min ?? 0, n.max ?? 0];
      const on = v !== undefined && min <= v && v <= max;
      return `<div class="po-gr-level${on ? ' po-gr-level--on' : ''}" data-min="${min}" data-max="${max}"${on ? ' aria-current="true"' : ''}>
          <span class="po-gr-level-range">${levelRange(min, max)}</span>
          ${n.titel ? `<b class="po-gr-level-title">${esc(n.titel)}</b>` : ''}
          <span class="po-gr-level-text">${esc(n.uitleg)}</span>
        </div>`;
    })
    .join('');
}

/** One category card: levels, slider, then its observaties and comment. */
export function categoryHtml(
  c: RubricCategory,
  grading: GroupGrading,
  obsList: (ids: readonly string[]) => Obs[],
): string {
  const v = grading.scores[c.id];
  const max = c.max ?? 0;
  const catObs = obsList([...(c.obs_ids ?? []), ...(grading.categoryObs[c.id] ?? [])]);
  const soort =
    c.soort === 'bonus'
      ? '<span class="po-gr-pill">BONUS</span>'
      : c.soort === 'diagnostisch'
        ? '<span class="po-gr-pill po-gr-pill--diag">DIAGNOSTISCH</span>'
        : '';
  return `<section class="po-gr-cat${v === undefined ? ' po-gr-cat--empty' : ''}" data-cat="${esc(c.id)}" aria-label="${esc(c.naam)}">
      <div class="po-gr-cat-main">
        <div class="po-gr-cat-head">
          <b class="po-gr-cat-name">${esc(c.naam)}</b>${soort}
          <span class="po-gr-cat-spacer"></span>
          <button type="button" class="btn btn--text btn--sm po-gr-clear"${v === undefined ? ' hidden' : ''}>Wissen</button>
          <span class="po-gr-cat-score"><span class="po-gr-v">${v ?? '—'}</span><span class="po-gr-max"> / ${max}</span></span>
        </div>
        <div class="po-gr-levels" data-n="${c.niveaus.length}">${levelsHtml(c, v)}</div>
        <div class="po-gr-slider">
          <input type="range" min="0" max="${max}" step="1" value="${v ?? 0}" aria-label="${esc(c.naam)}: score" aria-valuetext="${v === undefined ? 'nog geen score' : `${v} van ${max}`}" />
          <div class="po-gr-ticks" aria-hidden="true">${ticks(max)
            .map((t) => `<span>${t}</span>`)
            .join('')}</div>
        </div>
      </div>
      <div class="po-gr-cat-side">
        <span class="po-gr-label">Observaties</span>
        <div class="po-gr-chips">${
          catObs.length
            ? catObs
                .map((o) =>
                  chipHtml(
                    o,
                    (grading.categoryObs[c.id] ?? []).includes(o.id),
                    `data-cat-obs="${esc(o.id)}"`,
                  ),
                )
                .join('')
            : '<span class="po-gr-none">Geen observaties bij deze categorie</span>'
        }</div>
        <textarea class="po-gr-comment" rows="3" data-cat-comment="${esc(c.id)}" placeholder="Opmerking bij ${esc(c.naam)}" aria-label="Opmerking bij ${esc(c.naam)}">${esc(grading.categoryComments[c.id] ?? '')}</textarea>
      </div>
    </section>`;
}

function lineRow(d: LineDraft, attrs: string): string {
  return `
    <div class="po-gr-line" ${attrs}>
      <input type="text" class="po-gr-line-label" value="${esc(d.label)}" placeholder="Omschrijving" aria-label="Omschrijving" />
      <input type="text" class="po-gr-line-value" inputmode="decimal" value="${esc(d.text)}" placeholder="±0,5" aria-label="Cijferpunten" title="Cijferpunten: één decimaal, van −9,0 tot +9,0"${lineInvalid(d) ? ' aria-invalid="true"' : ''} />
      <button type="button" class="btn btn--icon po-gr-line-remove" aria-label="Regel verwijderen" title="Regel verwijderen">×</button>
    </div>`;
}

/** The bonus/malus card: the group's lines and every member's own. */
export function linesHtml(
  groupDrafts: readonly LineDraft[],
  members: readonly string[],
  ownDrafts: ReadonlyMap<string, LineDraft[]>,
  name: (id: string) => string,
): string {
  return `
    <div class="po-gr-adj-col">
      <span class="po-gr-label">Bonus / malus voor de hele projectgroep</span>
      ${groupDrafts.map((d, i) => lineRow(d, `data-line="group" data-i="${i}"`)).join('')}
      <button type="button" class="btn po-gr-add-line" data-add-line="group">+ Regel</button>
    </div>
    <div class="po-gr-adj-col">
      <span class="po-gr-label">Bonus / malus per leerling</span>
      ${members
        .map(
          (m) => `<div class="po-gr-member-lines" data-member="${esc(m)}">
            <span class="po-gr-member-name">${esc(name(m))}</span>
            <div class="po-gr-member-list">
              ${(ownDrafts.get(m) ?? []).map((d, i) => lineRow(d, `data-line="own" data-member="${esc(m)}" data-i="${i}"`)).join('')}
              <button type="button" class="btn po-gr-add-line" data-add-line="own" data-member="${esc(m)}">+ Regel</button>
            </div>
          </div>`,
        )
        .join('')}
    </div>
    <p class="po-gr-line-hint">Cijferpunten met hoogstens één decimaal, van −9,0 tot +9,0. Een regel zonder geldige waarde wordt niet bewaard.</p>`;
}
