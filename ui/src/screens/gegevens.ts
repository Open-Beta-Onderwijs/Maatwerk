// SPDX-License-Identifier: AGPL-3.0-or-later

// Beheer > Gegevenscontrole (Step 7a): the result of `validate-data` on the
// shared folder (ADR-0003 C19, docs/reference/data-files-v2.md). Files changed
// outside Maatwerk can be accepted as they are ("Accepteren") or restored from
// the newest snapshot that holds an intact copy (Step 7b).

import type { DataCheck, DataIssue, MaatwerkApi } from '../bridge/api';
import { snapshotLabel } from './instellingen';

type Api = Pick<
  MaatwerkApi,
  'validateDataFolder' | 'acceptStamp' | 'snapshotForFile' | 'restoreFromSnapshot' | 'openPath'
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
      const btn = el('button', 'btn btn--secondary btn--sm', 'Accepteren') as HTMLButtonElement;
      btn.title = 'Het bestand is goed zoals het nu is';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        onAccept(issue.path);
      });
      const restore = el(
        'button',
        'btn btn--secondary btn--sm',
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

/** The folder of a data-relative path ('' for a file at the top). */
export function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** "238 bestanden gecontroleerd · vandaag om 11:18" (board 12). */
export function checkedLine(filesChecked: number, at: Date): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${filesChecked} ${filesChecked === 1 ? 'bestand' : 'bestanden'} gecontroleerd · vandaag om ${hh}:${mm}`;
}

interface CardActions {
  onAccept: (path: string) => void;
  onRestore: (path: string) => void;
  onOpenFolder: (path: string) => void;
}

/**
 * The findings as cards (design spec 4.9, board 12): a FOUT / WAARSCHUWING
 * pill, the message, the path and the actions. A file changed outside
 * Maatwerk: "Accepteren" and "Herstellen uit snapshot"; every finding: "Map openen".
 */
export function issueCards(check: DataCheck, at: Date, actions: CardActions): HTMLElement {
  const wrap = el('div', 'gegevens-cards');
  const errors = check.issues.filter((i) => i.severity === 'error').length;
  const warnings = check.issues.length - errors;
  const head = el('div', 'gegevens-summary', checkedLine(check.filesChecked, at));
  if (errors)
    head.append(
      ' ',
      el('span', 'pill pill--danger', `${errors} ${errors === 1 ? 'fout' : 'fouten'}`),
    );
  if (warnings)
    head.append(
      ' ',
      el(
        'span',
        'pill pill--amber',
        `${warnings} ${warnings === 1 ? 'waarschuwing' : 'waarschuwingen'}`,
      ),
    );
  wrap.append(head);
  for (const issue of sortedIssues(check.issues)) {
    const card = el('div', `card gegevens-card gegevens-${issue.severity}`);
    const error = issue.severity === 'error';
    const pill = el(
      'span',
      `pill ${error ? 'pill--danger' : 'pill--amber'}`,
      error ? 'FOUT' : 'WAARSCHUWING',
    );
    const text = el('div', 'gegevens-card-text');
    const kind = KIND_LABEL[issue.kind];
    text.append(
      el('span', 'gegevens-card-msg', kind ? `${kind}: ${issue.message}` : issue.message),
      el('span', 'gegevens-path', issue.path),
    );
    const buttons = el('div', 'gegevens-card-actions');
    const button = (label: string, title: string, fn: (b: HTMLButtonElement) => void) => {
      const b = el('button', 'btn btn--secondary btn--sm', label) as HTMLButtonElement;
      b.title = title;
      b.addEventListener('click', () => fn(b));
      buttons.append(b);
    };
    if (issue.kind === 'stamp') {
      button('Accepteren', 'Het bestand is goed zoals het nu is', (b) => {
        b.disabled = true;
        actions.onAccept(issue.path);
      });
      button(
        'Herstellen uit snapshot',
        'De laatste goede versie uit een snapshot terugzetten',
        () => actions.onRestore(issue.path),
      );
    }
    button('Map openen', 'De map met dit bestand openen', () => actions.onOpenFolder(issue.path));
    card.append(pill, text, buttons);
    wrap.append(card);
  }
  return wrap;
}

/** The green card of a clean check (board 12). */
function cleanCard(check: DataCheck, at: Date): HTMLElement {
  const card = el('div', 'card gegevens-clean');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '22');
  icon.setAttribute('height', '22');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML =
    '<path d="M12 3 4.5 6v6c0 4.4 3.2 7.9 7.5 9 4.3-1.1 7.5-4.6 7.5-9V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  const text = el('div', 'gegevens-clean-text');
  text.append(
    el('b', 'gegevens-summary', 'Geen fouten of waarschuwingen'),
    el('span', '', checkedLine(check.filesChecked, at)),
  );
  card.append(icon, text);
  return card;
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
  const run = el('button', 'btn btn--secondary', 'Opnieuw controleren') as HTMLButtonElement;
  const top = el('div', 'gegevens-intro');
  top.append(intro, run);
  const result = el('div', 'gegevens-result');
  const header = el('div', 'screen-header');
  header.append(el('h2', '', 'Gegevenscontrole'));
  box.append(header, top, result);
  container.replaceChildren(box);

  const check = async () => {
    run.disabled = true;
    result.replaceChildren(el('p', 'hint', 'Bezig met controleren…'));
    try {
      const data = await api.validateDataFolder();
      const at = new Date();
      if (!data.issues.length) {
        result.replaceChildren(cleanCard(data, at));
        return;
      }
      result.replaceChildren(
        issueCards(data, at, {
          onAccept: async (path) => {
            try {
              await api.acceptStamp(path);
            } finally {
              await check();
            }
          },
          onRestore: (path) => void restore(path),
          onOpenFolder: (path) => void openFolder(path),
        }),
      );
    } catch (e) {
      result.replaceChildren(
        el('p', 'hint', `Controleren mislukt: ${(e as Error)?.message ?? String(e)}`),
      );
    } finally {
      run.disabled = false;
    }
  };
  const openFolder = async (path: string) => {
    const problem = await api.openPath(folderOf(path)).catch((e) => String(e));
    if (problem) result.prepend(el('p', 'pin-error', `Map openen mislukt: ${problem}`));
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
