// SPDX-License-Identifier: AGPL-3.0-or-later

// Beheer > Gegevenscontrole (Step 7a): the result of `validate-data` on the
// shared folder (ADR-0003 C19, docs/reference/data-files-v2.md). Files changed
// outside Maatwerk can be accepted as they are ("Accepteren"); restoring from a
// snapshot follows with Step 7b.

import type { DataCheck, DataIssue, MaatwerkApi } from '../bridge/api';

type Api = Pick<MaatwerkApi, 'validateDataFolder' | 'acceptStamp'>;

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

function issueTable(check: DataCheck, onAccept: (path: string) => void): HTMLElement {
  const table = el('table', 'gegevens-table');
  const head = el('tr');
  for (const h of ['', 'Soort', 'Bestand', 'Melding', '']) head.append(el('th', '', h));
  const thead = el('thead');
  thead.append(head);
  table.append(thead);
  const body = el('tbody');
  for (const issue of check.issues) {
    const tr = el('tr', `gegevens-${issue.severity}`);
    tr.append(
      el('td', 'gegevens-sev', issue.severity === 'error' ? 'Fout' : 'Let op'),
      el('td', '', KIND_LABEL[issue.kind] ?? issue.kind),
      el('td', 'gegevens-path', issue.path),
      el('td', '', issue.message),
    );
    const action = el('td');
    if (issue.kind === 'stamp') {
      const btn = el('button', 'btn-secondary btn-sm', 'Accepteren') as HTMLButtonElement;
      btn.title = 'Het bestand is goed zoals het nu is';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        onAccept(issue.path);
      });
      action.append(btn);
    }
    tr.append(action);
    body.append(tr);
  }
  table.append(body);
  return table;
}

/** Renders the screen into `container` and runs the check. */
export async function renderGegevens(container: HTMLElement, api: Api): Promise<void> {
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
          issueTable(data, async (path) => {
            try {
              await api.acceptStamp(path);
            } finally {
              await check();
            }
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
  run.addEventListener('click', () => void check());
  await check();
}
