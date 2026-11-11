// SPDX-License-Identifier: AGPL-3.0-or-later

// Toets bewerken and the question step of a new test or attempt (design spec
// 4.11): one top row, the question table with a sticky heading, the observaties
// and the totals in the footer.

import {
  changedByName,
  closeModal,
  confirmDialog,
  escHtml,
  formSnapshot,
  guardModalClose,
  onModalSync,
  openModal,
  SEL,
  showReloadNotice,
  toast,
} from '../app.js';
import { isTicked } from '../components/form';
import { attemptCode, questionSummary, resitObsIds } from '../domain/exam-info';
import { formatNTerm } from '../domain/format';
import { nextQuestionId } from '../domain/ids';
import { isPo } from '../domain/po';
import { obsHasToetstype } from '../domain/rubric';
import {
  cascadeStructure,
  extractBoundaries,
  guessStructureMode,
  type NumberedQuestion,
  questionLabel,
  secIndexOf,
  sectionLabels,
} from '../domain/question-structure';
import { testBadgeClass } from '../domain/test-type';
import type { Exam, QuestionKind, Rtti } from '../domain/types';
import { renderToetsen } from '../screens/toetsen';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import { spinnerValue, wireSpinners } from '../utils/spinners';
import {
  kindBoxFields,
  kindFields,
  lockedObsBlock,
  segmented,
  showLockedWegingSe,
  stepperField,
  wireKindBoxes,
  wirePeriode,
} from './exam-fields';
import { examSteps, openNewExamModal } from './toets-nieuw';

interface Observatie {
  id: string;
  naam?: string;
  icon?: string;
  jaarlagen?: unknown[];
  schoolsoort?: string[];
  toetstypes?: unknown;
}

export async function openExamModal(
  existingId: string | null,
  afterSave: (() => void) | null = null,
): Promise<void> {
  const cfg = await Store.getConfig();
  const year: string = SEL.toetsenYear.getValue() || cfg.activeYear;
  await Store.loadYear(year);

  if (!existingId) {
    openNewExamModal(year, afterSave);
    return;
  }

  const all: Exam[] = await Store.getExams(year);
  const exam: Exam = JSON.parse(JSON.stringify(all.find((e) => e.id === existingId)));
  exam.structureMode ??= guessStructureMode(
    (exam.questions[0] as NumberedQuestion | undefined)?.section,
  );
  const hasScores: boolean = await Store.examHasScores(exam.id, year);
  const resits: Exam[] = Store.getResitsSync(exam.id, year);
  // Removing an observatie from the original also removes it from its attempts' scores.
  const attemptsHaveScores =
    hasScores ||
    (await Promise.all(resits.map((r) => Store.examHasScores(r.id, year)))).some(Boolean);
  showExamEditor(exam, {
    year,
    afterSave,
    isEdit: true,
    hasScores,
    attemptsHaveScores,
    // Edited through the summary card, for every attempt at once.
    lockTopFields: !!exam.parent_id || resits.length > 0,
  });
}

export interface ExamEditorOptions {
  year: string;
  afterSave?: (() => void) | null;
  /** An existing exam; otherwise the last step of creating one. */
  isEdit?: boolean;
  hasScores?: boolean;
  /** This exam or one of its attempts has scores. */
  attemptsHaveScores?: boolean;
  lockTopFields?: boolean;
  /** Creating an attempt of this original. */
  newAttemptOf?: Exam;
}

function badgeHtml(e: Exam): string {
  return `<span class="${testBadgeClass(e)}">${escHtml(attemptCode(e))}</span>`;
}

/** Options of a question's row buttons: the row is one line (spec 4.11). */
function questionRow(q: NumberedQuestion, i: number, mode: string, hasScores: boolean): string {
  const sec = secIndexOf(q, mode);
  const seq = mode === 'seq';
  const secBtns = sectionLabels(mode)
    .map((label, si) => {
      const selected = sec === si + 1 && !seq;
      const locked = i === 0 || seq;
      return `<button type="button" class="sec-btn${selected ? ' selected' : ''}${locked ? ' locked' : ''}${seq ? ' sec-btn-inactive' : ''}" data-qi="${i}" data-sec="${si + 1}"${seq ? ' disabled' : ''}>${seq ? '' : escHtml(label)}</button>`;
    })
    .join('');
  const ptsBtns = Array.from(
    { length: 11 },
    (_, n) =>
      `<button type="button" class="tog-btn pts-btn${q.max_points === n ? ' selected' : ''}" data-qi="${i}" data-pts="${n}">${n}</button>`,
  ).join('');
  const kind = q.kind ?? 'normal';
  const kindOpt = (value: QuestionKind, label: string) =>
    `<option value="${value}"${kind === value ? ' selected' : ''}>${label}</option>`;
  const rttiBtns = (['R', 'T1', 'T2', 'I'] as const)
    .map(
      (cat) =>
        `<button type="button" class="tog-btn rtti-btn${q.rtti === cat ? ' selected' : ''}" data-qi="${i}" data-rtti="${cat}">${cat}</button>`,
    )
    .join('');
  const del = hasScores
    ? ' disabled title="Er zijn scores ingevoerd voor deze toets, bestaande vragen kunnen dus niet worden verwijderd."'
    : ' title="Vraag verwijderen"';
  return `
    <tr data-qi="${i}">
      <td><div class="sec-btn-group">${secBtns}</div></td>
      <td><span class="qi-nr-display">${escHtml(questionLabel(q, mode))}</span></td>
      <td><div class="btn-toggle-group">${ptsBtns}</div></td>
      <td>
        <select class="kind-sel" data-qi="${i}" aria-label="Soort vraag">
          ${kindOpt('normal', 'Normaal')}${kindOpt('bonus', 'Bonus')}${kindOpt('diag', 'Diagnostisch')}
        </select>
      </td>
      <td><div class="btn-toggle-group">${rttiBtns}</div></td>
      <td><button type="button" class="btn btn--icon btn--icon-danger qi-del" data-qi="${i}" aria-label="Vraag verwijderen"${del}>${ICONS.trash}</button></td>
    </tr>`;
}

export function showExamEditor(exam: Exam, opts: ExamEditorOptions): void {
  const {
    year: toetsYear,
    afterSave = null,
    isEdit = false,
    hasScores = false,
    attemptsHaveScores = hasScores,
    lockTopFields = false,
    newAttemptOf,
  } = opts;
  const mode = exam.structureMode ?? 'roman';
  const questions = exam.questions as NumberedQuestion[];
  // Ids the exam had when the editor opened: a colleague may enter scores for them meanwhile,
  // so a deleted id is never handed out again (review 10 m4).
  const openedIds = questions.map((q) => ({ id: q.id }));
  const boundaries = extractBoundaries(questions, mode);
  cascadeStructure(questions, boundaries, mode);

  // An attempt's observaties are its original's (F-12): shown, not chosen.
  const obsLocked = !!exam.parent_id;
  const obsBefore = [...(exam.obs_ids ?? [])];
  const allObs: Observatie[] = Store.getObservatiesSync();
  const availableObs = obsLocked
    ? []
    : allObs
        .filter((o) => {
          // Tests offer only observaties of toetstype Toets (F-23, decision 23).
          if (!obsHasToetstype(o, 'toets')) return false;
          if (!(o.jaarlagen ?? []).map(String).includes(String(exam.jaarlaag))) return false;
          const obsSS = o.schoolsoort ?? [];
          if (obsSS.length === 0) return true;
          return (exam.schoolsoort ?? []).some((ss) => obsSS.includes(ss));
        })
        .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));

  const context = `Jaarlaag ${exam.jaarlaag} · ${(exam.schoolsoort ?? []).join(' / ') || '—'} · ${toetsYear}`;
  const isPta = exam.type === 'pta';
  const isDiag = !!exam.diagnostic;
  const weging = exam.weging ?? 1;
  const wegingSe = exam.weging_se ?? exam.weging ?? 1;

  const heading = isEdit
    ? {
        title: exam.title,
        leadHtml: exam.volgnummer ? badgeHtml(exam) : '',
        subtitle: `Toets bewerken · ${context}`,
      }
    : newAttemptOf
      ? {
          title: 'Nieuwe poging',
          subtitleHtml: `van ${badgeHtml(newAttemptOf)} ${escHtml(newAttemptOf.title)}`,
        }
      : { title: 'Nieuwe toets', subtitle: context, ...examSteps('vragen') };

  const obsSection = obsLocked
    ? lockedObsBlock(exam.obs_ids)
    : availableObs.length > 0
      ? `
      <div class="exam-edit-obs">
        <span class="exam-section-label">Observaties bij deze toets</span>
        <div id="f-obs-group" class="exam-obs-chips">
          ${availableObs
            .map(
              (o) =>
                `<button type="button" class="tog-btn exam-obs-chip obs-sel-btn${obsBefore.includes(o.id) ? ' selected' : ''}" data-obs-id="${escHtml(o.id)}" aria-pressed="${obsBefore.includes(o.id)}"><span aria-hidden="true">${escHtml(o.icon)}</span>${escHtml(o.naam)}</button>`,
            )
            .join('')}
        </div>
      </div>`
      : '';

  openModal({
    ...heading,
    className: 'dlg--exam-edit',
    fixedHeight: true,
    key: 'exam-edit',
    bodyClass: 'exam-edit-body',
    footerHtml: `
      <span class="exam-edit-summary" id="f-exam-summary"></span>
      <button class="btn btn--primary" id="f-esave">Opslaan</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: `
    <div class="form-row exam-edit-top">
      <div class="exam-edit-name u-mb-0 form-group">
        <label for="f-etitle2">Naam</label>
        <input id="f-etitle2" type="text" value="${escHtml(exam.title)}" />
      </div>
      ${kindBoxFields({ pta: 'f-epta-btn', diag: 'f-ediag-btn' }, { pta: isPta, diag: isDiag }, lockTopFields)}
      <div class="u-flex-none u-mb-0 form-group">
        <label>Periode</label>
        ${segmented('per-btn', 'per', [1, 2, 3, 4, 5], exam.periode, lockTopFields)}
      </div>
      ${stepperField('Weging', 'f-eweging2', { value: weging, step: 0.5, min: 0, max: 100 }, lockTopFields)}
      ${stepperField('Weging SE', 'f-eweging-se2', { value: wegingSe, step: 0.5, min: 0, max: 100 }, lockTopFields)}
      ${stepperField('N-term', 'f-enterm2', { value: exam.n_term ?? 1, shown: formatNTerm(exam.n_term ?? 1), step: 0.1, min: 0, max: 3 })}
    </div>
    <div class="questions-scroll">
      <table class="questions-table">
        <thead><tr>
          <th>Opgave</th>
          <th>Vr.</th>
          <th>Max punten</th>
          <th>B / D</th>
          <th>RTTI</th>
          <th aria-label="Verwijderen"></th>
        </tr></thead>
        <tbody id="f-qbody"></tbody>
      </table>
      <button type="button" class="btn btn--secondary exam-add-q" id="f-addq">+ Vraag toevoegen</button>
    </div>
    ${obsSection}
    `,
    onShow: (el: HTMLElement) => {
      // Someone else changed or removed this exam while it is being edited
      // (saving would be refused anyway, so reload with their version).
      if (isEdit) {
        onModalSync('exam', async (ev: { id: string; year: string; after: unknown }) => {
          if (ev.id !== exam.id || ev.year !== toetsYear) return;
          const who = await changedByName(ev);
          if (!ev.after) {
            showReloadNotice(`Deze toets is verwijderd door een collega.`, () => {
              closeModal();
              void renderToetsen();
            });
          } else {
            showReloadNotice(
              `Deze toets is gewijzigd door ${who}. Het venster wordt opnieuw geladen.`,
              () => openExamModal(exam.id, afterSave),
            );
          }
        });
      }

      const tbody = el.querySelector<HTMLElement>('#f-qbody')!;
      const summary = el.querySelector<HTMLElement>('#f-exam-summary')!;
      const refreshSummary = () => {
        summary.textContent = questionSummary(questions);
      };

      wireSpinners(el);
      const ptaBtn = el.querySelector<HTMLElement>('#f-epta-btn')!;
      const diagBtn = el.querySelector<HTMLElement>('#f-ediag-btn')!;
      const wegingEl = el.querySelector<HTMLElement>('#f-eweging2')!;
      const wegingSeEl = el.querySelector<HTMLElement>('#f-eweging-se2')!;
      if (lockTopFields) {
        showLockedWegingSe(wegingSeEl, isPta);
      } else {
        wireKindBoxes({ pta: ptaBtn, diag: diagBtn, weging: wegingEl, wegingSe: wegingSeEl });
        wirePeriode(el);
      }

      function renderQRows() {
        cascadeStructure(questions, boundaries, mode);
        tbody.innerHTML = questions.map((q, i) => questionRow(q, i, mode, hasScores)).join('');
        refreshSummary();
      }

      const select = (btn: Element, cls: string) =>
        btn
          .closest('.btn-toggle-group')
          ?.querySelectorAll(cls)
          .forEach((b) => b.classList.toggle('selected', b === btn));

      tbody.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const btn = target.closest<HTMLElement>('.sec-btn, .pts-btn, .rtti-btn, .qi-del');
        if (!btn || (btn as HTMLButtonElement).disabled) return;
        const i = Number(btn.dataset.qi);
        const q = questions[i];
        if (!q) return;
        if (btn.matches('.sec-btn')) {
          if (i === 0) return;
          boundaries[i] = Number(btn.dataset.sec);
          renderQRows();
        } else if (btn.matches('.pts-btn')) {
          q.max_points = Number(btn.dataset.pts);
          select(btn, '.pts-btn');
          refreshSummary();
        } else if (btn.matches('.rtti-btn')) {
          q.rtti = btn.dataset.rtti as Rtti;
          select(btn, '.rtti-btn');
          refreshSummary();
        } else {
          questions.splice(i, 1);
          boundaries.splice(i, 1);
          if (boundaries.length > 0) boundaries[0] = 1;
          renderQRows();
        }
      });

      tbody.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        const q = questions[Number(target.dataset.qi)];
        if (target.matches('.kind-sel') && q) {
          q.kind = target.value as QuestionKind;
          refreshSummary();
        }
      });

      const deselectedObs = new Set<string>();
      const hasAttempts = isEdit && !exam.parent_id && Store.examHasResits(exam.id, toetsYear);
      el.querySelectorAll<HTMLElement>('.obs-sel-btn').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const obsId = btn.dataset.obsId ?? '';
          if (attemptsHaveScores) {
            if (btn.classList.contains('selected')) {
              const where = hasAttempts ? 'deze toets en al zijn pogingen' : 'deze toets';
              const ok = await confirmDialog(
                `Weet je zeker dat je deze observatie wilt verwijderen uit de toets? Alle geregistreerde indicaties van deze observatie voor ${where} worden verwijderd.`,
                { okLabel: 'Verwijderen', danger: true },
              );
              if (!ok) return;
              deselectedObs.add(obsId);
            } else {
              const ok = await confirmDialog(
                'Er zijn al scores ingevoerd voor deze toets. Een toegevoegde observatie kan achteraf niet meer worden verwijderd. Wil je doorgaan?',
                { okLabel: 'Doorgaan' },
              );
              if (!ok) return;
              deselectedObs.delete(obsId);
            }
          }
          const on = btn.classList.toggle('selected');
          btn.setAttribute('aria-pressed', String(on));
        }),
      );

      el.querySelector('#f-addq')!.addEventListener('click', async () => {
        if (
          hasScores &&
          !(await confirmDialog(
            'Er zijn al scores ingevoerd voor deze toets. Een toegevoegde vraag kan achteraf niet meer worden verwijderd. Wil je doorgaan?',
            { okLabel: 'Doorgaan' },
          ))
        )
          return;
        const last = questions[questions.length - 1];
        questions.push({
          id: nextQuestionId([...questions, ...openedIds]),
          section: last?.section ?? 'I',
          number: Number(last?.number ?? 0) + 1,
          max_points: last?.max_points ?? 2,
          rtti: 'T1',
        });
        boundaries.push(null);
        renderQRows();
      });

      el.querySelector('#f-esave')!.addEventListener('click', async () => {
        cascadeStructure(questions, boundaries, mode);
        const title = el.querySelector<HTMLInputElement>('#f-etitle2')!.value.trim();
        const nterm = spinnerValue(el.querySelector<HTMLElement>('#f-enterm2'));
        if (!title || isNaN(nterm) || questions.length === 0) {
          toast('Vul alle velden in en zorg voor minstens één vraag.', 'error');
          return;
        }
        // Locked top fields come from the exam itself, not from the form.
        const top = lockTopFields
          ? {
              ...kindFields(isDiag, isPta, weging),
              weging_se: wegingSe,
              periode: exam.periode ?? null,
            }
          : {
              ...kindFields(isTicked(diagBtn), isTicked(ptaBtn), spinnerValue(wegingEl)),
              weging_se: spinnerValue(wegingSeEl),
              periode: el.querySelector<HTMLElement>('.per-btn.selected')?.dataset.per || null,
            };
        const offered = new Set(availableObs.map((o) => o.id));
        const obs_ids = obsLocked
          ? obsBefore
          : [
              ...[...el.querySelectorAll<HTMLElement>('.obs-sel-btn.selected')].map(
                (b) => b.dataset.obsId ?? '',
              ),
              // Not on offer here (another jaarlaag since): not the teacher's choice to drop (T33).
              ...obsBefore.filter((id) => !offered.has(id)),
            ];
        const resits: Exam[] = hasAttempts ? Store.getResitsSync(exam.id, toetsYear) : [];
        // The attempts first: the original still holds the old list if this fails halfway, so
        // saving again from this editor reaches them too (resitObsIds can be repeated). After a
        // refusal an observatie it gained can stay on an attempt: add and remove it on the
        // original to clear it (review 20 m2).
        for (const r of resits) {
          const next = resitObsIds(r.obs_ids ?? [], obsBefore, obs_ids);
          if (JSON.stringify(next) !== JSON.stringify(r.obs_ids ?? [])) {
            await Store.upsertExam({ ...r, obs_ids: next, obs_from_parent: true }, toetsYear);
          }
        }
        await Store.upsertExam(
          {
            ...exam,
            title,
            n_term: nterm,
            structureMode: mode,
            obs_ids,
            ...top,
          },
          toetsYear,
        );
        // Last: it cannot be undone, and a refused save above must not have cost any indication
        // (review 20 M2). Only what the exam had: ticked on and off again changes nothing (m1).
        for (const obsId of deselectedObs) {
          if (!obsBefore.includes(obsId)) continue;
          for (const e of [exam, ...resits]) {
            await Store.removeObsFromExamScores(obsId, e.id, toetsYear);
          }
        }
        closeModal();
        toast('Toets opgeslagen.', 'success');
        if (afterSave) afterSave();
        else void renderToetsen();
      });
      renderQRows();

      // A new exam (step 2) is unsaved as a whole; an existing one once its form changed.
      const initialForm = formSnapshot(el);
      guardModalClose(() => !isEdit || formSnapshot(el) !== initialForm);
    },
  });
}

export async function deleteExam(id: string): Promise<void> {
  const toetsYear: string = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
  if (Store.examHasResits(id, toetsYear)) {
    toast('Er zijn herkansingen gekoppeld aan deze toets. Verwijder die eerst.', 'error');
    return;
  }
  if (await Store.examHasScores(id, toetsYear)) {
    toast(
      'Er zijn scores ingevoerd voor deze toets, de toets kan dus niet worden verwijderd.',
      'error',
    );
    return;
  }
  // A PO says PO (review 22 n3).
  const what = isPo(Store.getExamsSync(toetsYear).find((e: Exam) => e.id === id)) ? 'PO' : 'Toets';
  if (!(await confirmDialog(`${what} verwijderen?`, { okLabel: 'Verwijderen', danger: true })))
    return;
  await Store.deleteExam(id, toetsYear);
  toast(`${what} verwijderd.`, 'info');
  void renderToetsen();
}
