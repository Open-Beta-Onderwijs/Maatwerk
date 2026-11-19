// SPDX-License-Identifier: AGPL-3.0-or-later

// A failed Opdrachten genereren (T23, board 63; step 32c): one card per failed opdracht with a
// student count only (never names, decision 75), the error, "Laat AI dit oplossen" (when the
// assistant is available), "Openen in editor" and "Melding kopiëren". The batch reports the
// failures as one text (maatwerk_core::typst_svc::batch: `Fout in opdracht "<label>":`, several
// separated by FAILURE_SEPARATOR); the jobs say which opdracht and students each label is.

import type { AiApi, AiProvider } from '../../bridge/ai-api';
import type { BatchJob } from '../../bridge/api';
import { h } from '../../editor/ai/dom';
import { copyButton, logoTile } from '../../editor/ai/install';

/** maatwerk_core::typst_svc::batch::FAILURE_SEPARATOR */
export const FAILURE_SEPARATOR = '\n\n────────\n\n';

export interface BatchFailure {
  opdrachtId: string;
  label: string;
  /** Students whose opdracht this is (0 for the answer key). */
  students: number;
  /** The error as the batch wrote it, without the "Fout in opdracht" line. */
  error: string;
}

/** The failures in the batch error, matched to the jobs; null when the text is not of that form. */
export function parseBatchFailures(
  error: string,
  jobs: readonly BatchJob[],
): BatchFailure[] | null {
  const parts = error.split(FAILURE_SEPARATOR);
  // Several failures start with the count line.
  if (parts.length > 1 && /^\d+ opdrachten bevatten een fout\.$/.test(parts[0]!)) parts.shift();
  const out: BatchFailure[] = [];
  for (const part of parts) {
    const m = /^Fout in opdracht "([^\n]*)":\n\n([\s\S]*)$/.exec(part);
    if (!m) return null;
    const label = m[1]!;
    const own = jobs.filter((j) => (j.label ?? j.opdrachtId) === label);
    const job = own[0];
    if (!job) return null;
    const students = new Set(
      own.filter((j) => j.opdrachtId === job.opdrachtId && j.mode !== 'answers').map((j) => j.key),
    );
    out.push({ opdrachtId: job.opdrachtId, label, students: students.size, error: m[2]!.trim() });
  }
  return out.length ? out : null;
}

const leerlingen = (n: number) => (n === 1 ? 'voor 1 leerling' : `voor ${n} leerlingen`);

export interface FailureActions {
  /** The first CLI found when the assistant is available; null hides "Laat AI dit oplossen". */
  provider: AiProvider | null;
  fixWithAi(f: BatchFailure, provider: AiProvider): void;
  openInEditor(f: BatchFailure): void;
}

/** The failure view (board 63's "MISLUKT, PER OPDRACHT"). */
export function failureView(
  failures: readonly BatchFailure[],
  actions: FailureActions,
): HTMLElement {
  const n = failures.length;
  const view = h(
    'div',
    { class: 'og-fail', role: 'alert' },
    h(
      'div',
      { class: 'og-fail__head' },
      h('strong', {}, n === 1 ? '1 opdracht bevat een fout' : `${n} opdrachten bevatten een fout`),
      h('span', {}, 'Er is nog geen PDF gemaakt.'),
    ),
    h('span', { class: 'ais-cap' }, 'MISLUKT, PER OPDRACHT'),
  );
  for (const f of failures) {
    const p = actions.provider;
    const fix = p
      ? h(
          'button',
          { type: 'button', class: 'btn btn--primary btn--sm og-fail__ai' },
          logoTile(p.key, p.name, 'sm'),
          'Laat AI dit oplossen',
        )
      : null;
    fix?.addEventListener('click', () => actions.fixWithAi(f, p!));
    const open = h(
      'button',
      { type: 'button', class: 'btn btn--secondary btn--sm' },
      'Openen in editor',
    );
    open.addEventListener('click', () => actions.openInEditor(f));
    view.append(
      h(
        'div',
        { class: 'og-fail__card', 'data-opdracht': f.opdrachtId },
        h(
          'div',
          { class: 'og-fail__title' },
          h('strong', {}, f.label),
          f.students ? h('span', { class: 'ais-muted' }, leerlingen(f.students)) : null,
        ),
        h('pre', { class: 'og-fail__error ais-mono' }, f.error),
        h(
          'div',
          { class: 'og-fail__actions' },
          fix,
          open,
          h('span', { class: 'og-fail__spacer' }),
          copyButton(
            `Fout in opdracht "${f.label}":\n\n${f.error}`,
            'btn btn--text btn--sm',
            'Melding kopiëren',
          ),
        ),
      ),
    );
  }
  view.append(
    h(
      'span',
      { class: 'ais-hint' },
      'Los de fouten op en klik daarna opnieuw op Genereren; de koppelingen blijven staan.',
    ),
  );
  return view;
}

/** The first CLI found, when the school and the teacher have the assistant on. */
export async function fixProvider(ai: AiApi, gebruiker: string | null): Promise<AiProvider | null> {
  if (!gebruiker) return null;
  const d = await ai.detect(gebruiker, false).catch(() => null);
  if (!d?.school || !d.settings.enabled) return null;
  return d.providers.find((p) => p.found) ?? null;
}
