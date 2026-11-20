// SPDX-License-Identifier: AGPL-3.0-or-later

// The Toetsen screen as cards (design spec 4.7, F-27, PLAN-2 decisions 41-44, boards 55-56): a
// section per jaarlaag, three cards per row with the periodes in reading order, and a test with
// resits as a stack whose attempts live in a tray under its row (stack.ts moves them). The
// numbers are filled in later (toetsen.ts); a card keeps its height meanwhile.

import { esc } from '../../components/dialog';
import { skelLine } from '../../components/skeleton';
import { attemptCode, attemptLabel, metaLine } from '../../domain/exam-info';
import { isPo, rubricOf } from '../../domain/po';
import { testBadgeClass, testKind, testKindLabel } from '../../domain/test-type';
import type { Exam } from '../../domain/types';
import { ICONS } from '../../utils/icons.js';
import { cardLine1, cardRtti, miniHistogram, type MiniBar } from './card-model';

/** Which card a ⋮ menu belongs to: no resits, the Verzamelkaart of a stack, or one attempt. */
export type CardKind = 'solo' | 'summary' | 'attempt';

/** Cards per row (decision 41). */
export const COLUMNS = 3;

const SUB_LETTER: Record<string, string> = { wisa: 'A', wisb: 'B', wisc: 'C', wisd: 'D' };

const LOCK =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

const LOCK_TITLE =
  'Observaties worden bij het aanmaken overgenomen van het origineel en kunnen niet los worden gewijzigd';

/** A PO's verzameloverzicht is not designed yet (backlog); each attempt has its own. */
export const PO_SUMMARY_LATER =
  'Een verzameloverzicht van een PO is er nog niet. Open het overzicht van een poging.';

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

/** What a click on the card (or its title) opens; null: nothing (a PO's Verzamelkaart). */
export function cardAction(e: Exam, kind: CardKind): string | null {
  if (kind === 'summary') return isPo(e) ? null : 'exam-overview-best';
  return isPo(e) ? 'po-overview' : 'exam-overview';
}

function title(e: Exam, kind: CardKind, text: string): string {
  const action = cardAction(e, kind);
  if (!action)
    return `<span class="tcard-title" title="${esc(PO_SUMMARY_LATER)}">${esc(text)}</span>`;
  return `<button type="button" class="tcard-title" data-action="${action}" data-examid="${esc(e.id)}" title="Overzicht openen">${esc(text)}</button>`;
}

function menuButton(examId: string, kind: CardKind): string {
  return `<button type="button" class="btn btn--icon exam-menu-btn" data-action="exam-menu" data-id="${esc(examId)}" data-kind="${kind}" title="Meer acties" aria-label="Meer acties" aria-haspopup="menu" aria-expanded="false">${ICONS.dots}</button>`;
}

/** The mini histogram's bars, as style data (the CSP): applyStyleData must follow. */
export function miniHistHtml(bars: readonly MiniBar[], passPct: number): string {
  return (
    bars
      .map(
        (b) =>
          `<span class="tcard-bin${b.color ? '' : ' tcard-bin--empty'}" title="${esc(b.title)}" data-h="${b.height}px"${b.color ? ` data-bg="${b.color}"` : ''}></span>`,
      )
      .join('') + `<span class="tcard-pass" data-left="${passPct}%" aria-hidden="true"></span>`
  );
}

/** The pills: the attempt's label, the kind, and for a resit the lock pill. */
function pills(e: Exam, kind: CardKind, original: Exam): string {
  const label =
    kind === 'attempt'
      ? `<span class="tcard-pill tcard-pill--attempt">${esc(attemptLabel(e))}</span>`
      : '';
  const lock =
    kind === 'attempt' && e.parent_id
      ? `<span class="tcard-pill tcard-pill--lock" title="${esc(LOCK_TITLE)}">${LOCK}Observaties van ${esc(attemptCode(original) || 'het origineel')}</span>`
      : '';
  return `${label}<span class="tcard-pill tcard-pill--kind">${esc(testKindLabel(testKind(e)))}</span>${lock}`;
}

/** The PO's rubric and projectgroepen, or the test's N-term: the tooltip of line 1. */
function line1Title(e: Exam): string {
  const rubric = isPo(e) ? rubricOf(e) : undefined;
  return [metaLine(e), rubric ? `Rubric ${rubric.naam}` : ''].filter(Boolean).join('\n');
}

/**
 * One card: a test without resits (`solo`), the Verzamelkaart of a stack (`summary`, numbers over
 * the best attempt per student) or an attempt in the tray (`attempt`, `original` is its stack).
 */
export function examCardHtml(e: Exam, kind: CardKind, original: Exam = e): string {
  const diagnostic = !!e.diagnostic;
  const rtti = cardRtti(e);
  const hist = miniHistogram([]);
  const live = kind !== 'summary'; // the presence badges and score warnings are per attempt
  const action = cardAction(e, kind);
  return `
    <article class="tcard${diagnostic ? ' tcard--diagnostic' : ''}${isPo(e) ? ' tcard--po' : ''}${action ? ' tcard--link' : ''}" data-exam-card="${esc(e.id)}" data-kind="${kind}">
      <div class="tcard-head">
        ${subBadge(e)}${badge(e)}
        ${title(e, kind, (kind === 'attempt' ? original.title : e.title) ?? '')}
        ${live ? `<span class="exam-warning" data-examid="${esc(e.id)}" hidden aria-label="Waarschuwing">⚠</span>` : ''}
        ${live ? `<span class="presence-badges" data-presence-exam="${esc(e.id)}"></span>` : ''}
        ${menuButton(e.id, kind)}
      </div>
      <div class="tcard-mid">
        <div class="tcard-info">
          <div class="tcard-pills">${pills(e, kind, original)}</div>
          <div class="tcard-line" title="${esc(line1Title(e))}">${esc(cardLine1(e))}</div>
          ${
            rtti
              ? `<div class="tcard-line tcard-rtti" title="${esc(rtti.title)}">${rtti.parts
                  .map(
                    (p, i) =>
                      `${i ? '<span class="tcard-sep" aria-hidden="true">·</span>' : ''}<b class="rtti-${p.cat.toLowerCase()}">${p.cat}</b> ${esc(p.text)}`,
                  )
                  .join('')}</div>`
              : ''
          }
        </div>
        <div class="tcard-hist" role="img" aria-label="Cijferverdeling" data-hist>${miniHistHtml(hist.bars, hist.passPct)}</div>
      </div>
      <div class="tcard-foot">
        <div class="tcard-count">
          <span class="tcard-n" data-count>${skelLine(110)}</span>
          <span class="tcard-obs" data-obs></span>
        </div>
        <div class="tcard-avg" data-avg>${skelLine(70)}</div>
      </div>
    </article>`;
}

/** Periode of an exam as a number for sorting; none last. */
export function periodeNr(e: Exam): number {
  const n = parseInt(String(e.periode ?? ''), 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function periodeLabel(e: Exam): string {
  const n = periodeNr(e);
  return n === Number.MAX_SAFE_INTEGER ? 'Zonder periode' : `Periode ${n}`;
}

/** The attempts of a stack in tray order: the original, then its resits. */
export interface Stack {
  original: Exam;
  resits: readonly Exam[];
}

/**
 * The grid of one jaarlaag: cells in reading order with a "Periode N" label on the first card of
 * a periode (and a divider to its left when it is not in the first column), and after every row
 * that has a stack a tray holding the attempt cards of the row's stacks.
 */
export function gridHtml(
  originals: readonly Exam[],
  resitsOf: (e: Exam) => readonly Exam[],
): string {
  let html = '';
  let row: Stack[] = [];
  const flushTray = (rowNr: number) => {
    if (!row.length) return;
    const cards = row
      .flatMap(({ original, resits }) =>
        [original, ...resits].map(
          (a, k) =>
            `<div class="ttray-card" data-stack-of="${esc(original.id)}" data-k="${k}" inert>${examCardHtml(a, 'attempt', original)}</div>`,
        ),
      )
      .join('');
    html += `
      <div class="ttray" data-tray="${rowNr}" data-stacks="${esc(row.map((s) => s.original.id).join(' '))}">
        <svg class="ttray-outline" aria-hidden="true"><path/></svg>
        <div class="ttray-title"></div>
        <div class="ttray-cards">${cards}</div>
      </div>`;
    row = [];
  };
  originals.forEach((e, i) => {
    const col = i % COLUMNS;
    const prev = originals[i - 1];
    const newPer = !prev || periodeNr(prev) !== periodeNr(e);
    const resits = resitsOf(e);
    const stack = resits.length > 0;
    const head =
      (newPer && col > 0 ? '<div class="tgrid-divider" aria-hidden="true"></div>' : '') +
      `<div class="tgrid-per">${newPer ? esc(periodeLabel(e)) : ''}</div>`;
    if (stack) {
      const n = resits.length + 1;
      row.push({ original: e, resits });
      html += `
        <div class="tgrid-cell tgrid-cell--stack" data-col="${col}" data-stack="${esc(e.id)}" data-n="${n}">
          ${head}
          <div class="tstack">
            ${examCardHtml(e, 'summary')}
            <button type="button" class="tstack-toggle" data-action="exam-attempts" data-examid="${esc(e.id)}" aria-expanded="false">${n} pogingen ▾</button>
          </div>
        </div>`;
    } else {
      html += `<div class="tgrid-cell" data-col="${col}">${head}${examCardHtml(e, 'solo')}</div>`;
    }
    if (col === COLUMNS - 1 || i === originals.length - 1) flushTray(Math.floor(i / COLUMNS));
  });
  return `<div class="tgrid">${html}</div>`;
}
