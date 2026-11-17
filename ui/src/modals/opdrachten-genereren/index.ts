// SPDX-License-Identifier: AGPL-3.0-or-later

// MODAL: Opdrachten genereren (opened from an exam card on the Toetsen screen).
//
// Couples the exam's observaties to opdrachten (exam.opdrachten), and grade cards "Cijfer onder …"
// (exam.opdrachtenCijfer) and question cards "Vraag … onder … punten" (exam.opdrachtenVraag,
// F-14) too, shows which students receive which opdracht and compiles them into one PDF: one
// block per student, ordered by group and name, each starting on an odd page.

import {
  changedByName,
  closeModal,
  onModalCleanup,
  onModalSync,
  openModal,
  showReloadNotice,
  toast,
} from '../../app.js';
import { round1 } from '../../domain/core';
import { parseDecimal } from '../../domain/format';
import type { Exam, VraagCard } from '../../domain/types';
import { Store } from '../../store.js';
import { printOutput } from '../rapport';
import { generate } from './generate';
import { renderObsList, renderStudentList, renderSummary } from './lists';
import { couplingJson, fmtOnder, fmtPunten, type OgState } from './state';

interface SyncEvent {
  id?: string;
  year?: string;
  subject?: string;
  after?: unknown;
}

export async function openOpdrachtenGenererenModal(examId: string, year: string): Promise<void> {
  const exam = (Store.getExamsSync(year) as Exam[]).find((e) => e.id === examId);
  if (!exam) return;
  const subject = exam.subject ?? Store.getActiveSubject();
  await Promise.all([Store.getOpdrachten(), Store.getObservaties(subject)]);

  const state: OgState = {
    exam,
    coupling: Store.getOpdrachtCoupling(exam),
    cijfer: Store.getOpdrachtCijferCards(exam),
    vraag: Store.getOpdrachtVraagCards(exam),
    savedJson: '',
    showAll: false,
    excluded: new Set(),
    includeAnswers: true,
    assignments: null,
    busy: false,
  };
  state.savedJson = couplingJson(state);
  const hasQuestions = !!exam.questions?.length;

  openModal({
    key: 'opdrachten-genereren',
    title: 'Opdrachten genereren',
    subtitle: exam.title,
    className: 'modal-pdf',
    fixedHeight: true,
    // The settings view has its own footer row (it switches with the result view).
    body: `
     <div class="og-root">
     <div class="og-settings">
       <div class="og-scroll">
         <div class="og-section-head">
           <h4>Observaties, cijfers en vragen koppelen aan opdrachten</h4>
           <label class="og-inline-check">
             <input type="checkbox" data-action="og-show-all" /> Toon alle opdrachten
           </label>
         </div>
         <div class="og-obs-list"></div>
         <div class="og-cijfer-list"></div>
         <div class="og-vraag-list"></div>
         <div class="og-card-add">
           <button type="button" class="btn btn--secondary btn--sm" data-action="og-cijfer-add">
             + Cijfer onder … toevoegen
           </button>
           ${
             hasQuestions
               ? `<button type="button" class="btn btn--secondary btn--sm" data-action="og-vraag-add">
             + Vraag onder … punten toevoegen
           </button>`
               : ''
           }
         </div>
         <div class="og-section-head">
           <h4>Leerlingen</h4>
           <span class="og-student-toggles">
             <button type="button" class="btn btn--text" data-action="og-all-on">Alles aan</button> ·
             <button type="button" class="btn btn--text" data-action="og-all-off">Alles uit</button>
           </span>
         </div>
         <div class="og-student-list"><div class="rapport-spinner">Leerlingen worden geladen…</div></div>
       </div>
       <div class="og-footer">
         <label class="og-inline-check">
           <input type="checkbox" data-action="og-answers" checked /> Antwoorden meegeven
         </label>
         <span class="og-summary muted"></span>
         <button type="button" class="btn btn--secondary" data-action="og-key">Antwoordsleutel</button>
         <button type="button" class="btn btn--primary" data-action="og-generate">Genereren</button>
       </div>
     </div>
     <div class="og-result" hidden>
       <div class="og-result-bar">
         <button type="button" class="btn btn--secondary btn--sm" data-action="og-back">← Terug naar koppelingen</button>
       </div>
       <div class="rapport-modal-content og-result-content"></div>
     </div>
     </div>`,
    // Everything works on .og-root; it leaves the DOM when the dialog closes.
    onShow: (el: HTMLElement) => initModal(el.querySelector<HTMLElement>('.og-root')!, state, year),
    onClose: () => saveCoupling(state, year),
  });
}

// ── Recomputing and saving ────────────────────────────────────────────────────

// Recompute who gets what (after a coupling change or a background change).
let recomputeSeq = 0;
async function recompute(el: HTMLElement, state: OgState, year: string): Promise<void> {
  const seq = ++recomputeSeq;
  const assignments = await Store.getOpdrachtAssignments(
    state.exam,
    year,
    state.coupling,
    state.cijfer,
    state.vraag,
  );
  if (seq !== recomputeSeq || !el.isConnected) return;
  state.assignments = assignments;
  renderObsList(el, state);
  renderStudentList(el, state);
}

async function saveCoupling(state: OgState, year: string): Promise<void> {
  const json = couplingJson(state);
  if (json === state.savedJson) return;
  try {
    state.exam = await Store.setExamOpdrachten(
      state.exam.id,
      state.coupling,
      year,
      state.exam.subject,
      state.cijfer,
      state.vraag,
    );
    state.savedJson = json;
  } catch (e) {
    toast(`Koppeling kon niet worden opgeslagen: ${(e as Error).message}`, 'error');
  }
}

/** A new question card: the first question, below half its points (rounded up). */
function newVraagCard(exam: Exam): VraagCard {
  const q = exam.questions[0]!;
  return {
    id: `vraag-${Date.now()}`,
    vraag: q.id,
    onder: Math.max(1, Math.ceil(q.max_points / 2)),
    opdrachten: [],
  };
}

/** Ticks or unticks `op` in `list`. */
const toggled = (list: string[] | undefined, op: string, on: boolean): string[] => [
  ...(list ?? []).filter((id) => id !== op),
  ...(on ? [op] : []),
];

// ── Wiring ────────────────────────────────────────────────────────────────────

function onChange(el: HTMLElement, state: OgState, year: string, t: HTMLInputElement): void {
  const cijferCard = () => state.cijfer.find((c) => c.id === t.dataset.card);
  const vraagCard = () => state.vraag.find((c) => c.id === t.dataset.card);
  switch (t.dataset.action) {
    case 'og-show-all':
      state.showAll = t.checked;
      renderObsList(el, state);
      break;
    case 'og-answers':
      state.includeAnswers = t.checked;
      break;
    case 'og-couple': {
      const obs = t.dataset.obs!;
      state.coupling[obs] = toggled(state.coupling[obs], t.dataset.op!, t.checked);
      void recompute(el, state, year);
      break;
    }
    case 'og-couple-cijfer':
    case 'og-couple-vraag': {
      const card = t.dataset.action === 'og-couple-cijfer' ? cijferCard() : vraagCard();
      if (!card) break;
      card.opdrachten = toggled(card.opdrachten, t.dataset.op!, t.checked);
      void recompute(el, state, year);
      break;
    }
    case 'og-cijfer-onder': {
      const card = cijferCard();
      if (!card) break;
      const n = parseDecimal(t.value);
      if (t.value.trim() === '' || isNaN(n) || n <= 1 || n > 10) {
        toast('Vul een cijfergrens in tussen 1,0 en 10,0.', 'error');
        t.value = fmtOnder(card.onder);
        break;
      }
      card.onder = round1(n);
      t.value = fmtOnder(card.onder);
      t.blur(); // lets the refresh re-render the card
      void recompute(el, state, year);
      break;
    }
    case 'og-vraag-vraag': {
      const card = vraagCard();
      if (!card) break;
      card.vraag = t.value;
      t.blur();
      void recompute(el, state, year);
      break;
    }
    case 'og-vraag-onder': {
      const card = vraagCard();
      if (!card) break;
      const n = parseDecimal(t.value);
      // Above 0 (nothing is below 0 points); at most a point above the question's maximum.
      if (t.value.trim() === '' || isNaN(n) || n <= 0 || n > 1000) {
        toast('Vul een puntengrens in groter dan 0.', 'error');
        t.value = fmtPunten(card.onder);
        break;
      }
      card.onder = Math.round(n * 100) / 100;
      t.value = fmtPunten(card.onder);
      t.blur();
      void recompute(el, state, year);
      break;
    }
    case 'og-student':
      if (t.checked) state.excluded.delete(t.dataset.id!);
      else state.excluded.add(t.dataset.id!);
      renderSummary(el, state);
      break;
  }
}

function onClick(el: HTMLElement, state: OgState, year: string, target: HTMLElement): void {
  const actionEl = target.closest<HTMLElement>('[data-action]');
  const action = actionEl?.dataset.action;
  const save = () => saveCoupling(state, year);
  switch (action) {
    case 'og-generate':
      void generate(el, state, year, 'student', save);
      break;
    case 'og-key':
      void generate(el, state, year, 'key', save);
      break;
    case 'og-cijfer-add':
      state.cijfer.push({ id: `cijfer-${Date.now()}`, onder: 5.5, opdrachten: [] });
      renderObsList(el, state);
      void recompute(el, state, year);
      break;
    case 'og-vraag-add':
      state.vraag.push(newVraagCard(state.exam));
      renderObsList(el, state);
      void recompute(el, state, year);
      break;
    case 'og-cijfer-remove':
      state.cijfer = state.cijfer.filter((c) => c.id !== actionEl!.dataset.card);
      renderObsList(el, state);
      void recompute(el, state, year);
      break;
    case 'og-vraag-remove':
      state.vraag = state.vraag.filter((c) => c.id !== actionEl!.dataset.card);
      renderObsList(el, state);
      void recompute(el, state, year);
      break;
    case 'og-back':
      el.querySelector<HTMLElement>('.og-result')!.hidden = true;
      el.querySelector<HTMLElement>('.og-settings')!.hidden = false;
      el.querySelector('.og-result-content')!.innerHTML = '';
      break;
    case 'og-all-on':
    case 'og-all-off':
      for (const { student } of state.assignments?.students ?? []) {
        if (action === 'og-all-on') state.excluded.delete(String(student.id));
        else state.excluded.add(String(student.id));
      }
      renderStudentList(el, state);
      break;
  }
}

function initModal(el: HTMLElement, state: OgState, year: string): void {
  const { exam } = state;
  const subject = exam.subject ?? Store.getActiveSubject();

  el.addEventListener('change', (e) => onChange(el, state, year, e.target as HTMLInputElement));
  el.addEventListener('click', (e) => onClick(el, state, year, e.target as HTMLElement));

  // The PDF viewer's "Afdrukken" button: a named copy in rapporten/<schooljaar>/,
  // opened in the system viewer (ADR-0002 section 9).
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type === 'print-pdf' && state.printPath)
      void printOutput(state.printPath, state.printName);
  };
  window.addEventListener('message', onMessage);
  onModalCleanup(() => window.removeEventListener('message', onMessage));

  // Background changes by colleagues. Scores, groups, students and opdrachten only
  // change who gets what: recompute silently. A change to this exam reloads.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void recompute(el, state, year), 400);
  };
  onModalCleanup(() => clearTimeout(timer));
  onModalSync('scores', (ev: SyncEvent) => {
    if (ev.year === year && ev.subject === subject) refresh();
  });
  onModalSync('students', (ev: SyncEvent) => {
    if (ev.year === year) refresh();
  });
  onModalSync('group', (ev: SyncEvent) => {
    if (ev.year === year) refresh();
  });
  onModalSync('opdracht', refresh);
  onModalSync('observatie', refresh);
  onModalSync('exam', async (ev: SyncEvent) => {
    if (ev.id !== exam.id || ev.year !== year) return;
    const who = await changedByName(ev);
    if (!ev.after) {
      state.savedJson = couplingJson(state); // nothing left to save to
      showReloadNotice(`Deze toets is verwijderd door ${who}.`, closeModal);
      return;
    }
    // Keep our unsaved coupling choices; the reopened modal starts from the
    // exam as it is now.
    showReloadNotice(
      `Deze toets is gewijzigd door ${who}. Het venster wordt opnieuw geladen.`,
      async () => {
        await saveCoupling(state, year);
        void openOpdrachtenGenererenModal(exam.id, year);
      },
    );
  });

  renderObsList(el, state);
  void recompute(el, state, year);
}
