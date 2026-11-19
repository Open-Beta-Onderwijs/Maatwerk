// SPDX-License-Identifier: AGPL-3.0-or-later

// MODAL: Opdracht afdrukken (0.19.1 hotfix), from the print button on the Opdrachten tab: one copy
// of the opdracht without the student block (`mode: 'plain'`, `maatwerk-main 3`), in the PDF
// viewer. "Met antwoorden" renders it again with the upside-down answers. The viewer's
// "Openen in PDF-viewer" opens the rendered PDF in the system viewer; no copy is saved in
// rapporten/ (there is no toets or class to name it after).

import { openModal, toast } from '../app.js';
import { esc } from '../components/dialog';
import { renderWarningsHtml } from '../components/render-warnings';
import type { Opdracht } from '../domain/types';

/** The batch job for one plain copy of `opdracht`. */
export function plainJob(opdracht: Pick<Opdracht, 'id' | 'naam'>) {
  return {
    key: opdracht.id,
    opdrachtId: opdracht.id,
    label: opdracht.naam,
    mode: 'plain' as const,
    header: { title: opdracht.naam ?? '' },
  };
}

/** Opens the print view of one opdracht. */
export function openOpdrachtPrintModal(opdracht: Opdracht): void {
  let pdfPath: string | null = null;
  // A newer render (the checkbox toggled while compiling) wins.
  let run = 0;

  const onMessage = (e: MessageEvent) => {
    if (e.data?.type !== 'print-pdf' || !pdfPath) return;
    void window.maatwerk.openPath(pdfPath).then((err) => {
      if (err) toast(`Openen mislukt: ${err}`, 'error');
    });
  };
  window.addEventListener('message', onMessage);

  const dialog = openModal({
    key: 'opdracht-print',
    title: `Opdracht afdrukken: ${opdracht.naam ?? ''}`,
    subtitle: 'Zonder leerling, klas en observaties',
    className: 'modal-pdf',
    fixedHeight: true,
    headerActionsHtml: `<label class="og-inline-check"><input type="checkbox" data-action="op-answers" /> Met antwoorden</label>`,
    body: '<div class="rapport-modal-content"></div>',
    onShow: null,
    onClose: () => window.removeEventListener('message', onMessage),
  });
  const content = dialog.body.querySelector<HTMLElement>('.rapport-modal-content')!;
  const answers = dialog.el.querySelector<HTMLInputElement>('[data-action="op-answers"]')!;

  const render = async () => {
    const mine = ++run;
    pdfPath = null;
    content.innerHTML = '<div class="rapport-spinner">Opdracht wordt gegenereerd…</div>';
    let res: Awaited<ReturnType<typeof window.maatwerk.renderAssignmentBatch>>;
    try {
      res = await window.maatwerk.renderAssignmentBatch([plainJob(opdracht)], {
        includeAnswers: answers.checked,
        duplex: false,
        outputName: 'opdracht.pdf',
      });
    } catch (e) {
      res = { success: false, error: String((e as Error)?.message ?? e) };
    }
    if (mine !== run || !content.isConnected) return;
    if (!res.success) {
      content.innerHTML = `<pre class="hint rapport-error">${esc(res.error)}</pre>`;
      toast('Fout bij het genereren van de opdracht.', 'error');
      return;
    }
    pdfPath = res.pdfPath;
    const pdfUrl = window.maatwerk.pdfUrl(res.pdfPath);
    content.innerHTML = `${renderWarningsHtml(res.warnings)}<iframe class="rapport-pdf-frame" src="pdf-viewer.html?file=${encodeURIComponent(pdfUrl)}"></iframe>`;
  };

  answers.addEventListener('change', () => void render());
  void render();
}
