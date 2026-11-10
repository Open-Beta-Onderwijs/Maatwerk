// SPDX-License-Identifier: AGPL-3.0-or-later

// The Rubrics tab (step 21, design spec 4.13, board 16): the vak's rubrics as cards, with
// category chips, totals and the lock pill "In gebruik bij n PO's". Teachers and
// sectievoorzitters only (decision 25). Rubrics are shared per vak, like observaties.

import { confirmDialog, getSchoolsoortFilter, matchesJaarlaagFilter, toast } from '../app.js';
import { esc } from '../components/dialog';
import {
  checkRubric,
  duplicateRubric,
  totalsText,
  usageText,
  type Rubric,
  type RubricUse,
} from '../domain/rubric';
import { openRubricEditor } from '../modals/rubric-editor';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';

const LOCK_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

const LOCK_TOOLTIP =
  'Een PO gebruikt deze rubric: categorieën, maxima en soort liggen vast. Namen, niveaus en observaties blijven aanpasbaar.';

/** The rubric's use, kept between renders; refreshed on every render. */
let usage: Partial<Record<string, RubricUse[]>> = {};

export function usesOf(id: string): RubricUse[] {
  return usage[id] ?? [];
}

/** "Havo, Vwo · Natuurkunde · jaarlaag 3, 4". */
export function rubricMeta(r: Rubric): string {
  const vak = (Store.SUBJECT_DISPLAY as Record<string, string>)[r.subject] ?? r.subject;
  const jl = r.jaarlagen.length ? `jaarlaag ${r.jaarlagen.join(', ')}` : '';
  return [r.schoolsoort.join(', '), vak, jl].filter(Boolean).join(' · ');
}

function chip(c: Rubric['categories'][number]): string {
  const suffix = c.soort === 'bonus' ? ' · bonus' : c.soort === 'diagnostisch' ? ' · diag' : '';
  return `<span class="rubric-chip rubric-chip--${c.soort}">${esc(c.naam)} ${esc(c.max ?? '')}${suffix}</span>`;
}

function card(r: Rubric): string {
  const uses = usesOf(r.id).length;
  const totals = checkRubric(r).totals;
  const del = uses
    ? `<button class="btn btn--icon" data-action="del-rubric" data-id="${esc(r.id)}" disabled title="In gebruik: niet te verwijderen" aria-label="Verwijderen">${ICONS.trash}</button>`
    : `<button class="btn btn--icon btn--icon-danger" data-action="del-rubric" data-id="${esc(r.id)}" title="Verwijderen" aria-label="Verwijderen">${ICONS.trash}</button>`;
  return `<article class="card rubric-card" data-rubric-id="${esc(r.id)}">
    <div class="rubric-card-head">
      <div class="rubric-card-title">
        <a href="#" class="rubric-card-name" data-action="edit-rubric" data-id="${esc(r.id)}">${esc(r.naam || 'Naamloze rubric')}</a>
        <span class="muted">${esc(rubricMeta(r))}</span>
      </div>
      <button class="btn btn--icon" data-action="edit-rubric" data-id="${esc(r.id)}" title="Bewerken" aria-label="Bewerken">${ICONS.pen}</button>
      <button class="btn btn--icon" data-action="dup-rubric" data-id="${esc(r.id)}" title="Dupliceren" aria-label="Dupliceren">${ICONS.copy}</button>
      ${del}
    </div>
    <div class="rubric-chips">${r.categories.map(chip).join('')}</div>
    <div class="rubric-card-foot">
      <span class="rubric-summary">${esc(totalsText(totals, 'card'))}</span>
      ${uses ? `<span class="rubric-lock-pill" title="${esc(LOCK_TOOLTIP)}">${LOCK_ICON}${esc(usageText(uses))}</span>` : ''}
    </div>
  </article>`;
}

function visible(rubrics: Rubric[]): Rubric[] {
  const ss = getSchoolsoortFilter() as Set<string>;
  return rubrics
    .filter((r) => !r.schoolsoort.length || r.schoolsoort.some((s) => ss.has(s)))
    .filter((r) => matchesJaarlaagFilter(r.jaarlagen))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' }));
}

export async function renderRubrics(): Promise<void> {
  const container = document.getElementById('rubric-list');
  const add = document.getElementById('btn-add-rubric');
  if (!container || !add) return;
  add.onclick = () => openRubricEditor(null, { usage: [], onSaved: renderRubrics });
  try {
    usage = await Store.rubricUsage();
  } catch (e) {
    console.warn('[rubrics] usage', e);
  }
  const all = Store.getRubricsSync() as Rubric[];
  const list = visible(all);
  if (!list.length) {
    container.innerHTML = all.length
      ? '<p class="hint">Geen rubrics voor deze schoolsoort en jaarlagen.</p>'
      : '<p class="hint">Nog geen rubrics. Klik "+ Rubric toevoegen" om te beginnen.</p>';
    return;
  }
  container.innerHTML = list.map(card).join('');
  container.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    e.preventDefault();
    const r = all.find((x) => x.id === btn.dataset.id);
    if (!r) return;
    if (btn.dataset.action === 'edit-rubric') {
      openRubricEditor(r, { usage: usesOf(r.id), onSaved: renderRubrics });
    } else if (btn.dataset.action === 'dup-rubric') {
      openRubricEditor(duplicateRubric(r), { usage: [], isNew: true, onSaved: renderRubrics });
    } else if (btn.dataset.action === 'del-rubric') {
      void deleteRubric(r);
    }
  };
}

async function deleteRubric(r: Rubric): Promise<void> {
  const ok = await confirmDialog(`Rubric "${r.naam}" verwijderen?`, {
    okLabel: 'Verwijderen',
    danger: true,
  });
  if (!ok) return;
  try {
    await Store.deleteRubric(r.id);
    toast('Rubric verwijderd.', 'info');
  } catch (e) {
    if ((e as { code?: string }).code !== 'refused') throw e;
    toast((e as Error).message, 'error');
  }
  await renderRubrics();
}
