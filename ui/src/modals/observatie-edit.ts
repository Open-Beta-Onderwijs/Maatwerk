// SPDX-License-Identifier: AGPL-3.0-or-later

// Observatie toevoegen / bewerken (design spec 4.12, board 15): the form on the left (Icoon box
// next to Naam, Korte uitleg, Leeradvies, Schoolsoort, Vakken, Jaarlagen, Toetstype), the icon
// picker on the right (search, categories, 200+ emoji; F-15). Fixed height.

import {
  closeModal,
  escHtml,
  formSnapshot,
  guardModalClose,
  openModal as openModalJs,
  toast,
} from '../app.js';
import type { Dialog, DialogOptions } from '../components/dialog';
import {
  DEFAULT_OBS_ICON,
  ICON_CATEGORIES,
  ICON_COUNT,
  filterIcons,
  type IconCategory,
} from '../domain/obs-icons';
import { obsToetstypes } from '../domain/rubric';
import type { Observatie } from '../domain/types';
import { readToetstypes, toetstypeField } from '../screens/observatie-toetstype';
import { Store } from '../store.js';
import {
  jaarlagenField,
  readChips,
  schoolsoortField,
  vakkenField,
  wireChips,
} from './obs-opd-fields';

const openModal = openModalJs as (opts: DialogOptions) => Dialog;

interface ObsForm extends Observatie {
  naam: string;
  icon: string;
  uitleg?: string;
  leeradvies?: string;
  schoolsoort?: string[];
  subjects?: string[];
  subject?: string;
  jaarlagen?: string[];
}

/** The icon picker's groups for the current category and search, the current icon first. */
function pickerGroups(category: string, query: string, current: string): IconCategory[] {
  const groups = filterIcons(category, query);
  const known = ICON_CATEGORIES.some((c) => c.icons.some((i) => i.emoji === current));
  if (!known && current && category === 'Alle' && !query.trim())
    return [{ label: 'Huidig', icons: [{ emoji: current, words: 'huidig' }] }, ...groups];
  return groups;
}

function pickerGridHtml(groups: IconCategory[], selected: string): string {
  if (!groups.length) return '<p class="obs-picker-empty">Geen iconen gevonden.</p>';
  return groups
    .map(
      (g) => `
      <div class="obs-picker-group-label">${escHtml(g.label)}</div>
      <div class="obs-picker-grid">${g.icons
        .map(
          (i) =>
            `<button type="button" class="obs-icon-btn${i.emoji === selected ? ' selected' : ''}" data-icon="${escHtml(i.emoji)}"
              aria-pressed="${i.emoji === selected}" aria-label="${escHtml(i.words.split(' ')[0] ?? i.emoji)}" title="${escHtml(i.words)}">${escHtml(i.emoji)}</button>`,
        )
        .join('')}</div>`,
    )
    .join('');
}

function countText(groups: IconCategory[], query: string, category: string): string {
  if (!query.trim() && category === 'Alle') return `${ICON_COUNT} iconen`;
  const n = groups.reduce((s, g) => s + g.icons.length, 0);
  return `${n} van ${ICON_COUNT} iconen`;
}

/** Opens the modal; `onSaved` runs after a save (re-render the list). */
export function openObsModal(existingId: string | null, onSaved: () => void): void {
  const all = Store.getObservatiesSync() as ObsForm[];
  const found = existingId ? all.find((o) => o.id === existingId) : undefined;
  const isEdit = !!found;
  const obs: ObsForm = found
    ? structuredClone(found)
    : {
        id: `obs-${Date.now()}`,
        naam: '',
        icon: DEFAULT_OBS_ICON,
        uitleg: '',
        leeradvies: '',
        schoolsoort: [],
        subjects: [Store.getActiveSubject()],
        jaarlagen: [],
      };
  // Legacy single-subject field.
  if (!Array.isArray(obs.subjects) || obs.subjects.length === 0)
    obs.subjects = obs.subject ? [obs.subject] : [Store.getActiveSubject()];
  const usedInTest = isEdit && Store.obsIsUsedInAnyExam(obs.id);
  const categories = ['Alle', ...ICON_CATEGORIES.map((c) => c.label)];

  openModal({
    title: isEdit ? 'Observatie bewerken' : 'Observatie toevoegen',
    key: 'obs-edit', // a second open replaces it (double click)
    size: 'lg',
    fixedHeight: true,
    className: 'modal-obs-edit',
    bodyClass: 'obs-edit-body',
    footerHtml: `
      <button class="btn btn--primary" id="f-osave">${isEdit ? 'Opslaan' : 'Toevoegen'}</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: `
    <div class="obs-edit">
      <div class="obs-edit-form">
        <div class="obs-edit-name">
          <div class="form-group">
            <span class="form-label">Icoon</span>
            <span class="obs-edit-icon" id="obs-icon-preview" role="img" aria-label="Gekozen icoon">${escHtml(obs.icon)}</span>
          </div>
          <div class="form-group obs-edit-naam">
            <label for="f-onam">Naam</label>
            <input id="f-onam" type="text" value="${escHtml(obs.naam)}" placeholder="bijv. Eenheid vergeten" />
          </div>
        </div>
        <div class="form-group">
          <label for="f-ouit">Korte uitleg</label>
          <textarea id="f-ouit" rows="2"
            placeholder="Bijvoorbeeld: Leerling is bij het beantwoorden van rekenvragen de eenheid vergeten.">${escHtml(obs.uitleg ?? '')}</textarea>
        </div>
        <div class="form-group">
          <label for="f-oleeradvies">Leeradvies <span class="form-label-hint">Voor de leerling, in de toetsanalyse</span></label>
          <textarea id="f-oleeradvies" rows="4"
            placeholder="Bijvoorbeeld: Vergeet nooit te controleren of je de eenheid vergeten bent. Gebruik de GFBA-methode (Gegevens, Formule, Berekening &amp; Antwoord).">${escHtml(obs.leeradvies ?? '')}</textarea>
        </div>
        ${schoolsoortField('obs-ss-group', obs.schoolsoort ?? [])}
        ${vakkenField('obs-subj-group', obs.subjects)}
        <div class="obs-edit-row">
          ${jaarlagenField('obs-jl-group', obs.jaarlagen ?? [])}
          ${toetstypeField(obsToetstypes(obs), usedInTest, isEdit ? obs.id : undefined)}
        </div>
      </div>
      <aside class="obs-picker" aria-label="Icoon kiezen">
        <div class="obs-picker-head">
          <label class="obs-picker-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
            <input type="search" id="obs-icon-search" placeholder="Zoek icoon (bijv. grafiek, lamp, molecuul)" aria-label="Zoek icoon" autocomplete="off" />
          </label>
          <div class="obs-picker-cats" role="group" aria-label="Categorie">
            ${categories
              .map(
                (c) =>
                  `<button type="button" class="obs-picker-cat${c === 'Alle' ? ' selected' : ''}" data-cat="${escHtml(c)}" aria-pressed="${c === 'Alle'}">${escHtml(c)}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="obs-picker-scroll" id="obs-icon-grid"></div>
        <div class="obs-picker-foot" aria-live="polite"></div>
      </aside>
    </div>`,
    onShow: (el) => {
      const form = el.querySelector<HTMLElement>('.obs-edit-form')!;
      const grid = el.querySelector<HTMLElement>('#obs-icon-grid')!;
      const foot = el.querySelector<HTMLElement>('.obs-picker-foot')!;
      const search = el.querySelector<HTMLInputElement>('#obs-icon-search')!;
      let icon = obs.icon;
      let category = 'Alle';

      const renderPicker = () => {
        const groups = pickerGroups(category, search.value, icon);
        grid.innerHTML = pickerGridHtml(groups, icon);
        foot.textContent = countText(groups, search.value, category);
      };
      renderPicker();

      grid.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.obs-icon-btn');
        if (!b) return;
        icon = b.dataset.icon!;
        for (const x of grid.querySelectorAll<HTMLElement>('.obs-icon-btn')) {
          const on = x.dataset.icon === icon;
          x.classList.toggle('selected', on);
          x.setAttribute('aria-pressed', String(on));
        }
        el.querySelector('#obs-icon-preview')!.textContent = icon;
      });
      search.addEventListener('input', renderPicker);
      el.querySelector('.obs-picker-cats')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.obs-picker-cat');
        if (!b) return;
        category = b.dataset.cat!;
        for (const x of el.querySelectorAll<HTMLElement>('.obs-picker-cat')) {
          const on = x === b;
          x.classList.toggle('selected', on);
          x.setAttribute('aria-pressed', String(on));
        }
        grid.scrollTop = 0;
        renderPicker();
      });

      wireChips(form, ['obs-ss-group', 'obs-subj-group', 'obs-jl-group']);
      // Toetstype: one or both, never none (the last selected one stays on).
      for (const b of form.querySelectorAll<HTMLButtonElement>('.tt-btn:not(:disabled)')) {
        b.addEventListener('click', () => {
          const others = [...form.querySelectorAll('.tt-btn.selected')].filter((x) => x !== b);
          if (b.classList.contains('selected') && others.length === 0) return;
          b.classList.toggle('selected');
          b.setAttribute('aria-pressed', String(b.classList.contains('selected')));
        });
      }

      el.querySelector('#f-osave')!.addEventListener('click', () => {
        void (async () => {
          const naam = el.querySelector<HTMLInputElement>('#f-onam')!.value.trim();
          const schoolsoort = readChips(form, 'obs-ss-group', 'ss');
          const subjects = readChips(form, 'obs-subj-group', 'vak');
          const jaarlagen = readChips(form, 'obs-jl-group', 'jl');
          if (!naam) return toast('Vul een naam in.', 'error');
          if (!schoolsoort.length) return toast('Selecteer minstens één schoolsoort.', 'error');
          if (!subjects.length) return toast('Selecteer minstens één vak.', 'error');
          if (!jaarlagen.length) return toast('Selecteer minstens één jaarlaag.', 'error');
          const updated: ObsForm = {
            ...obs,
            naam,
            icon,
            uitleg: el.querySelector<HTMLTextAreaElement>('#f-ouit')!.value.trim(),
            leeradvies: el.querySelector<HTMLTextAreaElement>('#f-oleeradvies')!.value.trim(),
            schoolsoort,
            subjects,
            jaarlagen,
            toetstypes: readToetstypes(form),
          };
          delete updated.subject;
          await Store.upsertObservation(updated);
          closeModal();
          toast('Observatie opgeslagen.', 'success');
          onSaved();
        })();
      });

      // The picker's own buttons are no form state: only the form and the chosen icon count.
      const snapshot = () => `${formSnapshot(form)}${icon}`;
      const initial = snapshot();
      guardModalClose(() => snapshot() !== initial);
    },
  });
}
