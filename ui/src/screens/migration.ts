// SPDX-License-Identifier: AGPL-3.0-or-later

// The one-time conversion of a v1 data folder (ADR-0003 C1, Step 7a), offered
// at start instead of the startup error screen when the folder needs it. The
// admin confirms that nobody uses the old app any more; Maatwerk then zips the
// whole folder to a local backup, converts it and checks the result
// (docs/cutover-runbook.md).

import type { MaatwerkApi, MigrationResult } from '../bridge/api';
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
  const issues = r.validation?.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'error').length;
  lines.push(
    errors > 0
      ? `Controle: ${errors} ${errors === 1 ? 'fout' : 'fouten'}, ${issues.length - errors} waarschuwingen. Bekijk ze bij Beheer > Gegevenscontrole.`
      : `Controle: geen fouten, ${issues.length} ${issues.length === 1 ? 'waarschuwing' : 'waarschuwingen'}.`,
  );
  return lines;
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
  const go = el('button', 'btn-primary migration-go', 'Omzetten') as HTMLButtonElement;
  go.disabled = true;
  check.addEventListener('change', () => (go.disabled = !check.checked));
  go.addEventListener('click', async () => {
    go.disabled = true;
    check.disabled = true;
    status.textContent = 'Bezig met de back-up en het omzetten…';
    try {
      const result = await api.migrateDataFolder();
      const done = el('div', 'migration-done');
      for (const line of migrationSummary(result)) done.append(el('p', '', line));
      if (result.warnings.length) {
        done.append(el('p', '', 'Let op:'));
        const list = el('ul', 'migration-warnings');
        for (const w of result.warnings) list.append(el('li', '', w));
        done.append(list);
      }
      const start = el('button', 'btn-primary', 'Maatwerk starten') as HTMLButtonElement;
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
      // Nothing was changed when the migration refused (migration_blocked).
      status.textContent = `Niet omgezet: ${asFolderError(e).message}`;
      check.disabled = false;
      go.disabled = !check.checked;
    }
  });
  box.append(status, go);
  container.replaceChildren(box);
}
