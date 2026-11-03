// SPDX-License-Identifier: AGPL-3.0-or-later

// Beheer > Gegevenscontrole (Step 7a): the result of `validate-data` on the
// shared folder (ADR-0003 C19, docs/reference/data-files-v2.md). Files changed
// outside Maatwerk can be accepted as they are ("Accepteren") or restored from
// the newest snapshot that holds an intact copy (Step 7b).

import type { DataCheck, DataIssue, MaatwerkApi } from '../bridge/api';
import { snapshotLabel } from './instellingen';

type Api = Pick<
  MaatwerkApi,
  'validateDataFolder' | 'acceptStamp' | 'snapshotForFile' | 'restoreFromSnapshot'
>;

/** Asks the admin; resolves true for the confirm button (app.js confirmDialog). */
export type Confirm = (
  message: string,
  opts: { title: string; okLabel: string; danger?: boolean; cancelLabel?: string | null },
) => Promise<boolean>;

const KIND_LABEL: Record<string, string> = {
  version: 'Versie',
  corrupt: 'Onleesbaar',
  stamp: 'Buiten Maatwerk gewijzigd',
  shape: 'Inhoud',
  placement: 'Verkeerde plek',
  reference: 'Verwijzing',
  stray: 'Los bestand',
};

function el(tag: string, className = '', content = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}

/** "3 fouten, 1 waarschuwing" (Dutch counts). */
export function issueCounts(issues: Pick<DataIssue, 'severity'>[]): string {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  if (!issues.length) return 'Geen fouten of waarschuwingen.';
  return [
    `${errors} ${errors === 1 ? 'fout' : 'fouten'}`,
    `${warnings} ${warnings === 1 ? 'waarschuwing' : 'waarschuwingen'}`,
  ].join(', ');
}

/** True when the admin should be told at login: an error or a changed file. */
export function needsAttention(check: DataCheck): boolean {
  return check.issues.some((i) => i.severity === 'error' || i.kind === 'stamp');
}

/** Errors before warnings, otherwise in the order of the check. */
export function sortedIssues<T extends Pick<DataIssue, 'severity'>>(issues: T[]): T[] {
  const rank = (i: T) => (i.severity === 'error' ? 0 : 1);
  return [...issues].sort((a, b) => rank(a) - rank(b));
}

/**
 * The issues as a table. Without `actions` it is read-only (the migration report); with them a
 * changed file gets "Accepteren" and "Herstellen uit snapshot".
 */
export function issueTable(
  check: DataCheck,
  actions?: { onAccept: (path: string) => void; onRestore: (path: string) => void },
): HTMLElement {
  const table = el('table', 'gegevens-table');
  const head = el('tr');
  for (const h of ['', 'Soort', 'Bestand', 'Melding', ...(actions ? [''] : [])]) {
    head.append(el('th', '', h));
  }
  const thead = el('thead');
  thead.append(head);
  table.append(thead);
  const body = el('tbody');
  for (const issue of sortedIssues(check.issues)) {
    const tr = el('tr', `gegevens-${issue.severity}`);
    tr.append(
      el('td', 'gegevens-sev', issue.severity === 'error' ? 'Fout' : 'Let op'),
      el('td', '', KIND_LABEL[issue.kind] ?? issue.kind),
      el('td', 'gegevens-path', issue.path),
      el('td', '', issue.message),
    );
    if (!actions) {
      body.append(tr);
      continue;
    }
    const { onAccept, onRestore } = actions;
    const action = el('td');
    if (issue.kind === 'stamp') {
      const btn = el('button', 'btn-secondary btn-sm', 'Accepteren') as HTMLButtonElement;
      btn.title = 'Het bestand is goed zoals het nu is';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        onAccept(issue.path);
      });
      const restore = el(
        'button',
        'btn-secondary btn-sm',
        'Herstellen uit snapshot',
      ) as HTMLButtonElement;
      restore.title = 'De laatste goede versie uit een snapshot terugzetten';
      restore.addEventListener('click', () => onRestore(issue.path));
      action.append(btn, ' ', restore);
    }
    tr.append(action);
    body.append(tr);
  }
  table.append(body);
  return table;
}

/** Renders the screen into `container` and runs the check. */
export async function renderGegevens(
  container: HTMLElement,
  api: Api,
  confirm: Confirm,
  onRestored: (path: string) => void = () => {},
): Promise<void> {
  const box = el('div', 'gegevens');
  const intro = el(
    'p',
    'hint',
    'Controleert alle bestanden in de gedeelde map: onleesbare bestanden, bestanden die buiten ' +
      'Maatwerk zijn gewijzigd, OneDrive-conflictkopieën en verwijzingen naar iets dat niet ' +
      'bestaat.',
  );
  const run = el('button', 'btn-primary', 'Opnieuw controleren') as HTMLButtonElement;
  const result = el('div', 'gegevens-result');
  box.append(el('h2', '', 'Gegevenscontrole'), intro, run, result);
  container.replaceChildren(box);

  const check = async () => {
    run.disabled = true;
    result.replaceChildren(el('p', 'hint', 'Bezig met controleren…'));
    try {
      const data = await api.validateDataFolder();
      const summary = el(
        'p',
        'gegevens-summary',
        `${data.filesChecked} bestanden gecontroleerd. ${issueCounts(data.issues)}`,
      );
      result.replaceChildren(summary);
      if (data.issues.length) {
        result.append(
          issueTable(data, {
            onAccept: async (path) => {
              try {
                await api.acceptStamp(path);
              } finally {
                await check();
              }
            },
            onRestore: (path) => void restore(path),
          }),
        );
      }
    } catch (e) {
      result.replaceChildren(
        el('p', 'hint', `Controleren mislukt: ${(e as Error)?.message ?? String(e)}`),
      );
    } finally {
      run.disabled = false;
    }
  };
  const restore = async (path: string) => {
    try {
      const snapshot = await api.snapshotForFile(path);
      if (!snapshot) {
        await confirm(`Geen snapshot heeft een goede kopie van ${path}.`, {
          title: 'Herstellen uit snapshot',
          okLabel: 'OK',
          cancelLabel: null,
        });
        return;
      }
      const ok = await confirm(
        `${path} wordt teruggezet naar de versie uit de snapshot van ${snapshotLabel(snapshot)}. ` +
          'Wijzigingen van daarna in dit bestand gaan verloren.',
        { title: 'Herstellen uit snapshot', okLabel: 'Herstellen', danger: true },
      );
      if (!ok) return;
      await api.restoreFromSnapshot(path, snapshot);
      onRestored(path);
    } catch (e) {
      const conflict = (e as { code?: string }).code === 'conflict';
      result.prepend(
        el(
          'p',
          'pin-error',
          conflict
            ? `${path} is intussen via Maatwerk opgeslagen en is niet teruggezet.`
            : `Herstellen mislukt: ${(e as Error)?.message ?? e}`,
        ),
      );
      if (conflict) await check();
      return;
    }
    await check();
  };
  run.addEventListener('click', () => void check());
  await check();
}
