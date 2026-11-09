// SPDX-License-Identifier: AGPL-3.0-or-later

// The cards of the Toetsen screen (design spec 4.7, V-11): an exam card with
// badge, title, kind pill, meta, points and stats; a test with resits gets a
// toggle and its attempts on a tree line, open by default.

import { skelLine } from '../components/skeleton';
import { esc } from '../components/dialog';
import { attemptCode, attemptLabel, metaLine, pointsLine } from '../domain/exam-info';
import { testBadgeClass, testKind, testKindLabel } from '../domain/test-type';
import type { Exam } from '../domain/types';
import { ICONS } from '../utils/icons.js';

/** Which card a ⋮ menu belongs to: no resits, the card above the tree, or one attempt. */
export type CardKind = 'solo' | 'summary' | 'attempt';

const SUB_LETTER: Record<string, string> = { wisa: 'A', wisb: 'B', wisc: 'C', wisd: 'D' };

const CHEVRON =
  '<svg class="exam-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

const LOCK =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

const LOCK_TITLE =
  'Observaties worden bij het aanmaken overgenomen van het origineel en kunnen niet los worden gewijzigd';

/** Wiskunde A/B/C/D before the code, from jaarlaag 4 on. */
function subBadge(e: Exam): string {
  const letter = e.subject === 'wi' ? SUB_LETTER[e.subcategory ?? ''] : undefined;
  if (!letter || parseInt(String(e.jaarlaag), 10) < 4) return '';
  return `<span class="test-badge test-badge--sub">${letter}</span>`;
}

function badge(e: Exam): string {
  const code = attemptCode(e);
  return code ? `<span class="${testBadgeClass(e)}">${esc(code)}</span>` : '';
}

/** The stats line, filled in when the scores are read; a placeholder keeps the card's height. */
function statsSlot(examId: string, best = false): string {
  return `<span class="exam-stats" data-examid="${esc(examId)}"${best ? ' data-best-stats="1"' : ''}>${skelLine(180)}</span>`;
}

function warningSlot(examId: string): string {
  return `<span class="exam-warning" data-examid="${esc(examId)}" data-display="none" aria-label="Waarschuwing">⚠</span>`;
}

function presenceSlot(examId: string): string {
  return `<span class="presence-badges" data-presence-exam="${esc(examId)}"></span>`;
}

function menuButton(examId: string, kind: CardKind): string {
  return `<button class="btn btn--icon exam-menu-btn" data-action="exam-menu" data-id="${esc(examId)}" data-kind="${kind}" title="Meer acties" aria-label="Meer acties" aria-haspopup="menu" aria-expanded="false">${ICONS.dots}</button>`;
}

function overviewButton(action: 'exam-overview' | 'exam-overview-best', e: Exam): string {
  return `<button class="btn btn--secondary btn--sm exam-card-btn" data-action="${action}" data-examid="${esc(e.id)}">Overzicht openen</button>`;
}

/** The card of a test: without resits (`solo`), or above its attempts (`summary`). */
function examCard(e: Exam, attempts: number, open: boolean): string {
  const summary = attempts > 0;
  const action = summary ? 'exam-overview-best' : 'exam-overview';
  const kind = testKind(e);
  return `
    <article class="card exam-card${kind === 'diagnostic' ? ' exam-card--diagnostic' : ''}">
      <div class="card-main">
        <div class="exam-card-head">
          ${subBadge(e)}${badge(e)}
          <button class="exam-title-link" data-action="${action}" data-examid="${esc(e.id)}">${esc(e.title)}</button>
          <span class="exam-kind-pill">${esc(testKindLabel(kind))}</span>
          ${summary ? '' : warningSlot(e.id)}
        </div>
        <span class="exam-line">${esc(metaLine(e))}</span>
        ${summary ? '' : `<span class="exam-line exam-line--nums">${esc(pointsLine(e.questions))}</span>`}
        ${statsSlot(e.id, summary)}
      </div>
      <div class="card-actions">
        ${summary ? '' : presenceSlot(e.id)}
        ${
          summary
            ? `<button class="btn btn--secondary btn--sm exam-attempts-toggle" data-action="exam-attempts" data-examid="${esc(e.id)}" aria-expanded="${open}" aria-controls="attempts-${esc(e.id)}">${attempts} pogingen${CHEVRON}</button>`
            : ''
        }
        ${overviewButton(action, e)}
        ${menuButton(e.id, summary ? 'summary' : 'solo')}
      </div>
    </article>`;
}

/** One attempt on the tree: Origineel, Inhaal, Herkansing, ... */
function attemptCard(e: Exam, original: Exam): string {
  const lock = e.parent_id
    ? `<span class="exam-lock-pill" title="${esc(LOCK_TITLE)}">${LOCK}Observaties van ${esc(attemptCode(original))}</span>`
    : '';
  return `
    <article class="card exam-attempt-card">
      <div class="card-main">
        <div class="exam-card-head">
          ${subBadge(e)}${badge(e)}
          <button class="exam-attempt-label" data-action="exam-overview" data-examid="${esc(e.id)}">${esc(attemptLabel(e))}</button>
          <span class="exam-attempt-count" data-attempt-count="${esc(e.id)}"></span>
          ${lock}
          ${warningSlot(e.id)}
        </div>
        <span class="exam-line exam-line--nums">${esc(pointsLine(e.questions))}</span>
        ${statsSlot(e.id)}
      </div>
      <div class="card-actions">
        ${presenceSlot(e.id)}
        ${overviewButton('exam-overview', e)}
        ${menuButton(e.id, 'attempt')}
      </div>
    </article>`;
}

/** A test with everything under it. `open`: its attempts show. */
export function examBlock(e: Exam, resits: readonly Exam[], open: boolean): string {
  if (resits.length === 0) return examCard(e, 0, false);
  const all = [e, ...resits];
  return `
    <div class="exam-block">
      ${examCard(e, all.length, open)}
      <div class="attempt-tree${open ? ' attempt-tree--open' : ''}" id="attempts-${esc(e.id)}"${open ? '' : ' inert'}>
        <div class="attempt-tree-inner">
          <div class="attempt-tree-list">
            ${all.map((a) => attemptCard(a, e)).join('')}
          </div>
        </div>
      </div>
    </div>`;
}

/** Flip a tree open or closed in place (no re-render: the stats stay). */
export function setAttemptsOpen(toggle: HTMLElement, open: boolean): void {
  toggle.setAttribute('aria-expanded', String(open));
  const tree = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  tree?.classList.toggle('attempt-tree--open', open);
  tree?.toggleAttribute('inert', !open);
}
