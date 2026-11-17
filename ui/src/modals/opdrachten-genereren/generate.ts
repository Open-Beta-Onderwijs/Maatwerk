// SPDX-License-Identifier: AGPL-3.0-or-later

// Generating the opdrachten (one block per student, each on an odd page) or the answer key, and
// showing the PDF. A failed batch lists every failed opdracht (T23).

import { escHtml, toast } from '../../app.js';
import type { BatchJob } from '../../bridge/api';
import { printName } from '../../domain/print';
import type { Opdracht } from '../../domain/types';
import { renderWarningsHtml } from '../../components/render-warnings';
import { Store } from '../../store.js';
import { includedStudents, type OgState } from './state';
import { renderSummary } from './lists';

export type GenerateKind = 'student' | 'key';

function studentJobs(state: OgState): BatchJob[] {
  const { exam } = state;
  return includedStudents(state).flatMap(({ student, group, items }) =>
    items.map(({ opdracht, obs }) => ({
      key: String(student.id),
      opdrachtId: opdracht.id,
      label: opdracht.naam,
      mode: 'student' as const,
      header: {
        title: opdracht.naam ?? '',
        student: Store.fullName(student),
        group: group?.name ?? '',
        exam: exam.title ?? '',
        observaties: obs.map((o) => ({ icon: o.icon ?? '', name: o.naam ?? '' })),
      },
    })),
  );
}

function answerKeyJobs(state: OgState): BatchJob[] {
  const seen = new Map<string, Opdracht>();
  for (const { items } of includedStudents(state)) {
    for (const { opdracht } of items) seen.set(opdracht.id, opdracht);
  }
  return [...seen.values()]
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'))
    .map((o) => ({
      key: o.id,
      opdrachtId: o.id,
      label: o.naam,
      mode: 'answers' as const,
      header: { title: o.naam ?? '' },
    }));
}

/**
 * Runs the batch and shows the result view. `save` stores the coupling first (so the PDF and the
 * saved links agree).
 */
export async function generate(
  el: HTMLElement,
  state: OgState,
  year: string,
  kind: GenerateKind,
  save: () => Promise<void>,
): Promise<void> {
  if (state.busy) return;
  const jobs = kind === 'key' ? answerKeyJobs(state) : studentJobs(state);
  const missing = jobs.filter((j) => !j.opdrachtId);
  if (missing.length) {
    toast(`Opdracht "${missing[0]!.label}" heeft geen Typst-bestand.`, 'error');
    return;
  }
  if (!jobs.length) return;

  state.busy = true;
  renderSummary(el, state);
  await save();

  const settings = el.querySelector<HTMLElement>('.og-settings')!;
  const result = el.querySelector<HTMLElement>('.og-result')!;
  const content = el.querySelector<HTMLElement>('.og-result-content')!;
  const backBtn = el.querySelector<HTMLButtonElement>('[data-action="og-back"]')!;
  settings.hidden = true;
  result.hidden = false;
  backBtn.disabled = true;

  const what = kind === 'key' ? 'Antwoordsleutel' : 'Opdrachten';
  content.innerHTML = `<div class="rapport-spinner">${what} worden gegenereerd… <span class="og-progress"></span></div>`;
  const progressEl = content.querySelector('.og-progress')!;
  const offProgress = window.maatwerk.onAssignmentProgress(({ done, total }) => {
    if (progressEl.isConnected) progressEl.textContent = `${done} / ${total}`;
  });

  let res: Awaited<ReturnType<typeof window.maatwerk.renderAssignmentBatch>>;
  try {
    res = await window.maatwerk.renderAssignmentBatch(jobs, {
      includeAnswers: state.includeAnswers,
      duplex: kind !== 'key',
      outputName: kind === 'key' ? 'antwoordsleutel.pdf' : 'opdrachten.pdf',
    });
  } catch (e) {
    res = { success: false, error: String((e as Error)?.message ?? e) };
  } finally {
    offProgress();
    state.busy = false;
  }
  if (!el.isConnected) return;
  backBtn.disabled = false;
  renderSummary(el, state);

  if (!res.success) {
    content.innerHTML = `<pre class="hint rapport-error">${escHtml(res.error)}</pre>`;
    toast(`Fout bij het genereren van de ${what.toLowerCase()}.`, 'error');
    return;
  }

  // Every run gets a new output ID, so pdfUrl() returns a fresh URL.
  const pdfUrl = window.maatwerk.pdfUrl(res.pdfPath);
  content.innerHTML = `${renderWarningsHtml(res.warnings)}<iframe class="rapport-pdf-frame" src="pdf-viewer.html?file=${encodeURIComponent(pdfUrl)}"></iframe>`;
  state.printPath = res.pdfPath;
  state.printName = printName(
    what,
    year,
    state.exam,
    includedStudents(state).map(({ group }) => group?.name),
  );
  toast(`${what} gegenereerd (${res.pages} pagina's).`, 'success');
}
