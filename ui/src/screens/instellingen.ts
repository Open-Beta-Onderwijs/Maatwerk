// SPDX-License-Identifier: AGPL-3.0-or-later

// Beheer > Instellingen (Step 7b): `instellingen.json`: the snapshot interval
// and how many snapshots are kept (maatwerk-core::snapshots), and since Step 8b
// the editor's compile time limit (maatwerk-core::typst_svc::EditorSettings,
// ADR-0002 section 12). The app that starts first after the interval writes
// `snapshots/<datum tijd>.zip` in the background; restoring the whole folder is
// a manual step (docs/cutover-runbook.md).

import type { MaatwerkApi } from '../bridge/api';

type Api = Pick<MaatwerkApi, 'listSnapshots' | 'openDataFolder'>;

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

/** EditorSettings: `editor.compileTimeoutSeconds`, whole seconds. */
export const COMPILE_TIMEOUT_DEFAULT = 30;
const COMPILE_TIMEOUT_LIMITS: [number, number] = [2, 300];

/** The compile time limit in `instellingen.json`, or the default when missing or out of range. */
export function compileTimeoutSeconds(instellingen: unknown): number {
  const v = (instellingen as { editor?: Record<string, unknown> } | null)?.editor
    ?.compileTimeoutSeconds;
  const [min, max] = COMPILE_TIMEOUT_LIMITS;
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
    ? v
    : COMPILE_TIMEOUT_DEFAULT;
}

/** Dutch problem with a value typed in the form, or null. */
export function settingProblem(
  key: keyof SnapshotSettings | 'compileTimeoutSeconds',
  raw: string,
): string | null {
  const [min, max] = key === 'compileTimeoutSeconds' ? COMPILE_TIMEOUT_LIMITS : LIMITS[key];
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

/** The kind of a kept snapshot (spec 4.9), as maatwerk-core::snapshots::keep chooses them. */
export type SnapshotKind = 'dagelijks' | 'wekelijks' | 'maandelijks';

function snapshotTime(name: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})/.exec(name);
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) : null;
}

/** ISO 8601 week as "year-week" (weeks start on Monday; week 1 holds 4 January). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-${week}`;
}

/**
 * Per snapshot name: dagelijks, wekelijks or maandelijks, the first of these
 * that keeps it (the newest of each of the last `daily` days, `weekly` ISO
 * weeks and `monthly` months); null for one kept only as the newest.
 */
export function snapshotKinds(
  names: string[],
  settings: SnapshotSettings,
): Map<string, SnapshotKind | null> {
  const dated = names
    .map((name) => ({ name, t: snapshotTime(name) }))
    .filter((s): s is { name: string; t: Date } => s.t !== null)
    .sort((a, b) => b.t.getTime() - a.t.getTime());
  const newestPer = (count: number, key: (t: Date) => string) => {
    const seen = new Set<string>();
    const keep = new Set<string>();
    for (const s of dated) {
      if (seen.size >= count) break;
      const k = key(s.t);
      if (!seen.has(k)) {
        seen.add(k);
        keep.add(s.name);
      }
    }
    return keep;
  };
  const daily = newestPer(settings.daily, (t) => t.toDateString());
  const weekly = newestPer(settings.weekly, isoWeek);
  const monthly = newestPer(settings.monthly, (t) => `${t.getFullYear()}-${t.getMonth()}`);
  return new Map(
    names.map((n) => [
      n,
      daily.has(n)
        ? 'dagelijks'
        : weekly.has(n)
          ? 'wekelijks'
          : monthly.has(n)
            ? 'maandelijks'
            : null,
    ]),
  );
}

interface Store {
  loadInstellingen(): Promise<Record<string, unknown> | null>;
  saveInstellingen(data: Record<string, unknown>, baseRev: number | undefined): Promise<unknown>;
}

const FIELDS: { key: keyof SnapshotSettings; label: string; unit: string; hint: string }[] = [
  {
    key: 'intervalHours',
    label: 'Nieuwe snapshot na',
    unit: 'uur',
    hint: 'De eerste Maatwerk die daarna start, maakt op de achtergrond een snapshot.',
  },
  { key: 'daily', label: 'Bewaar dagelijkse', unit: 'dagen', hint: '' },
  { key: 'weekly', label: 'Bewaar wekelijkse', unit: 'weken', hint: '' },
  { key: 'monthly', label: 'Bewaar maandelijkse', unit: 'maanden', hint: '' },
];

const TIMEOUT_LABEL = 'Tijdslimiet voor het compileren';

function el(tag: string, className = '', content = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}

/** A labelled number field with its unit inside (board 12). */
function unitField(
  id: string,
  label: string,
  unit: string,
  value: number,
  [min, max]: [number, number],
  hint: string,
): { group: HTMLElement; input: HTMLInputElement } {
  const group = el('div', 'form-group inst-field');
  const lab = el('label', '', label) as HTMLLabelElement;
  lab.htmlFor = id;
  const wrap = el('span', 'unit-input');
  const input = document.createElement('input');
  input.id = id;
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  wrap.append(input, el('span', 'unit-input__unit', unit));
  group.append(lab, wrap);
  if (hint) group.append(el('span', 'form-hint muted', hint));
  return { group, input };
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
  const timeout = compileTimeoutSeconds(instellingen);
  const baseRev = (instellingen?._meta as { rev?: number } | undefined)?.rev;

  container.replaceChildren();
  // "Opslaan" top right of the screen (spec 4.9).
  const header = el('div', 'screen-header');
  const save = el('button', 'btn btn--primary', 'Opslaan') as HTMLButtonElement;
  save.id = 'inst-save';
  const headerActions = el('div', 'header-actions');
  headerActions.append(save);
  header.append(el('h2', '', 'Instellingen'), headerActions);

  const box = el('div', 'instellingen');
  const left = el('div', 'instellingen-col');

  const snapCard = el('section', 'card inst-card');
  snapCard.append(
    el('h3', 'inst-card__title', 'Snapshots'),
    el(
      'p',
      'hint',
      'Een snapshot is een zip van alle gegevens (zonder foto’s en rapporten) in de map ' +
        'snapshots in de gegevensmap. Hij beschermt tegen per ongeluk gewiste of overschreven ' +
        'gegevens, niet tegen het verdwijnen van de hele gedeelde map: gebruik daarvoor ook de ' +
        'versiegeschiedenis van OneDrive.',
    ),
  );
  const grid = el('div', 'inst-grid');
  const inputs = new Map<keyof SnapshotSettings, HTMLInputElement>();
  for (const f of FIELDS) {
    const { group, input } = unitField(
      `inst-${f.key}`,
      f.label,
      f.unit,
      current[f.key],
      LIMITS[f.key],
      f.hint,
    );
    inputs.set(f.key, input);
    grid.append(group);
  }
  snapCard.append(grid);

  const editorCard = el('section', 'card inst-card');
  const { group: timeoutGroup, input: timeoutInput } = unitField(
    'inst-compileTimeoutSeconds',
    TIMEOUT_LABEL,
    'seconden',
    timeout,
    COMPILE_TIMEOUT_LIMITS,
    'Een opdracht die langer nodig heeft, wordt in de editor afgebroken met een melding. ' +
      `Standaard ${COMPILE_TIMEOUT_DEFAULT} seconden; geldt voor editors die daarna worden geopend.`,
  );
  editorCard.append(el('h3', 'inst-card__title', 'Editor'), timeoutGroup);
  left.append(snapCard, editorCard);

  // Right: the snapshots there are, with their kind, and "Map openen".
  const listCard = el('section', 'card inst-card inst-snapshots');
  const listHead = el('div', 'inst-card__head');
  const openBtn = el('button', 'btn btn--text btn--sm', 'Map openen') as HTMLButtonElement;
  openBtn.addEventListener('click', async () => {
    const problem = await api.openDataFolder('snapshots').catch((e) => String(e));
    if (problem) toast(`Map openen mislukt: ${problem}`, 'error');
  });
  listHead.append(el('h3', 'inst-card__title', 'Aanwezige snapshots'), openBtn);
  listCard.append(listHead);
  if (snapshots.length) {
    const kinds = snapshotKinds(snapshots, current);
    const list = el('ul', 'snapshot-list');
    for (const name of snapshots) {
      const li = el('li');
      li.append(el('span', 'snapshot-date', snapshotLabel(name)));
      const kind = kinds.get(name);
      if (kind) li.append(el('span', 'snapshot-kind', kind));
      list.append(li);
    }
    listCard.append(list);
  } else {
    listCard.append(el('p', 'hint', 'Nog geen snapshots.'));
  }
  box.append(left, listCard);
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
    const timeoutProblem = settingProblem('compileTimeoutSeconds', timeoutInput.value);
    if (timeoutProblem) {
      toast(`${TIMEOUT_LABEL}: ${timeoutProblem}`, 'error');
      timeoutInput.focus();
      return;
    }
    const editor = {
      ...((instellingen?.editor as Record<string, unknown> | undefined) ?? {}),
      compileTimeoutSeconds: Number(timeoutInput.value.trim()),
    };
    save.disabled = true;
    try {
      await store.saveInstellingen(
        { ...(instellingen ?? {}), snapshots: { ...current, ...next }, editor },
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
