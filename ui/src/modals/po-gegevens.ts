// SPDX-License-Identifier: AGPL-3.0-or-later

// Nieuwe praktische opdracht, step 1 "Gegevens", and PO bewerken (step 22, design spec 4.13,
// board 17; PLAN-2 decisions 16, 22). The Nieuwe toets layout without questions and N-term: the
// last row holds the Rubric (only rubrics of the vak with a shared schoolsoort and the jaarlaag)
// and below it a preview with the categories and the grade formula. Step 2 is po-groepen.ts.

import { closeModal, formSnapshot, guardModalClose, openModal, toast } from '../app.js';
import { esc } from '../components/dialog';
import { field, isTicked } from '../components/form';
import { CustomSelect } from '../custom-select.js';
import {
  gradeFormula,
  matchingRubrics,
  rubricFilterNote,
  rubricOption,
  type PoScope,
} from '../domain/po';
import { checkRubric, type Rubric } from '../domain/rubric';
import type { Exam } from '../domain/types';
import { rubricChip } from '../screens/rubrics';
import { renderToetsen } from '../screens/toetsen';
import { Store } from '../store.js';
import { spinnerValue, wireSpinners } from '../utils/spinners';
import {
  kindBoxFields,
  kindFields,
  LOCKED_TITLE,
  segmented,
  stepperField,
  wireKindBoxes,
  wirePeriode,
} from './exam-fields';
import { showProjectgroepen } from './po-groepen';
import { SCHOOLSOORTEN } from './toets-nieuw';

/** The steps above a new PO; the other step cannot be clicked. */
export function poSteps(active: 'gegevens' | 'groepen') {
  return {
    tabs: [
      { id: 'gegevens', label: '1 · Gegevens', disabled: active !== 'gegevens' },
      { id: 'groepen', label: '2 · Projectgroepen', disabled: active !== 'groepen' },
    ],
    activeTab: active,
  };
}

const RUBRIC_LOCKED = 'Er zijn al scores voor deze PO: de rubric ligt vast.';
const NO_RUBRIC =
  'Er is nog geen passende rubric. Maak er een op het tabblad Rubrics, voor dit vak, deze schoolsoort en deze jaarlaag.';

/** What is locked in the form. */
interface Locks {
  /** An original with a herkansing, or a herkansing: edited through the Verzamelkaart. */
  family: boolean;
  /** Why the rubric cannot change; null when it can. */
  rubric: string | null;
}

/** A new PO before it is saved: what step 1 and step 2 fill in. */
export type PoDraft = Exam & { kind: 'po' };

function vakNaam(subject: string | undefined): string {
  return (Store.SUBJECT_DISPLAY as Record<string, string>)[subject ?? ''] ?? subject ?? '';
}

function formHtml(d: PoDraft, year: string, locks: Locks): string {
  const schoolSS: string[] = Store.getSchoolSync().schoolsoort ?? [];
  const lockAll = locks.family;
  const lockTitle = lockAll ? ` title="${esc(LOCKED_TITLE)}"` : '';
  return `
    <div class="form-row exam-new-row">
      <div class="u-flex-fill u-min-w-0 u-mb-0 form-group"${lockTitle}>
        <label for="po-naam">Naam</label>
        <input id="po-naam" type="text" placeholder="PO Onderzoek valbeweging" value="${esc(d.title ?? '')}"${lockAll ? ' disabled' : ''} />
      </div>
      ${kindBoxFields({ pta: 'po-pta', diag: 'po-diag' }, { pta: d.type === 'pta', diag: !!d.diagnostic }, lockAll)}
      ${field('Schooljaar', `<div class="form-value">${esc(year)}</div>`, { grow: 'none', className: 'u-mb-0 exam-new-year' })}
    </div>
    <div class="form-row exam-new-row">
      <div class="u-flex-none u-mb-0 form-group"${lockTitle}>
        <label>Schoolsoort</label>
        <div class="exam-chips">
          ${SCHOOLSOORTEN.map((ss) => {
            const dis = lockAll || (schoolSS.length > 0 && !schoolSS.includes(ss));
            const on = (d.schoolsoort ?? []).includes(ss);
            return `<button type="button" class="tog-btn ss-btn exam-chip${on ? ' selected' : ''}${dis ? ' tog-btn-disabled' : ''}" data-ss="${esc(ss)}" aria-pressed="${on}"${dis ? ' disabled' : ''}>${esc(ss)}</button>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div class="exam-new-grid">
      <div class="exam-new-jp">
        <div class="u-mb-0 form-group">
          <label>Jaarlaag</label>
          ${segmented('jl-btn', 'jl', [1, 2, 3, 4, 5, 6], d.jaarlaag ?? null, lockAll)}
        </div>
        <div class="u-mb-0 form-group">
          <label>Periode</label>
          ${segmented('per-btn', 'per', [1, 2, 3, 4, 5], d.periode ?? null, lockAll)}
        </div>
      </div>
      ${stepperField('Weging', 'po-weging', { value: d.weging ?? 1, step: 0.5, min: 0, max: 100 }, lockAll)}
      ${stepperField('Weging SE', 'po-weging-se', { value: d.weging_se ?? d.weging ?? 1, step: 0.5, min: 0, max: 100 }, lockAll)}
      <div class="u-min-w-0 u-mb-0 form-group"${locks.rubric ? ` title="${esc(locks.rubric)}"` : ''}>
        <label>Rubric</label>
        <div id="po-rubric-host" class="csel-host"></div>
      </div>
      <p class="po-rubric-note" id="po-rubric-note"></p>
    </div>
    <div class="po-preview" id="po-preview" aria-live="polite"></div>
    <p class="exam-diag-note" id="po-diag-note" hidden>
      <span class="test-badge test-badge--diagnostic">D</span>
      Diagnostische PO: telt niet mee voor rapport of SE. Weging staat op 0.
    </p>`;
}

/** The scope the form shows now. */
function scopeOf(el: HTMLElement, subject: string): PoScope {
  return {
    subject,
    schoolsoort: [...el.querySelectorAll<HTMLElement>('.ss-btn.selected')].map(
      (b) => b.dataset.ss ?? '',
    ),
    jaarlaag: el.querySelector<HTMLElement>('.jl-btn.selected')?.dataset.jl ?? null,
  };
}

interface FormControls {
  read(): PoDraft | null;
}

/**
 * Wires the form: PTA/D, schoolsoort chips, jaarlaag, periode, and the rubric list that follows
 * schoolsoort and jaarlaag. `read` checks the fields and returns the PO, or null after a toast.
 */
function wireForm(el: HTMLElement, base: PoDraft, locks: Locks): FormControls {
  wireSpinners(el);
  const subject = base.subject ?? Store.getActiveSubject();
  const ptaBtn = el.querySelector<HTMLElement>('#po-pta')!;
  const diagBtn = el.querySelector<HTMLElement>('#po-diag')!;
  const wegingEl = el.querySelector<HTMLElement>('#po-weging')!;
  const wegingSeEl = el.querySelector<HTMLElement>('#po-weging-se')!;
  const diagNote = el.querySelector<HTMLElement>('#po-diag-note')!;
  if (!locks.family) {
    wireKindBoxes({
      pta: ptaBtn,
      diag: diagBtn,
      weging: wegingEl,
      wegingSe: wegingSeEl,
      onChange: (diag) => {
        diagNote.hidden = !diag;
      },
    });
  } else {
    diagNote.hidden = !base.diagnostic;
  }
  wirePeriode(el);

  const note = el.querySelector<HTMLElement>('#po-rubric-note')!;
  const preview = el.querySelector<HTMLElement>('#po-preview')!;
  const sel = new CustomSelect(el.querySelector('#po-rubric-host'), {
    placeholder: '— kies een rubric —',
    disabled: !!locks.rubric || locks.family,
  });
  const all = (): Rubric[] => Store.getRubricsSync(subject);
  const current = (): Rubric | undefined => all().find((r) => r.id === sel.getValue());

  const showPreview = () => {
    const r = current();
    if (!r) {
      preview.innerHTML = `<span class="muted">${esc(sel.getValue() ? 'Deze rubric bestaat niet meer.' : 'Kies een rubric om de categorieën en de cijferberekening te zien.')}</span>`;
      return;
    }
    const t = checkRubric(r).totals;
    preview.innerHTML = `<div class="rubric-chips">${r.categories.map(rubricChip).join('')}</div>
      <span class="muted">${esc(gradeFormula(t.normal))}</span>`;
  };

  const refresh = () => {
    const scope = scopeOf(el, subject);
    const fit = matchingRubrics(all(), scope);
    const chosen = sel.getValue();
    // A locked rubric stays listed even when it no longer fits.
    const keep =
      (locks.rubric || locks.family) && chosen ? all().filter((r) => r.id === chosen) : [];
    const list = [...keep, ...fit.filter((r) => r.id !== chosen || !keep.length)];
    sel.setOptions(
      list.map((r) => ({ value: r.id, label: rubricOption(r, checkRubric(r).totals) })),
    );
    if (chosen && list.some((r) => r.id === chosen)) sel.setValue(chosen);
    else sel.setValue(null);
    note.textContent =
      fit.length || keep.length ? rubricFilterNote(scope, vakNaam(subject)) : NO_RUBRIC;
    note.classList.toggle('po-rubric-note--none', !fit.length && !keep.length);
    showPreview();
  };
  sel.setValue(base.rubric_id || null);
  sel.onChange(showPreview);

  el.querySelectorAll<HTMLButtonElement>('.ss-btn:not(:disabled)').forEach((btn) =>
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      btn.setAttribute('aria-pressed', String(btn.classList.contains('selected')));
      refresh();
    }),
  );
  const jlBtns = el.querySelectorAll<HTMLButtonElement>('.jl-btn:not(:disabled)');
  jlBtns.forEach((btn) =>
    btn.addEventListener('click', () => {
      jlBtns.forEach((b) => b.classList.toggle('selected', b === btn));
      refresh();
    }),
  );
  // The list must hold the saved rubric before the first refresh keeps it.
  sel.setOptions(all().map((r) => ({ value: r.id, label: r.naam })));
  sel.setValue(base.rubric_id || null);
  refresh();

  return {
    read() {
      const title = el.querySelector<HTMLInputElement>('#po-naam')!.value.trim();
      const scope = scopeOf(el, subject);
      const rubricId = sel.getValue() ?? '';
      if (!title) {
        toast('Geef de PO een naam.', 'error');
        return null;
      }
      if (!scope.schoolsoort?.length) {
        toast('Selecteer minimaal één schoolsoort.', 'error');
        return null;
      }
      if (!scope.jaarlaag) {
        toast('Selecteer een jaarlaag.', 'error');
        return null;
      }
      if (!rubricId) {
        toast('Kies een rubric.', 'error');
        return null;
      }
      if (locks.family) return { ...base, rubric_id: rubricId };
      return {
        ...base,
        title,
        jaarlaag: scope.jaarlaag ?? undefined,
        schoolsoort: [...(scope.schoolsoort ?? [])],
        periode: el.querySelector<HTMLElement>('.per-btn.selected')?.dataset.per || null,
        weging_se: spinnerValue(wegingSeEl),
        ...kindFields(isTicked(diagBtn), isTicked(ptaBtn), spinnerValue(wegingEl)),
        rubric_id: rubricId,
      };
    },
  };
}

/** A new, empty PO of the active vak. */
function blankPo(): PoDraft {
  return {
    id: Store.makeExamId(),
    kind: 'po',
    title: '',
    subject: Store.getActiveSubject(),
    schoolsoort: [],
    jaarlaag: undefined,
    periode: null,
    weging: 1,
    weging_se: 1,
    type: 'regular',
    diagnostic: false,
    rubric_id: '',
    projectgroepen: [],
    questions: [],
    obs_ids: [],
  };
}

/** "+ PO toevoegen", step 1. `draft` comes back from step 2's "← Gegevens". */
export function openNewPoModal(year: string, draft: PoDraft = blankPo()): void {
  const locks: Locks = { family: false, rubric: null };
  openModal({
    title: 'Nieuwe praktische opdracht',
    size: 'form',
    key: 'exam-edit',
    className: 'dlg--po',
    ...poSteps('gegevens'),
    footerHtml: `
      <button class="btn btn--primary" id="po-next">Verder →</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: formHtml(draft, year, locks),
    onShow: (el: HTMLElement) => {
      const form = wireForm(el, draft, locks);
      const initial = formSnapshot(el);
      // Back from step 2 the draft holds groups: closing loses them too.
      guardModalClose(() => formSnapshot(el) !== initial || !!draft.projectgroepen?.length);
      el.querySelector('#po-next')!.addEventListener('click', () => {
        const po = form.read();
        if (po) showProjectgroepen(po, { mode: 'new', year });
      });
    },
  });
}

/** PO bewerken: the same form, saved at once. Groups have their own dialog (Projectgroepen). */
export async function openPoEditModal(examId: string, year: string): Promise<void> {
  await Store.loadYear(year);
  const all: Exam[] = await Store.getExams(year);
  const found = all.find((e) => e.id === examId);
  if (!found) return;
  const exam = structuredClone(found) as PoDraft;
  const resits: Exam[] = Store.getResitsSync(exam.parent_id ?? exam.id, year);
  const family = !!exam.parent_id || resits.length > 0;
  const family_ids = [exam.parent_id ?? exam.id, ...resits.map((r) => r.id)];
  const scored = (await Promise.all(family_ids.map((id) => Store.examHasScores(id, year)))).some(
    Boolean,
  );
  const locks: Locks = { family, rubric: scored ? RUBRIC_LOCKED : null };

  openModal({
    title: 'PO bewerken',
    subtitle: exam.title,
    size: 'form',
    key: 'exam-edit',
    className: 'dlg--po',
    footerHtml: `
      <button class="btn btn--primary" id="po-save">Opslaan</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body:
      formHtml(exam, year, locks) +
      (family
        ? `<p class="po-family-note">${esc(LOCKED_TITLE.replace('toetseigenschap', 'eigenschap'))} De rubric is die van het origineel.</p>`
        : ''),
    onShow: (el: HTMLElement) => {
      const form = wireForm(el, exam, locks);
      const initial = formSnapshot(el);
      guardModalClose(() => formSnapshot(el) !== initial);
      el.querySelector('#po-save')!.addEventListener('click', async () => {
        const po = form.read();
        if (!po) return;
        await Store.upsertExam(po, year);
        closeModal();
        toast('PO opgeslagen.', 'success');
        void renderToetsen();
      });
    },
  });
}
