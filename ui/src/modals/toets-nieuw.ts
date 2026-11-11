// SPDX-License-Identifier: AGPL-3.0-or-later

// Nieuwe toets, step 1 "Gegevens" (design spec 4.11). Step 2 is the question
// editor (toets-edit.ts).

import { formSnapshot, guardModalClose, openModal, toast } from '../app.js';
import { esc } from '../components/dialog';
import { field, isTicked } from '../components/form';
import { CustomSelect } from '../custom-select.js';
import { blankQuestions, STRUCTURE_OPTIONS } from '../domain/question-structure';
import type { Exam } from '../domain/types';
import { Store } from '../store.js';
import { spinnerValue, wireSpinners } from '../utils/spinners';
import {
  kindBoxFields,
  kindFields,
  segmented,
  stepperField,
  wireKindBoxes,
  wirePeriode,
} from './exam-fields';
import { showExamEditor } from './toets-edit';

export const SCHOOLSOORTEN = [
  'Vmbo-bb',
  'Vmbo-kb',
  'Vmbo-gl',
  'Vmbo-tl',
  'Havo',
  'Vwo',
  'Gymnasium',
];

/** The steps above a new test; the other step cannot be clicked. */
export function examSteps(active: 'gegevens' | 'vragen') {
  return {
    tabs: [
      { id: 'gegevens', label: '1 · Gegevens', disabled: active !== 'gegevens' },
      { id: 'vragen', label: '2 · Vragen', disabled: active !== 'vragen' },
    ],
    activeTab: active,
  };
}

export function openNewExamModal(toetsYear: string, afterSave: (() => void) | null): void {
  const isWi = Store.getActiveSubject() === 'wi';
  const schoolSS: string[] = Store.getSchoolSync().schoolsoort ?? [];

  openModal({
    title: 'Nieuwe toets',
    size: 'form',
    key: 'exam-edit',
    ...examSteps('gegevens'),
    footerHtml: `
      <button class="btn btn--primary" id="f-e-next">Verder →</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: `
    <div class="form-row exam-new-row">
      <div class="u-flex-fill u-min-w-0 u-mb-0 form-group">
        <label for="f-etitle">Naam</label>
        <input id="f-etitle" type="text" placeholder="PTA t.na-3 (H4, 9, 11, K3)" />
      </div>
      ${kindBoxFields({ pta: 'f-epta-btn', diag: 'f-ediag-btn' }, { pta: false, diag: false })}
      ${field('Schooljaar', `<div class="form-value">${esc(toetsYear)}</div>`, { grow: 'none', className: 'u-mb-0 exam-new-year' })}
    </div>
    <div class="form-row exam-new-row">
      <div class="u-flex-none u-mb-0 form-group">
        <label>Schoolsoort</label>
        <div class="exam-chips">
          ${SCHOOLSOORTEN.map((ss) => {
            const dis = schoolSS.length > 0 && !schoolSS.includes(ss);
            return `<button type="button" class="tog-btn ss-btn exam-chip${dis ? ' tog-btn-disabled' : ''}" data-ss="${ss}"${dis ? ' disabled' : ''}>${ss}</button>`;
          }).join('')}
        </div>
      </div>
      ${
        isWi
          ? `
      <div class="u-flex-none u-mb-0 form-group">
        <label>Subcategorie</label>
        <div class="btn-toggle-group">
          <button type="button" class="tog-btn sub-btn" data-sub="wisa">A</button>
          <button type="button" class="tog-btn sub-btn" data-sub="wisb">B</button>
          <button type="button" class="tog-btn sub-btn" data-sub="wisc">C</button>
          <button type="button" class="tog-btn sub-btn" data-sub="wisd">D</button>
        </div>
      </div>`
          : ''
      }
    </div>
    <div class="exam-new-grid">
      <div class="exam-new-jp">
        <div class="u-mb-0 form-group">
          <label>Jaarlaag</label>
          ${segmented('jl-btn', 'jl', [1, 2, 3, 4, 5, 6], null)}
        </div>
        <div class="u-mb-0 form-group">
          <label>Periode</label>
          ${segmented('per-btn', 'per', [1, 2, 3, 4, 5], null)}
        </div>
      </div>
      ${stepperField('Weging', 'f-eweging', { value: 1, step: 0.5, min: 0, max: 100 })}
      ${stepperField('Weging SE', 'f-eweging-se', { value: 1, step: 0.5, min: 0, max: 100 })}
      <div class="u-min-w-0 u-mb-0 form-group">
        <label>Opgave- &amp; Vraagstructuur</label>
        <div id="f-struct-host" class="csel-host"></div>
      </div>
      ${stepperField('Aantal vragen', 'f-enum', { value: 10, step: 1, min: 1, max: 40 })}
      ${stepperField('N-term', 'f-enterm', { value: 1, shown: '1,0', step: 0.1, min: 0, max: 3 })}
    </div>
    <p class="exam-diag-note" id="f-diag-note" hidden>
      <span class="test-badge test-badge--diagnostic">D</span>
      Diagnostische toets: telt niet mee voor rapport of SE. Weging staat op 0.
    </p>
    `,
    onShow: (el: HTMLElement) => {
      wireSpinners(el);

      const ptaBtn = el.querySelector<HTMLElement>('#f-epta-btn')!;
      const diagBtn = el.querySelector<HTMLElement>('#f-ediag-btn')!;
      const wegingEl = el.querySelector<HTMLElement>('#f-eweging')!;
      const note = el.querySelector<HTMLElement>('#f-diag-note')!;
      wireKindBoxes({
        pta: ptaBtn,
        diag: diagBtn,
        weging: wegingEl,
        wegingSe: el.querySelector<HTMLElement>('#f-eweging-se')!,
        onChange: (diag) => {
          note.hidden = !diag;
        },
      });

      el.querySelectorAll<HTMLElement>('.ss-btn').forEach((btn) =>
        btn.addEventListener('click', () => btn.classList.toggle('selected')),
      );

      // Jaarlaag + subcategory interlock for wiskunde
      const jlBtns = el.querySelectorAll<HTMLButtonElement>('.jl-btn');
      const subBtns = el.querySelectorAll<HTMLButtonElement>('.sub-btn');

      jlBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          jlBtns.forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          if (isWi) {
            const isOnderbouw = parseInt(btn.dataset.jl ?? '', 10) <= 3;
            subBtns.forEach((b) => {
              b.classList.toggle('tog-btn-disabled', isOnderbouw);
              b.disabled = isOnderbouw;
              if (isOnderbouw) b.classList.remove('selected');
            });
          }
        });
      });

      subBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const already = btn.classList.contains('selected');
          subBtns.forEach((b) => b.classList.remove('selected'));
          if (!already) {
            btn.classList.add('selected');
            // Grey out JL 1-3
            jlBtns.forEach((b) => {
              const low = parseInt(b.dataset.jl ?? '', 10) <= 3;
              b.classList.toggle('tog-btn-disabled', low);
              b.disabled = low;
              if (low) b.classList.remove('selected');
            });
          } else {
            // Deselected: re-enable all jaarlaag buttons
            jlBtns.forEach((b) => {
              b.classList.remove('tog-btn-disabled');
              b.disabled = false;
            });
          }
        });
      });

      wirePeriode(el);

      const structSel = new CustomSelect(el.querySelector('#f-struct-host'), {
        placeholder: '— kies structuur —',
      });
      structSel.setOptions([...STRUCTURE_OPTIONS]);
      structSel.setValue('roman');

      const initialForm = formSnapshot(el);
      guardModalClose(() => formSnapshot(el) !== initialForm);

      el.querySelector('#f-e-next')!.addEventListener('click', () => {
        const title = el.querySelector<HTMLInputElement>('#f-etitle')!.value.trim();
        const jaarlaag = el.querySelector<HTMLElement>('.jl-btn.selected')?.dataset.jl ?? '';
        const subBtn = el.querySelector<HTMLElement>('.sub-btn.selected');
        const schoolsoort = [...el.querySelectorAll<HTMLElement>('.ss-btn.selected')].map(
          (b) => b.dataset.ss ?? '',
        );
        const nterm = spinnerValue(el.querySelector<HTMLElement>('#f-enterm'));
        const count = Math.round(spinnerValue(el.querySelector<HTMLElement>('#f-enum')));
        if (!title || isNaN(nterm) || count < 1) {
          toast('Vul alle velden in.', 'error');
          return;
        }
        if (schoolsoort.length === 0) {
          toast('Selecteer minimaal één schoolsoort.', 'error');
          return;
        }

        let subcategory: string | null | undefined = undefined;
        if (isWi) {
          if (!jaarlaag) {
            toast('Selecteer een jaarlaag.', 'error');
            return;
          }
          subcategory = parseInt(jaarlaag, 10) <= 3 ? 'onderbouw' : (subBtn?.dataset.sub ?? null);
          if (!subcategory) {
            toast('Selecteer een subcategorie (A, B, C of D) voor jaarlaag 4-6.', 'error');
            return;
          }
        }

        const exam: Exam = {
          id: Store.makeExamId(),
          title,
          jaarlaag,
          subcategory,
          schoolsoort,
          n_term: nterm,
          weging_se: spinnerValue(el.querySelector<HTMLElement>('#f-eweging-se')),
          periode: el.querySelector<HTMLElement>('.per-btn.selected')?.dataset.per || null,
          ...kindFields(isTicked(diagBtn), isTicked(ptaBtn), spinnerValue(wegingEl)),
          structureMode: structSel.getValue() || 'roman',
          questions: blankQuestions(count),
        };
        showExamEditor(exam, { year: toetsYear, afterSave });
      });
    },
  });
}
