// SPDX-License-Identifier: AGPL-3.0-or-later

// Beheer › Instellingen, card "Afgedrukte rapporten" (step 41, X-06, PLAN-2 decision 85): how
// much room the printed copies in `rapporten/<schooljaar>/` take, per school year, and
// "Opruimen", which deletes the copies of the school years before a chosen one after a confirm
// with the count. Nothing automatic. The core decides what a copy is
// (`maatwerk_core::rapporten`); this only shows it.

import type { MaatwerkApi, RapportenYear } from '../bridge/api';
import { confirmDialog } from '../components/dialog';
import { CustomSelect } from '../custom-select.js';
import { formatSize } from '../domain/format';

type Api = Pick<MaatwerkApi, 'rapportenUsage' | 'rapportenCleanup'>;

/** A bridge error (`{ code, message }`) or an Error as text. */
function message(e: unknown): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : String(e);
}

/** A size in kB (as the core sends it) as text: "412 kB", "31,4 MB". */
export function sizeText(kb: number): string {
  return formatSize(kb * 1024);
}

/** "1 bestand", "12 bestanden". */
export function filesText(n: number): string {
  return `${n} ${n === 1 ? 'bestand' : 'bestanden'}`;
}

/**
 * The years "Opruimen" can keep from: every year with copies except the oldest (nothing is
 * older than it), newest first. Choosing `2025-2026` deletes `2024-2025` and older.
 */
export function cleanupChoices(years: readonly RapportenYear[]): string[] {
  return years
    .map((y) => y.schooljaar)
    .sort()
    .slice(1)
    .reverse();
}

/** What "Opruimen" from `before` would delete. */
export function toRemove(
  years: readonly RapportenYear[],
  before: string,
): { files: number; kb: number } {
  return years
    .filter((y) => y.schooljaar < before)
    .reduce((t, y) => ({ files: t.files + y.files, kb: t.kb + y.kb }), { files: 0, kb: 0 });
}

function el(tag: string, className = '', content = ''): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (content) e.textContent = content;
  return e;
}

/** The card; fills itself once the usage is read. */
export function rapportenCard(
  api: Api,
  toast: (message: string, type?: string) => void,
): HTMLElement {
  const card = el('section', 'card inst-card inst-rapporten');
  card.id = 'inst-rapporten';
  const fill = async (): Promise<void> => {
    let years: RapportenYear[];
    try {
      years = await api.rapportenUsage();
    } catch (e) {
      card.replaceChildren(
        el('h3', 'inst-card__title', 'Afgedrukte rapporten'),
        el('p', 'hint', `Kon de map rapporten niet lezen: ${message(e)}`),
      );
      return;
    }
    const total = toRemove(years, '9999-9999');
    card.replaceChildren(
      el('h3', 'inst-card__title', 'Afgedrukte rapporten'),
      el(
        'p',
        'hint',
        'Bij Afdrukken komt een kopie van het rapport in de map rapporten naast de ' +
          'gegevensmap, per schooljaar. Opruimen verwijdert de kopieën van oudere schooljaren; ' +
          'de gegevens zelf blijven, dus een rapport kan altijd opnieuw worden gemaakt.',
      ),
    );
    if (!years.length) {
      card.append(el('p', 'hint', 'Nog geen afgedrukte rapporten.'));
      return;
    }
    const summary = el(
      'p',
      'inst-rapporten__total',
      `In totaal ${filesText(total.files)}, ${sizeText(total.kb)}.`,
    );
    summary.id = 'inst-rapporten-total';
    const list = el('ul', 'snapshot-list inst-rapporten__years');
    for (const y of [...years].reverse()) {
      const li = el('li');
      li.dataset.year = y.schooljaar;
      li.append(
        el('span', 'snapshot-date', y.schooljaar),
        el('span', 'snapshot-kind', `${filesText(y.files)} · ${sizeText(y.kb)}`),
      );
      list.append(li);
    }
    card.append(summary, list);

    const choices = cleanupChoices(years);
    const row = el('div', 'form-row inst-rapporten__clean');
    const label = el('label', '', 'Ouder dan schooljaar');
    const host = el('div', 'csel-host');
    host.id = 'inst-rapporten-before';
    const select = new CustomSelect(host, { placeholder: '—', disabled: !choices.length });
    select.setOptions(choices.map((c) => ({ value: c, label: c })));
    // The least: only the oldest year (review before deleting more).
    if (choices.length) select.setValue(choices[choices.length - 1]!);
    const button = el('button', 'btn btn--danger btn--sm', 'Opruimen') as HTMLButtonElement;
    button.id = 'inst-rapporten-clean';
    button.type = 'button';
    if (!choices.length) {
      button.disabled = true;
      button.title = 'Er zijn alleen kopieën van één schooljaar.';
    }
    const group = el('div', 'form-group u-mb-0');
    group.append(label, host);
    row.append(group, button);
    card.append(row);

    button.addEventListener('click', async () => {
      const before = select.getValue() as string;
      if (!before) return;
      const what = toRemove(years, before);
      if (!what.files) {
        toast(`Er zijn geen kopieën van vóór ${before}.`, 'info');
        return;
      }
      const ok = await confirmDialog(
        `${filesText(what.files)} (${sizeText(what.kb)}) van vóór schooljaar ${before} ` +
          'verwijderen? Dit kan niet ongedaan worden gemaakt.',
        { title: 'Rapporten opruimen', okLabel: 'Verwijderen', danger: true },
      );
      if (!ok) return;
      button.disabled = true;
      try {
        const done = await api.rapportenCleanup(before);
        const msg = `${filesText(done.files)} verwijderd (${sizeText(done.kb)}).`;
        if (done.failed.length) {
          toast(
            `${msg} ${filesText(done.failed.length)} kon niet worden verwijderd (geopend of in ` +
              `gebruik door OneDrive), bijvoorbeeld ${done.failed[0]}. Probeer het later opnieuw.`,
            'error',
          );
        } else {
          toast(msg, 'success');
        }
      } catch (e) {
        toast(`Opruimen mislukt: ${message(e)}`, 'error');
      }
      await fill();
    });
  };
  card.append(el('h3', 'inst-card__title', 'Afgedrukte rapporten'), el('p', 'hint', 'Laden…'));
  void fill();
  return card;
}
