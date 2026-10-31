// SPDX-License-Identifier: AGPL-3.0-or-later

// Beheer > Instellingen (Step 7b): `instellingen.json`, for now the snapshot
// interval and how many snapshots are kept (maatwerk-core::snapshots). The app
// that starts first after the interval writes `snapshots/<datum tijd>.zip` in
// the background; restoring the whole folder is a manual step
// (docs/cutover-runbook.md).

import type { MaatwerkApi } from '../bridge/api';

type Api = Pick<MaatwerkApi, 'listSnapshots'>;

export interface SnapshotSettings {
  intervalHours: number;
  daily: number;
  weekly: number;
  monthly: number;
}

/** maatwerk-core::snapshots::Settings::default. */
export const SNAPSHOT_DEFAULTS: SnapshotSettings = {
  intervalHours: 24,
  daily: 7,
  weekly: 4,
  monthly: 12,
};

/** Allowed ranges, as maatwerk-core::snapshots::Settings::from_json checks them. */
const LIMITS: Record<keyof SnapshotSettings, [number, number]> = {
  intervalHours: [1, 24 * 31],
  daily: [0, 366],
  weekly: [0, 520],
  monthly: [0, 1200],
};

/** The settings in `instellingen.json`, with the defaults for what is missing or out of range. */
export function snapshotSettings(instellingen: unknown): SnapshotSettings {
  const s = (instellingen as { snapshots?: Record<string, unknown> } | null)?.snapshots ?? {};
  const out = { ...SNAPSHOT_DEFAULTS };
  for (const key of Object.keys(LIMITS) as (keyof SnapshotSettings)[]) {
    const v = s[key];
    const [min, max] = LIMITS[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) out[key] = v;
  }
  return out;
}

/** Dutch problem with a value typed in the form, or null. */
export function settingProblem(key: keyof SnapshotSettings, raw: string): string | null {
  const [min, max] = LIMITS[key];
  const n = Number(raw.trim());
  if (!/^\d+$/.test(raw.trim()) || n < min || n > max) {
    return `Vul een heel getal van ${min} tot en met ${max} in.`;
  }
  return null;
}

/** `2026-10-31 0815.zip` -> `31-10-2026 08:15`. */
export function snapshotLabel(name: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})/.exec(name);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : name;
}

interface Store {
  loadInstellingen(): Promise<Record<string, unknown> | null>;
  saveInstellingen(data: Record<string, unknown>, baseRev: number | undefined): Promise<unknown>;
}

const FIELDS: { key: keyof SnapshotSettings; label: string; hint: string }[] = [
  {
    key: 'intervalHours',
    label: 'Nieuwe snapshot na (uren)',
    hint: 'De eerste Maatwerk die daarna start, maakt op de achtergrond een snapshot.',
  },
  { key: 'daily', label: 'Bewaar dagelijkse snapshots (dagen)', hint: '' },
  { key: 'weekly', label: 'Bewaar wekelijkse snapshots (weken)', hint: '' },
  { key: 'monthly', label: 'Bewaar maandelijkse snapshots (maanden)', hint: '' },
];

function el(tag: string, className = '', content = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}

/** Renders the tab into `container`. `toast` shows the outcome of a save. */
export async function renderInstellingen(
  container: HTMLElement,
  api: Api,
  store: Store,
  toast: (message: string, type?: string) => void,
): Promise<void> {
  const [instellingen, snapshots] = await Promise.all([
    store.loadInstellingen(),
    api.listSnapshots().catch(() => [] as string[]),
  ]);
  const current = snapshotSettings(instellingen);
  const baseRev = (instellingen?._meta as { rev?: number } | undefined)?.rev;

  container.replaceChildren();
  const header = el('div', 'screen-header');
  header.append(el('h2', '', 'Instellingen'));
  const box = el('div', 'instellingen');
  box.append(el('h3', 'list-section-header', 'Snapshots'));
  box.append(
    el(
      'p',
      'hint',
      'Een snapshot is een zip van alle gegevens (zonder foto’s en rapporten) in de map ' +
        'snapshots in de gegevensmap. Hij beschermt tegen per ongeluk gewiste of overschreven ' +
        'gegevens, niet tegen het verdwijnen van de hele gedeelde map: gebruik daarvoor ook de ' +
        'versiegeschiedenis van OneDrive.',
    ),
  );

  const inputs = new Map<keyof SnapshotSettings, HTMLInputElement>();
  for (const f of FIELDS) {
    const group = el('div', 'form-group');
    const label = el('label', '', f.label) as HTMLLabelElement;
    label.htmlFor = `inst-${f.key}`;
    const input = document.createElement('input');
    input.id = `inst-${f.key}`;
    input.type = 'number';
    input.min = String(LIMITS[f.key][0]);
    input.max = String(LIMITS[f.key][1]);
    input.value = String(current[f.key]);
    input.className = 'u-w-110';
    inputs.set(f.key, input);
    group.append(label, input);
    if (f.hint) group.append(el('span', 'u-d-block form-hint muted', f.hint));
    box.append(group);
  }
  const save = el('button', 'btn-primary', 'Opslaan') as HTMLButtonElement;
  save.id = 'inst-save';
  const actions = el('div', 'form-actions');
  actions.append(save);
  box.append(actions);

  box.append(el('h3', 'list-section-header', 'Aanwezige snapshots'));
  if (snapshots.length) {
    const list = el('ul', 'snapshot-list');
    for (const name of snapshots) list.append(el('li', '', snapshotLabel(name)));
    box.append(list);
  } else {
    box.append(el('p', 'hint', 'Nog geen snapshots.'));
  }
  container.append(header, box);

  save.addEventListener('click', async () => {
    const next: Partial<SnapshotSettings> = {};
    for (const f of FIELDS) {
      const input = inputs.get(f.key)!;
      const problem = settingProblem(f.key, input.value);
      if (problem) {
        toast(`${f.label}: ${problem}`, 'error');
        input.focus();
        return;
      }
      next[f.key] = Number(input.value.trim());
    }
    save.disabled = true;
    try {
      await store.saveInstellingen(
        { ...(instellingen ?? {}), snapshots: { ...current, ...next } },
        baseRev,
      );
      toast('Instellingen opgeslagen.', 'success');
      await renderInstellingen(container, api, store, toast);
    } catch (e) {
      toast(
        (e as { code?: string }).code === 'conflict'
          ? 'De instellingen zijn intussen door iemand anders gewijzigd en worden opnieuw geladen.'
          : e instanceof Error
            ? e.message
            : String(e),
        'error',
      );
      await renderInstellingen(container, api, store, toast);
    }
  });
}
