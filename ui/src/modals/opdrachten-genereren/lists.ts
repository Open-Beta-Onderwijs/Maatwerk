// SPDX-License-Identifier: AGPL-3.0-or-later

// The lists of the Opdrachten genereren modal: observaties, grade cards and question cards with
// their opdrachten, and the students who get something.

import { escHtml } from '../../app.js';
import { examObsIds, puntenText, vraagLabel } from '../../domain/opdrachten';
import type { Observatie, Opdracht } from '../../domain/types';
import { Store } from '../../store.js';
import { countLabel, fmtOnder, fmtPunten, includedStudents, type OgState } from './state';

const NO_CANDIDATES =
  '<p class="muted og-empty">Geen passende opdrachten. Vink "Toon alle opdrachten" aan of maak een opdracht aan op het tabblad Opdrachten.</p>';

const NOTHING_LINKED =
  '<p class="og-warn">Geen opdracht gekoppeld: deze leerlingen krijgen hiervoor niets.</p>';

/** A list of opdrachten to tick; `data` are the checkbox's data attributes. */
function opdrachtItems(
  state: OgState,
  selected: string[],
  data: string,
  tagsOf: (o: Opdracht) => string[] = () => [],
  order?: (a: Opdracht, b: Opdracht) => number,
): string {
  const { exam } = state;
  const candidates = (Store.getOpdrachtenSync() as Opdracht[])
    .filter((o) => state.showAll || Store.opdrachtMatchesExam(o, exam) || selected.includes(o.id))
    .sort((a, b) => order?.(a, b) || (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'));
  if (!candidates.length) return NO_CANDIDATES;
  return candidates
    .map((o) => {
      const fits = Store.opdrachtMatchesExam(o, exam);
      const tags = [
        ...tagsOf(o),
        fits ? '' : 'past niet bij vak/jaarlaag/schoolsoort van de toets',
      ].filter(Boolean);
      return `
            <label class="checkbox-item og-op-item">
              <input type="checkbox" ${data} data-op="${escHtml(o.id)}" ${selected.includes(o.id) ? 'checked' : ''} />
              <span class="og-op-name">${escHtml(o.naam)}</span>
              ${o.beschrijving ? `<span class="muted">${escHtml(o.beschrijving)}</span>` : ''}
              ${tags.length ? `<span class="og-tag">${escHtml(tags.join(' · '))}</span>` : ''}
            </label>`;
    })
    .join('');
}

/** Don't replace a field the user is typing in (a background refresh). */
function isEditing(list: Element): boolean {
  const active = document.activeElement;
  return (
    !!active && list.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')
  );
}

function renderCijferList(el: HTMLElement, state: OgState): void {
  const list = el.querySelector('.og-cijfer-list')!;
  if (isEditing(list)) return;
  const reasonIcon = Store.cijferCardReason({ onder: 0 }).icon;
  list.innerHTML = state.cijfer
    .map((card) => {
      const selected = card.opdrachten ?? [];
      const nStudents = state.assignments?.cijferStudents?.[card.id]?.length;
      const card_ = escHtml(card.id);
      return `
      <div class="og-obs">
        <div class="og-obs-head">
          <label class="og-obs-name og-cijfer-head">${reasonIcon} Cijfer onder
            <input type="text" inputmode="decimal" class="og-cijfer-input" data-action="og-cijfer-onder"
              data-card="${card_}" value="${fmtOnder(card.onder)}" aria-label="Cijfergrens" />
          </label>
          <span class="muted">${countLabel(nStudents)}</span>
          <button type="button" class="btn btn--text og-cijfer-remove" data-action="og-cijfer-remove"
            data-card="${card_}" title="Verwijder deze cijfergrens" aria-label="Verwijder deze cijfergrens">✕</button>
        </div>
        <div class="og-op-list">${opdrachtItems(state, selected, `data-action="og-couple-cijfer" data-card="${card_}"`)}</div>
        ${nStudents && !selected.length ? NOTHING_LINKED : ''}
      </div>`;
    })
    .join('');
}

/** F-14: "Vraag <select> onder <n> punten" cards. */
function renderVraagList(el: HTMLElement, state: OgState): void {
  const list = el.querySelector('.og-vraag-list')!;
  if (isEditing(list)) return;
  const { exam } = state;
  const questions = exam.questions ?? [];
  list.innerHTML = state.vraag
    .map((card) => {
      const selected = card.opdrachten ?? [];
      const nStudents = state.assignments?.vraagStudents?.[card.id]?.length;
      const card_ = escHtml(card.id);
      const max = questions.find((q) => q.id === card.vraag)?.max_points;
      const options = questions
        .map(
          (q) =>
            `<option value="${escHtml(q.id)}"${q.id === card.vraag ? ' selected' : ''}>${escHtml(vraagLabel(exam, q.id))}</option>`,
        )
        .join('');
      return `
      <div class="og-obs" data-vraag-card="${card_}">
        <div class="og-obs-head">
          <span class="og-obs-name og-cijfer-head">🔢 Vraag
            <select class="og-vraag-select" data-action="og-vraag-vraag" data-card="${card_}" aria-label="Vraag">${options}</select>
            onder
            <input type="text" inputmode="decimal" class="og-cijfer-input" data-action="og-vraag-onder"
              data-card="${card_}" value="${fmtPunten(card.onder)}" aria-label="Puntengrens" />
            punten
            ${max === undefined ? '' : `<span class="muted og-vraag-max">(max. ${escHtml(puntenText(max))}; N telt mee, leeg niet)</span>`}
          </span>
          <span class="muted">${countLabel(nStudents)}</span>
          <button type="button" class="btn btn--text og-cijfer-remove" data-action="og-vraag-remove"
            data-card="${card_}" title="Verwijder deze vraaggrens" aria-label="Verwijder deze vraaggrens">✕</button>
        </div>
        <div class="og-op-list">${opdrachtItems(state, selected, `data-action="og-couple-vraag" data-card="${card_}"`)}</div>
        ${nStudents && !selected.length ? NOTHING_LINKED : ''}
      </div>`;
    })
    .join('');
}

export function renderObsList(el: HTMLElement, state: OgState): void {
  renderCijferList(el, state);
  renderVraagList(el, state);
  const { exam, coupling, assignments } = state;
  const obsById = Object.fromEntries(
    (Store.getObservatiesSync(exam.subject ?? Store.getActiveSubject()) as Observatie[]).map(
      (o) => [o.id, o],
    ),
  );
  // A PO: its general and category observaties (step 23).
  const rows = examObsIds(exam).map((obsId) => {
    const obs = obsById[obsId];
    if (!obs) return '';
    const selected = coupling[obsId] ?? [];
    const nStudents = assignments?.obsStudents?.[obsId]?.length;
    // Opdrachten that list this observatie come first.
    const listed = (o: Opdracht) => (o.observaties ?? []).includes(obsId);
    const items = opdrachtItems(
      state,
      selected,
      `data-action="og-couple" data-obs="${escHtml(obsId)}"`,
      (o) => [listed(o) ? '' : 'niet gekoppeld aan deze observatie'],
      (a, b) => Number(!listed(a)) - Number(!listed(b)),
    );
    return `
      <div class="og-obs">
        <div class="og-obs-head">
          <span class="og-obs-name" title="${escHtml(obs.uitleg ?? '')}">${escHtml(obs.icon)} ${escHtml(obs.naam)}</span>
          <span class="muted">${countLabel(nStudents)}</span>
        </div>
        <div class="og-op-list">${items}</div>
        ${nStudents && !selected.length ? NOTHING_LINKED : ''}
      </div>`;
  });
  el.querySelector('.og-obs-list')!.innerHTML =
    rows.join('') ||
    '<p class="hint">Er zijn geen observaties gekoppeld aan deze toets. Voeg ze toe via "Toets bewerken", of koppel opdrachten aan een cijfer- of vraaggrens hieronder.</p>';
}

export function renderStudentList(el: HTMLElement, state: OgState): void {
  const list = el.querySelector('.og-student-list')!;
  const students = state.assignments?.students ?? [];
  if (!students.length) {
    list.innerHTML =
      '<p class="hint">Geen enkele leerling krijgt een opdracht. Koppel opdrachten aan de observaties, cijfergrenzen of vraaggrenzen hierboven, of geef leerlingen observaties in het scoreoverzicht.</p>';
    renderSummary(el, state);
    return;
  }
  let html = '';
  let lastGroup: string | undefined;
  for (const { student, group, items } of students) {
    const groupName = group?.name ?? 'Zonder groep';
    if (groupName !== lastGroup) {
      html += `<div class="og-group-head">${escHtml(groupName)}</div>`;
      lastGroup = groupName;
    }
    const id = String(student.id);
    const ops = items
      .map(
        ({ opdracht, obs }) =>
          `<span class="og-chip" title="${escHtml(obs.map((o) => o.naam).join(', '))}">${obs
            .map((o) => escHtml(o.icon))
            .join('')} ${escHtml(opdracht.naam)}</span>`,
      )
      .join('');
    html += `
      <label class="og-student">
        <input type="checkbox" data-action="og-student" data-id="${escHtml(id)}"
          ${state.excluded.has(id) ? '' : 'checked'} />
        <span class="og-student-name">${escHtml(Store.fullName(student))}</span>
        <span class="og-chips">${ops}</span>
      </label>`;
  }
  list.innerHTML = html;
  renderSummary(el, state);
}

export function renderSummary(el: HTMLElement, state: OgState): void {
  const included = includedStudents(state);
  const nOps = included.reduce((sum, e) => sum + e.items.length, 0);
  el.querySelector('.og-summary')!.textContent =
    `${included.length} ${included.length === 1 ? 'leerling' : 'leerlingen'} · ` +
    `${nOps} ${nOps === 1 ? 'opdracht' : 'opdrachten'}`;
  el.querySelector<HTMLButtonElement>('[data-action="og-generate"]')!.disabled =
    state.busy || nOps === 0;
  el.querySelector<HTMLButtonElement>('[data-action="og-key"]')!.disabled =
    state.busy || nOps === 0;
}
