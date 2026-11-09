// SPDX-License-Identifier: AGPL-3.0-or-later

// Nieuwe poging (inhaal, herkansing, anders; design spec 4.11, F-12), the
// overview over the best attempts and the Verzamelkaart.

import { closeModal, escHtml, openModal, toast } from '../app.js';
import { isTicked } from '../components/form';
import { CustomSelect } from '../custom-select.js';
import { attemptCode } from '../domain/exam-info';
import { formatNTerm, formatNumber } from '../domain/format';
import { blankQuestions, STRUCTURE_OPTIONS } from '../domain/question-structure';
import { testBadgeClass } from '../domain/test-type';
import type { Exam } from '../domain/types';
import { renderToetsen } from '../screens/toetsen';
import { Store } from '../store.js';
import { spinnerValue, wireSpinners } from '../utils/spinners';
import {
  kindBoxFields,
  kindFields,
  lockedObsBlock,
  segmented,
  stepperField,
  wireKindBoxes,
  wirePeriode,
} from './exam-fields';
import { showExamEditor } from './toets-edit';
import { openExamOverviewModal } from './toets-overzicht.js';

/** The kinds of attempt; `word` fills the locked Beschrijving, Anders is typed. */
const ATTEMPT_KINDS = [
  { id: 'inhaal', label: 'Inhaal', help: 'Leerling heeft de toets gemist', word: 'INHAAL' },
  {
    id: 'herkansing',
    label: 'Herkansing',
    help: 'Leerling maakt de toets opnieuw',
    word: 'HERKANSING',
  },
  { id: 'anders', label: 'Anders', help: 'Eigen omschrijving', word: '' },
] as const;

export async function openResitModal(parentId: string, year: string): Promise<void> {
  const all: Exam[] = await Store.getExams(year);
  const parent = all.find((e) => e.id === parentId);
  if (!parent) return;
  const resits: Exam[] = Store.getResitsSync(parentId, year);
  const nextAttempt = resits.length + 2; // attempt 1 is the original
  const code = attemptCode(parent);

  const fromOriginal = [
    `Jaarlaag <b>${escHtml(String(parent.jaarlaag))}</b>`,
    `Periode <b>${escHtml(String(parent.periode ?? '—'))}</b>`,
    `Weging <b>${formatNumber(parent.weging ?? 1)}</b>`,
    ...(parent.type === 'pta'
      ? [`Weging SE <b>${formatNumber(parent.weging_se ?? parent.weging ?? 1)}</b>`]
      : []),
  ];

  openModal({
    title: 'Nieuwe poging',
    subtitleHtml: `van <span class="${testBadgeClass(parent)}">${escHtml(code)}</span> ${escHtml(parent.title)}`,
    // Verder replaces it with the exam editor (step 2).
    key: 'exam-edit',
    className: 'dlg--attempt',
    footerHtml: `
      <button class="btn btn--primary" id="f-resit-next">Verder →</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: `
    <div class="u-mb-0 form-group">
      <label id="f-resit-kind-label">Soort poging</label>
      <div class="attempt-kinds" role="radiogroup" aria-labelledby="f-resit-kind-label">
        ${ATTEMPT_KINDS.map(
          (k, i) => `
          <button type="button" class="attempt-kind" role="radio" data-kind="${k.id}" aria-checked="${i === 0}" tabindex="${i === 0 ? 0 : -1}">
            <b>${k.label}</b><span class="muted">${k.help}</span>
          </button>`,
        ).join('')}
      </div>
    </div>
    <div class="u-mt-10 u-mb-0 form-group">
      <label for="f-resit-desc">Beschrijving</label>
      <input id="f-resit-desc" type="text" value="INHAAL" placeholder="Eigen omschrijving" autocomplete="off" disabled />
    </div>
    <p class="attempt-from-original">
      ${fromOriginal.map((p) => `<span>${p}</span>`).join('')}<span>van het origineel</span>
    </p>
    <div class="exam-new-grid exam-new-grid--resit">
      <div class="u-min-w-0 u-mb-0 form-group">
        <label>Opgave- &amp; Vraagstructuur</label>
        <div id="f-resit-struct-host" class="csel-host"></div>
      </div>
      ${stepperField('Aantal vragen', 'f-resit-num', { value: parent.questions.length, step: 1, min: 1, max: 40 })}
      ${stepperField('N-term', 'f-resit-nterm', { value: parent.n_term ?? 1, shown: formatNTerm(parent.n_term ?? 1), step: 0.1, min: 0, max: 3 })}
    </div>
    ${lockedObsBlock(parent.obs_ids)}
    `,
    onShow: (el: HTMLElement) => {
      const descInput = el.querySelector<HTMLInputElement>('#f-resit-desc')!;
      const kinds = [...el.querySelectorAll<HTMLElement>('.attempt-kind')];
      const pick = (card: HTMLElement) => {
        kinds.forEach((k) => {
          k.setAttribute('aria-checked', String(k === card));
          k.tabIndex = k === card ? 0 : -1;
        });
        const kind = ATTEMPT_KINDS.find((k) => k.id === card.dataset.kind)!;
        descInput.disabled = kind.id !== 'anders';
        descInput.value = kind.word;
        if (kind.id === 'anders') descInput.focus();
      };
      kinds.forEach((card, i) => {
        card.addEventListener('click', () => pick(card));
        card.addEventListener('keydown', (e) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
          if (!step) return;
          e.preventDefault();
          const next = kinds[(i + step + kinds.length) % kinds.length]!;
          next.focus();
          pick(next);
          next.focus(); // Anders moved it to its field; arrows keep moving through the cards
        });
      });

      wireSpinners(el);

      const structSel = new CustomSelect(el.querySelector('#f-resit-struct-host'), {
        placeholder: '— kies structuur —',
      });
      structSel.setOptions([...STRUCTURE_OPTIONS]);
      structSel.setValue(parent.structureMode ?? 'roman');

      el.querySelector('#f-resit-next')!.addEventListener('click', () => {
        const description = descInput.value.trim();
        if (!description) {
          toast('Vul een beschrijving in.', 'error');
          return;
        }
        const nterm = spinnerValue(el.querySelector<HTMLElement>('#f-resit-nterm'));
        const count = Math.round(spinnerValue(el.querySelector<HTMLElement>('#f-resit-num')));
        if (isNaN(nterm) || count < 1) {
          toast('Vul alle velden in.', 'error');
          return;
        }
        const resitExam: Exam = {
          ...parent,
          id: Store.makeExamId(),
          title: `${parent.title} — ${description}`,
          description,
          attempt: nextAttempt,
          parent_id: parent.id,
          n_term: nterm,
          structureMode: structSel.getValue() ?? parent.structureMode ?? 'roman',
          // F-12: the original's observaties, locked; changed through the original.
          obs_ids: [...(parent.obs_ids ?? [])],
          obs_from_parent: true,
          questions: blankQuestions(count),
        };
        showExamEditor(resitExam, {
          year,
          afterSave: () => void renderToetsen(),
          lockTopFields: true,
          newAttemptOf: parent,
        });
      });
    },
  });
}

export async function openBestGradesOverviewModal(parentId: string, year: string): Promise<void> {
  const bestMap = await Store.computeBestGradeMap(parentId, year);
  // scoreOverride maps studentId → { questionScores, exam, grade }
  // The full entry is passed so openExamOverviewModal can use the pre-computed grade
  // (which was calculated against the correct attempt's exam structure) rather than
  // recalculating against the parent exam structure (which may have different max_points).
  void openExamOverviewModal(parentId, year, bestMap, true);
}

export async function openSummaryEditModal(parentId: string, year: string): Promise<void> {
  const all: Exam[] = await Store.getExams(year);
  const parent = all.find((e) => e.id === parentId);
  if (!parent) return;
  const resits: Exam[] = Store.getResitsSync(parentId, year);

  openModal({
    title: 'Verzamelkaart bewerken',
    key: 'summary-edit',
    subtitle: parent.title,
    size: 'form',
    footerHtml: `
      <button class="btn btn--primary" id="f-sum-save">Opslaan</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: `
    <div class="u-gap-20 u-flex-wrap form-row">
      <div class="u-flex-fill u-min-w-0 u-mb-0 form-group">
        <label for="f-sum-naam">Naam</label>
        <input id="f-sum-naam" type="text" value="${escHtml(parent.title)}" />
      </div>
      ${kindBoxFields({ pta: 'f-sum-pta', diag: 'f-sum-diag' }, { pta: parent.type === 'pta', diag: !!parent.diagnostic })}
      <div class="u-flex-none u-mb-0 form-group">
        <label>Periode</label>
        ${segmented('per-btn', 'per', [1, 2, 3, 4, 5], parent.periode)}
      </div>
    </div>
    <div class="u-gap-20 u-mt-10 form-row">
      ${stepperField('Weging', 'f-sum-weging', { value: parent.weging ?? 1, step: 0.5, min: 0, max: 100 })}
      ${stepperField('Weging SE', 'f-sum-weging-se', { value: parent.weging_se ?? parent.weging ?? 1, step: 0.5, min: 0, max: 100 })}
    </div>
    `,
    onShow: (el: HTMLElement) => {
      wireSpinners(el);
      const ptaBtn = el.querySelector<HTMLElement>('#f-sum-pta')!;
      const diagBtn = el.querySelector<HTMLElement>('#f-sum-diag')!;
      const wegingEl = el.querySelector<HTMLElement>('#f-sum-weging')!;
      const wegingSeEl = el.querySelector<HTMLElement>('#f-sum-weging-se')!;
      wireKindBoxes({ pta: ptaBtn, diag: diagBtn, weging: wegingEl, wegingSe: wegingSeEl });
      wirePeriode(el);

      el.querySelector('#f-sum-save')!.addEventListener('click', async () => {
        const naam = el.querySelector<HTMLInputElement>('#f-sum-naam')!.value.trim();
        if (!naam) {
          toast('Vul een naam in.', 'error');
          return;
        }
        const shared = {
          ...kindFields(isTicked(diagBtn), isTicked(ptaBtn), spinnerValue(wegingEl)),
          periode: el.querySelector<HTMLElement>('.per-btn.selected')?.dataset.per ?? null,
          weging_se: spinnerValue(wegingSeEl),
        };

        await Store.upsertExam({ ...parent, ...shared, title: naam }, year);

        // Each resit: its title from the new name and its own description.
        for (const resit of resits) {
          await Store.upsertExam(
            { ...resit, ...shared, title: `${naam} — ${resit.description ?? ''}` },
            year,
          );
        }

        closeModal();
        toast('Verzamelkaart opgeslagen.', 'success');
        void renderToetsen();
      });
    },
  });
}
