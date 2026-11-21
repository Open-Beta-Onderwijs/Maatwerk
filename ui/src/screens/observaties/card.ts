// SPDX-License-Identifier: AGPL-3.0-or-later

// The Observatie card (design spec 4.16, board 57, PLAN-2 decision 46): icon tile, name, ⋮,
// toetstype pills, description, and a bottom row with schoolsoort, jaarlagen and where it is used.
// Pure: the screen (observaties.ts) gathers the use counts.

import { cardMenuButton } from '../../components/card-menu';
import { esc } from '../../components/dialog';
import { obsToetstypes } from '../../domain/rubric';
import type { Exam, Observatie, Opdracht } from '../../domain/types';
import { countText, jaarlagenBoxes, metaLine } from '../cards/item-card';

/** Fields of an observatie the card and the filters read. */
export interface ObsFields extends Observatie {
  uitleg?: string;
  schoolsoort?: string[];
  jaarlagen?: (string | number)[];
  subjects?: string[];
}

/** Where an observatie is used: tests of the active school year, linked opdrachten. */
export interface ObsUse {
  tests: number;
  opdrachten: string[];
}

/**
 * The use of every observatie: the tests of the given year that link it (a resit counts with its
 * original, it carries the original's observaties) and the opdrachten that link it.
 */
export function obsUse(
  exams: readonly Exam[],
  opdrachten: readonly Opdracht[],
): (id: string) => ObsUse {
  const tests = new Map<string, number>();
  for (const e of exams) {
    if (e.parent_id) continue;
    for (const id of new Set(e.obs_ids ?? [])) tests.set(id, (tests.get(id) ?? 0) + 1);
  }
  const opd = new Map<string, string[]>();
  for (const o of opdrachten) {
    for (const id of new Set(o.observaties ?? [])) {
      if (!opd.has(id)) opd.set(id, []);
      opd.get(id)!.push(o.naam ?? '');
    }
  }
  for (const names of opd.values()) names.sort((a, b) => a.localeCompare(b, 'nl'));
  return (id) => ({ tests: tests.get(id) ?? 0, opdrachten: opd.get(id) ?? [] });
}

/** Why an observatie cannot be deleted (as today: a test or a rubric uses it), or null. */
export function obsDeleteBlock(usedInTest: boolean, usedInRubric: boolean): string | null {
  if (usedInTest)
    return 'Deze observatie is gekoppeld aan een toets en kan dus niet worden verwijderd.';
  if (usedInRubric) return 'Deze observatie staat in een rubric en kan dus niet worden verwijderd.';
  return null;
}

function useHtml(use: ObsUse): string {
  const opdTitle = use.opdrachten.length
    ? `Gekoppelde opdrachten: ${use.opdrachten.join(', ')}`
    : 'Geen gekoppelde opdrachten';
  if (!use.tests && !use.opdrachten.length)
    return `<span class="icard-use" title="${esc(opdTitle)}">nog niet gebruikt</span>`;
  const tests = use.tests ? countText(use.tests, 'toets', 'toetsen') : 'geen toetsen';
  return `<span class="icard-use" title="Toetsen van dit schooljaar die deze observatie gebruiken">${tests}</span><span class="icard-use" title="${esc(opdTitle)}">· ${countText(use.opdrachten.length, 'opdracht', 'opdrachten')}</span>`;
}

export function obsCardHtml(o: ObsFields, use: ObsUse): string {
  const tts = obsToetstypes(o);
  const pills = tts
    .map((t) =>
      t === 'po'
        ? '<span class="icard-pill icard-pill--po">PO</span>'
        : '<span class="icard-pill icard-pill--toets">Toets</span>',
    )
    .join('');
  const meta = metaLine(o.schoolsoort, o.subjects);
  return `
    <article class="icard icard--obs" data-obs-card="${esc(o.id)}" title="Klik om te bewerken">
      <div class="icard-head">
        <span class="icard-tile" aria-hidden="true">${esc(o.icon ?? '')}</span>
        <button type="button" class="icard-title icard-title--wrap" data-action="edit-obs" data-id="${esc(o.id)}">${esc(o.naam ?? '')}</button>
        ${cardMenuButton({ action: 'obs-menu', id: o.id })}
      </div>
      <div class="icard-desc">${esc(o.uitleg ?? '')}</div>
      <div class="icard-meta">${meta ? esc(meta) : '—'}</div>
      <div class="icard-foot">
        <span class="icard-pills" role="group" aria-label="Toetstype">${pills}</span>
        ${jaarlagenBoxes(o.jaarlagen)}
        <span class="icard-use-group">${useHtml(use)}</span>
      </div>
    </article>`;
}
