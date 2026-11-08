// SPDX-License-Identifier: AGPL-3.0-or-later

// The one-time conversion of an older data folder (v1: ADR-0003 C1, Step 7a;
// v2 -> v3: step 18), offered at start instead of the startup error screen when
// the folder needs it. First a dry run shows what changes in the content (the
// observaties each inhaal and herkansing gets, decision 13). The admin confirms
// that nobody uses the old app any more; Maatwerk then zips the whole folder to
// a local backup, converts it and checks the result (docs/cutover-runbook.md).

import type { MaatwerkApi, MigrationResult } from '../bridge/api';
import { issueCounts, issueTable } from './gegevens';
import { asFolderError } from './startup-error';

type Api = Pick<MaatwerkApi, 'migrateDataFolder' | 'restartApp'>;

function el(tag: string, className: string, content = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

/** The summary after a migration, as lines of Dutch text. */
export function migrationSummary(r: MigrationResult): string[] {
  const lines = [
    `Gegevensmap omgezet van versie ${r.fromVersion} naar ${r.toVersion}.`,
    `${r.written} bestanden bijgewerkt, ${r.moved} verplaatst, ${r.deleted} verwijderd.`,
  ];
  if (r.backup) lines.push(`Back-up: ${r.backup}`);
  if (r.reportFile) lines.push(`Verslag (ook na het starten te lezen): ${r.reportFile}`);
  const n = r.warnings.length;
  lines.push(
    `Meldingen bij het omzetten: ${n === 0 ? 'geen' : n}.`,
    r.validation
      ? `Controle na het omzetten: ${r.validation.filesChecked} ${r.validation.filesChecked === 1 ? 'bestand' : 'bestanden'} gecontroleerd. ` +
          issueCounts(r.validation.issues)
      : 'Controle na het omzetten: niet uitgevoerd.',
  );
  return lines;
}

/** The content changes of a migration (`notes`) as a titled list, or null when there are none. */
export function migrationNotes(r: MigrationResult, title: string): HTMLElement | null {
  if (!r.notes.length) return null;
  const wrap = el('div', 'migration-notes');
  wrap.append(el('h4', 'migration-heading', title));
  const list = el('ul', 'migration-warnings');
  for (const n of r.notes) list.append(el('li', '', n));
  wrap.append(list);
  return wrap;
}

/** What a dry run shows before the confirm: counts, warnings, the resits' observaties. */
export function migrationPreview(r: MigrationResult): HTMLElement[] {
  const out: HTMLElement[] = [
    el(
      'p',
      'startup-error-detail',
      `Van versie ${r.fromVersion} naar ${r.toVersion}: ${r.written} bestanden bijwerken, ` +
        `${r.moved} verplaatsen, ${r.deleted} verwijderen (de verwijderde staan in de back-up).`,
    ),
  ];
  if (r.warnings.length) {
    const wrap = el('div', 'migration-notes');
    wrap.append(el('h4', 'migration-heading', 'Let op'));
    const list = el('ul', 'migration-warnings');
    for (const w of r.warnings) list.append(el('li', '', w));
    wrap.append(list);
    out.push(wrap);
  }
  const notes = migrationNotes(
    r,
    'Inhaal- en herkansingstoetsen krijgen de observaties van de oorspronkelijke toets',
  );
  if (notes) out.push(notes);
  return out;
}

/** The report shown after the migration: summary, migration warnings, check issues. */
export function migrationReport(r: MigrationResult): HTMLElement {
  const report = el('div', 'migration-done');
  report.setAttribute('role', 'region');
  report.setAttribute('aria-label', 'Verslag van het omzetten');
  report.append(el('h3', 'migration-heading', 'Verslag van het omzetten'));
  for (const line of migrationSummary(r)) report.append(el('p', '', line));
  const notes = migrationNotes(r, 'Observaties bij inhaal- en herkansingstoetsen');
  if (notes) report.append(notes);
  if (r.warnings.length) {
    report.append(el('h4', 'migration-heading', 'Meldingen bij het omzetten'));
    const list = el('ul', 'migration-warnings');
    for (const w of r.warnings) list.append(el('li', '', w));
    report.append(list);
  }
  const issues = r.validation?.issues ?? [];
  if (r.validation && issues.length) {
    report.append(el('h4', 'migration-heading', 'Controle na het omzetten'));
    const wrap = el('div', 'migration-issues');
    wrap.append(issueTable(r.validation));
    report.append(wrap);
    const errors = issues.some((i) => i.severity === 'error');
    report.append(
      el(
        'p',
        errors ? 'migration-advice migration-advice-error' : 'migration-advice',
        errors
          ? 'Er zijn fouten gevonden. Los ze op voordat collega’s verder werken: na het ' +
              'starten staan ze ook bij Beheer > Gegevenscontrole. Lukt dat niet, zet dan de ' +
              'back-up terug (zie het draaiboek).'
          : 'Waarschuwingen houden het werken niet tegen. Na het starten staan ze ook bij ' +
              'Beheer > Gegevenscontrole.',
      ),
    );
  }
  return report;
}

/** Replaces the startup screen's content with the conversion offer. */
export function renderMigration(container: HTMLElement, dataDir: string, api: Api): void {
  const box = el('div', 'startup-error migration');
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Gegevensmap omzetten');
  box.append(
    el('h2', 'startup-error-title', 'Deze gegevensmap moet eenmalig worden omgezet'),
    el(
      'p',
      'startup-error-advice',
      'Deze versie van Maatwerk slaat de gegevens op een nieuwe manier op. Maatwerk maakt ' +
        'eerst een back-up van de hele map op deze computer en zet de gegevens daarna om. ' +
        'Dat kan enkele minuten duren. Daarna werkt de oude Maatwerk niet meer met deze map.',
    ),
  );
  if (dataDir) {
    const folder = el('p', 'startup-error-folder', 'Map: ');
    folder.append(el('code', '', dataDir));
    box.append(folder);
  }
  // The dry run: what the admin agrees to (decision 13): how many files change, the warnings
  // and each resit's observaties. "Omzetten" waits for it (review 18 m1). A failure here is
  // not fatal; the migration itself refuses with the same reason.
  const preview = el('div', 'migration-preview');
  preview.setAttribute('aria-live', 'polite');
  preview.append(el('p', 'startup-error-detail', 'Bezig met nagaan wat er verandert…'));
  box.append(preview);
  let previewDone = false;
  const label = el('label', 'migration-confirm');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.id = 'migration-confirm';
  label.append(
    check,
    document.createTextNode(
      " Alle collega's hebben de oude Maatwerk gesloten en gebruiken hem niet meer.",
    ),
  );
  box.append(label);
  const status = el('p', 'startup-error-detail migration-status');
  status.setAttribute('aria-live', 'polite');
  const go = el('button', 'btn btn--primary migration-go', 'Omzetten') as HTMLButtonElement;
  go.disabled = true;
  const update = () => (go.disabled = !check.checked || !previewDone);
  check.addEventListener('change', update);
  void api.migrateDataFolder(true).then(
    (r) => {
      preview.replaceChildren(...migrationPreview(r));
      previewDone = true;
      update();
    },
    (e) => {
      preview.replaceChildren(
        el(
          'p',
          'startup-error-detail',
          `Niet na te gaan wat er verandert: ${asFolderError(e).message}`,
        ),
      );
      previewDone = true;
      update();
    },
  );
  go.addEventListener('click', async () => {
    go.disabled = true;
    check.disabled = true;
    status.textContent = 'Bezig met de back-up en het omzetten…';
    try {
      const result = await api.migrateDataFolder();
      const done = migrationReport(result);
      box.classList.add('migration-wide');
      const start = el('button', 'btn btn--primary', 'Maatwerk starten') as HTMLButtonElement;
      start.addEventListener('click', () => {
        start.disabled = true;
        void api.restartApp();
      });
      done.append(start);
      status.textContent = '';
      label.remove();
      go.remove();
      box.append(done);
    } catch (e) {
      // A refusal (migration_blocked) changed nothing; a failure later on leaves a partly
      // converted folder that a next attempt finishes (the backup was made first).
      const err = asFolderError(e);
      status.textContent =
        err.code === 'migration_blocked'
          ? `Niet omgezet, er is niets veranderd:\n${err.message}`
          : `Omzetten mislukt: ${err.message}\nDe back-up is gemaakt. Probeer het opnieuw: ` +
            'het omzetten gaat verder waar het stopte.';
      check.disabled = false;
      go.disabled = !check.checked;
    }
  });
  box.append(status, go);
  container.replaceChildren(box);
}
