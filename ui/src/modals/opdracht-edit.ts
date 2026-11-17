// SPDX-License-Identifier: AGPL-3.0-or-later

// Opdracht toevoegen / bewerken (design spec 4.12, board 15): Naam, Beschrijving, Schoolsoort,
// Vakken, Jaarlagen and the observaties it fits as emoji chips; footer "Inhoud bewerken in de
// editor" (left), Annuleren, Opslaan. Only the observaties that fit the chosen schoolsoort, vak
// and jaarlaag are offered (a field without a choice does not filter). Not filtered by toetstype
// (decision 23).

import {
  closeModal,
  escHtml,
  formSnapshot,
  guardModalClose,
  openEditor,
  openModal as openModalJs,
  toast,
} from '../app.js';
import type { Dialog, DialogOptions } from '../components/dialog';
import type { Observatie, Opdracht } from '../domain/types';
import { Store } from '../store.js';
import {
  jaarlagenField,
  readChips,
  schoolsoortField,
  vakkenField,
  wireChips,
} from './obs-opd-fields';

const openModal = openModalJs as (opts: DialogOptions) => Dialog;

interface OpdrachtForm extends Opdracht {
  naam: string;
  beschrijving?: string;
}

interface ObsLike extends Observatie {
  schoolsoort?: string[];
  subjects?: string[];
  jaarlagen?: (string | number)[];
}

/** The observatie fits the chosen values; an empty choice or an empty list always fits. */
export function obsFitsSelection(
  obs: ObsLike,
  ss: readonly string[],
  vak: readonly string[],
  jl: readonly string[],
): boolean {
  const fits = (list: readonly string[] | undefined, chosen: readonly string[]) =>
    !chosen.length || !list?.length || list.some((x) => chosen.includes(x));
  return (
    fits(obs.schoolsoort, ss) && fits(obs.subjects, vak) && fits(obs.jaarlagen?.map(String), jl)
  );
}

function obsChipsHtml(list: ObsLike[], selected: ReadonlySet<string>): string {
  if (!list.length)
    return '<span class="muted u-fs-13">Geen observaties gevonden voor de huidige selectie.</span>';
  return list
    .map((o) => {
      const on = selected.has(o.id);
      return `<button type="button" class="tog-btn chip-btn opd-obs-chip${on ? ' selected' : ''}" data-obsid="${escHtml(o.id)}" aria-pressed="${on}" title="${escHtml(String(o.uitleg ?? o.naam ?? ''))}"><span class="opd-obs-chip-icon" aria-hidden="true">${escHtml(o.icon ?? '')}</span>${escHtml(o.naam ?? '')}</button>`;
    })
    .join('');
}

/** Opens the modal; `onSaved` runs after a save (re-render the list). */
export async function openOpdrachtModal(
  existingId: string | null,
  onSaved: () => void,
): Promise<void> {
  // Every observatie, of every vak.
  const allObs = ((await window.maatwerk.readAllJson('observaties')) as ObsLike[])
    .filter((o) => o?.id)
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));
  const existing = existingId
    ? ((Store.getOpdrachtenSync() as OpdrachtForm[]).find((o) => o.id === existingId) ?? null)
    : null;
  const isEdit = !!existing;
  const data: OpdrachtForm = existing
    ? structuredClone(existing)
    : { id: '', naam: '', beschrijving: '', schoolsoort: [], vakken: [], jaarlagen: [] };
  // Kept across re-renders of the chips; also those hidden by the current filter.
  const selectedObs = new Set(data.observaties ?? []);

  openModal({
    title: isEdit ? 'Opdracht bewerken' : 'Opdracht toevoegen',
    key: 'opdracht-edit',
    size: 'form',
    className: 'modal-opd-edit',
    footerHtml: `
      <button class="btn btn--text" data-align="start" id="f-opeditor">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"></path></svg>
        Inhoud bewerken in de editor
      </button>
      <button class="btn btn--primary" id="f-opsave">${isEdit ? 'Opslaan' : 'Toevoegen'}</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: `
    <div class="form-group">
      <label for="f-opnam">Naam</label>
      <input id="f-opnam" type="text" value="${escHtml(data.naam)}" placeholder="bijv. Krachten analyseren" />
    </div>
    <div class="form-group">
      <label for="f-opbes">Beschrijving</label>
      <textarea id="f-opbes" rows="3" placeholder="Korte omschrijving van de opdracht...">${escHtml(data.beschrijving ?? '')}</textarea>
    </div>
    ${schoolsoortField('op-ss-group', data.schoolsoort ?? [])}
    ${vakkenField('op-vak-group', data.vakken ?? [])}
    ${jaarlagenField('op-jl-group', data.jaarlagen ?? [])}
    <div class="form-group">
      <span class="form-label" id="op-obs-label">Observaties <span class="form-label-hint">· deze opdracht past bij</span></span>
      <div id="op-obs-group" class="opd-obs-group" role="group" aria-labelledby="op-obs-label"></div>
    </div>
    `,
    onShow: (el) => {
      const group = el.querySelector<HTMLElement>('#op-obs-group')!;
      const chosen = () => ({
        ss: readChips(el, 'op-ss-group', 'ss'),
        vak: readChips(el, 'op-vak-group', 'vak'),
        jl: readChips(el, 'op-jl-group', 'jl'),
      });
      const renderObs = () => {
        const { ss, vak, jl } = chosen();
        group.innerHTML = obsChipsHtml(
          allObs.filter((o) => obsFitsSelection(o, ss, vak, jl)),
          selectedObs,
        );
      };
      renderObs();
      wireChips(el, ['op-ss-group', 'op-vak-group', 'op-jl-group'], renderObs);
      group.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.opd-obs-chip');
        if (!b) return;
        const id = b.dataset.obsid!;
        if (selectedObs.has(id)) selectedObs.delete(id);
        else selectedObs.add(id);
        b.classList.toggle('selected', selectedObs.has(id));
        b.setAttribute('aria-pressed', String(selectedObs.has(id)));
      });

      /** Validates and saves; the saved opdracht, or null when a field is missing. */
      const save = async (): Promise<OpdrachtForm | null> => {
        const naam = el.querySelector<HTMLInputElement>('#f-opnam')!.value.trim();
        const { ss: schoolsoort, vak: vakken, jl } = chosen();
        if (!naam) return (toast('Vul een naam in.', 'error'), null);
        if (!schoolsoort.length)
          return (toast('Selecteer minstens één schoolsoort.', 'error'), null);
        if (!vakken.length) return (toast('Selecteer minstens één vak.', 'error'), null);
        if (!jl.length) return (toast('Selecteer minstens één jaarlaag.', 'error'), null);
        // Saved: the ones chosen and still offered for the chosen schoolsoort, vak and jaarlaag.
        const offered = new Set(
          allObs.filter((o) => obsFitsSelection(o, schoolsoort, vakken, jl)).map((o) => o.id),
        );
        const id = existing?.id ?? `opdracht_${Date.now()}`;
        // C14: a new opdracht gets its folder (main.typ, lib.typ, opdracht.typ).
        if (!existing) await window.maatwerk.createOpdrachtFolder(id);
        const saved: OpdrachtForm = {
          id,
          naam,
          beschrijving: el.querySelector<HTMLTextAreaElement>('#f-opbes')!.value.trim(),
          schoolsoort,
          vakken,
          jaarlagen: jl.map(Number),
          observaties: [...selectedObs].filter((o) => offered.has(o)),
        };
        await Store.upsertOpdracht(saved);
        return saved;
      };

      el.querySelector('#f-opsave')!.addEventListener('click', () => {
        void save().then((saved) => {
          if (!saved) return;
          closeModal();
          toast(`Opdracht ${isEdit ? 'bijgewerkt' : 'toegevoegd'}.`, 'success');
          onSaved();
        });
      });
      // Saves first (a new opdracht needs its folder, a change must not be lost), then opens the
      // editor. An unchanged opdracht is not written again (review 30-31 m2).
      el.querySelector('#f-opeditor')!.addEventListener('click', () => {
        if (existing && snapshot() === initial) {
          closeModal();
          void openEditor(existing);
          return;
        }
        void save().then((saved) => {
          if (!saved) return;
          closeModal();
          onSaved();
          void openEditor(saved);
        });
      });

      const snapshot = () => `${formSnapshot(el)}${[...selectedObs].sort().join()}`;
      const initial = snapshot();
      guardModalClose(() => snapshot() !== initial);
    },
  });
}
