// SPDX-License-Identifier: AGPL-3.0-or-later

// MODAL: Rapport (opened from the Toetsen screen): the toets rapport, or for a PO the PO rapport
// (step 24), in the PDF viewer. Report data: src/domain/rapport.ts and po-rapport.ts; loading
// and compiling: src/services/rapport.ts. Converted from modals/rapport.js in step 24 (R-05);
// the RTTI uitleg modal moved to rtti-uitleg.ts.

import { toast, openModal } from '../app.js';
import { esc } from '../components/dialog';
import { renderWarningsHtml } from '../components/render-warnings';
import { isPo } from '../domain/po';
import { printName } from '../domain/print';
import type { Exam, Observatie } from '../domain/types';
import { compilePoRapport, compileRapport } from '../services/rapport';
import { Store } from '../store.js';
import { loadPoContext } from './po-scores';

type Rendered =
  { success: true; pdfPath: string; warnings?: string[] } | { success: false; error: string };

/** What a render gives the viewer: the PDF (or why not), and the classes for the file name. */
interface Outcome {
  result: Rendered | null;
  groupNames: (string | null | undefined)[];
  /** HTML above the PDF (the PO's students without a rapport). */
  notice?: string;
  /** Shown instead of a PDF when there is nothing to render. */
  empty?: string;
}

let printListener: ((e: MessageEvent) => void) | null = null;

function stopListening(): void {
  if (printListener) window.removeEventListener('message', printListener);
  printListener = null;
}

/** Saves a named copy of a render output in rapporten/ and opens it; toasts a failure. */
export async function printOutput(outputId: string, name: unknown): Promise<void> {
  try {
    await window.maatwerk.printPdf(
      outputId,
      name as Parameters<typeof window.maatwerk.printPdf>[1],
    );
  } catch (err) {
    toast(`Afdrukken mislukt: ${(err as Error)?.message ?? err}`, 'error');
  }
}

async function toetsOutcome(exam: Exam, year: string): Promise<Outcome> {
  let groupNames: (string | null | undefined)[] = [];
  const api = {
    readJson: (relPath: string) => window.maatwerk.readJson(relPath),
    renderRapportPdf: (examId: string, students: unknown[], examInfo: Record<string, unknown>) => {
      // The group names of the students in the rapport, for the printed file name.
      groupNames = students.map((s) => (s as { group?: string } | null)?.group);
      return window.maatwerk.renderRapportPdf(examId, students, examInfo);
    },
  };
  const result = (await compileRapport(exam, year, { Store, api })) as Rendered;
  return { result, groupNames };
}

/** "Lotte Bakker en Daan Jansen": names as one line. */
function names(list: readonly string[]): string {
  return list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} en ${list.at(-1)}`;
}

/** The PO's students without a rapport (decision 18: unplaced students have no grade). */
export function skippedHtml(skipped: { unplaced: string[]; ungraded: string[] }): string {
  const parts = [
    skipped.unplaced.length
      ? `niet ingedeeld in een projectgroep: ${esc(names(skipped.unplaced))}`
      : '',
    skipped.ungraded.length ? `nog geen cijfer: ${esc(names(skipped.ungraded))}` : '',
  ].filter(Boolean);
  return parts.length
    ? `<p class="rapport-skipped">Geen rapport voor ${parts.join('; ')}.</p>`
    : '';
}

async function poOutcome(exam: Exam, year: string): Promise<Outcome> {
  const ctx = await loadPoContext(exam.id, year);
  if (!ctx) return { result: null, groupNames: [], empty: 'Deze PO bestaat niet meer.' };
  if (!ctx.rubric)
    return {
      result: null,
      groupNames: [],
      empty: 'Deze PO heeft geen rubric, dus geen cijfers. Kies een rubric via PO bewerken.',
    };
  const observaties = (await Store.getObservaties(ctx.subject)) as Observatie[];
  const { result, skipped, classes } = await compilePoRapport(
    { ...ctx, observaties },
    { renderPoRapportPdf: (...a) => window.maatwerk.renderPoRapportPdf(...a) },
  );
  return {
    result: result as Rendered | null,
    groupNames: classes,
    notice: skippedHtml(skipped),
    empty:
      'Nog geen leerling van deze PO heeft een cijfer. Beoordeel eerst de projectgroepen via Scores invoeren.',
  };
}

/**
 * Compiles the rapport for `exam` and shows it in the PDF viewer inside `content`.
 * Shows a spinner while compiling and an error message on failure.
 */
async function showRapportPdf(content: HTMLElement, exam: Exam, year: string): Promise<void> {
  content.innerHTML = '<div class="rapport-spinner">Rapport wordt gegenereerd…</div>';

  let outcome: Outcome;
  try {
    outcome = isPo(exam) ? await poOutcome(exam, year) : await toetsOutcome(exam, year);
  } catch (err) {
    outcome = {
      result: { success: false, error: String((err as Error)?.message ?? err) },
      groupNames: [],
    };
  }
  // The user may have navigated away / closed the modal while compiling
  if (!content.isConnected) return;

  const { result } = outcome;
  if (!result) {
    content.innerHTML = `${outcome.notice ?? ''}<p class="hint">${esc(outcome.empty ?? '')}</p>`;
    return;
  }
  if (!result.success) {
    content.innerHTML = `<pre class="hint rapport-error">${esc(String(result.error))}</pre>`;
    toast('Compilatiefout bij het genereren van het rapport.', 'error');
    return;
  }

  // The bridge turns the output ID into a URL the viewer iframe can load
  // (the reference used 'file:///' + path, which a webview cannot load).
  const pdfUrl = window.maatwerk.pdfUrl(result.pdfPath);
  const outputId = result.pdfPath;
  const viewerSrc = `pdf-viewer.html?file=${encodeURIComponent(pdfUrl)}`;
  content.innerHTML = `${outcome.notice ?? ''}${renderWarningsHtml(result.warnings)}<iframe class="rapport-pdf-frame" src="${viewerSrc}"></iframe>`;

  // The embedded PDF viewer's "Afdrukken" button (postMessage): a named copy in
  // rapporten/<schooljaar>/, opened in the system viewer (ADR-0002 section 9).
  const name = printName('Rapport', year, exam, outcome.groupNames);
  stopListening();
  printListener = (e) => {
    if (e.data?.type === 'print-pdf') void printOutput(outputId, name);
  };
  window.addEventListener('message', printListener);

  toast('Rapport gegenereerd.', 'success');
}

/** Opens the rapport for one exam or PO in a modal overlay (used from the Toetsen screen). */
export function openRapportModal(examId: string, year: string): void {
  const exam = (Store.getExamsSync(year) as Exam[]).find((e) => e.id === examId);
  if (!exam) return;
  const dialog = openModal({
    key: 'rapport',
    title: `Rapport: ${exam.title}`,
    subtitle: `Jaarlaag ${exam.jaarlaag} · ${year}`,
    className: 'modal-pdf',
    fixedHeight: true,
    body: '<div class="rapport-modal-content"></div>',
    onShow: null,
    onClose: stopListening,
  });
  void showRapportPdf(
    dialog.body.querySelector('.rapport-modal-content') as HTMLElement,
    exam,
    year,
  );
}
