// SPDX-License-Identifier: AGPL-3.0-or-later

// AI-instellingen (board 62, decisions 71 and 77): the pure parts. The dialog edits a copy of
// the providers' command fields; on Opslaan this turns them back into `AiSettings`, keeping only
// what differs from a preset as an override and every field the dialog does not know.

import type {
  AiProvider,
  AiSettings,
  Builtin,
  CommandPreset,
  CustomCli,
} from '../../bridge/ai-api';

/** One built-in CLI's fields as the dialog edits them. */
export interface BuiltinRow extends CommandPreset {
  builtin: Builtin;
  defaults: CommandPreset;
}

/** The time limit's range in minutes (maatwerk_core::ai::provider::TIME_LIMIT_RANGE). */
export const MINUTES: [number, number] = [1, 30];

/** The placeholders an argument string may use (maatwerk_core::ai::provider::PLACEHOLDERS). */
export const PLACEHOLDERS = [
  'prompt',
  'request',
  'workdir',
  'session',
  'check',
  'images',
  'run',
  'secs',
] as const;

export function rowOf(p: AiProvider): BuiltinRow | null {
  if (!p.builtin || !p.defaults) return null;
  return {
    builtin: p.builtin,
    command: p.command,
    args: p.args,
    argsNext: p.argsNext,
    defaults: p.defaults,
  };
}

/** "aangepast" when any field differs from the preset (board 62). */
export function isCustomized(row: BuiltinRow): boolean {
  return (
    row.command !== row.defaults.command ||
    row.args !== row.defaults.args ||
    row.argsNext !== row.defaults.argsNext
  );
}

/** Dutch problem with the minutes typed, or null. */
export function minutesProblem(raw: string): string | null {
  const t = raw.trim();
  const n = Number(t);
  const [min, max] = MINUTES;
  return /^\d+$/.test(t) && n >= min && n <= max
    ? null
    : `Vul een heel getal van ${min} tot en met ${max} in.`;
}

/** Dutch problem with an argument string (unknown placeholder, open quote), or null. */
export function argsProblem(args: string): string | null {
  // As maatwerk_core::ai::provider::split_args: '...' literal, "..." with \" and \\.
  let quote: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      if (quote === '"' && c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    }
  }
  if (quote) return `Een ${quote} wordt niet gesloten.`;
  // Only {lowercase} counts as a placeholder (`fill`); other braces are plain text.
  for (const m of args.matchAll(/\{([a-z]+)\}/g)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(m[1]!)) {
      return `Onbekende plaatshouder {${m[1]}}.`;
    }
  }
  return null;
}

/** Dutch problem with an own CLI, or null. */
export function customProblem(c: CustomCli): string | null {
  if (!c.name.trim()) return 'Geef het programma een naam.';
  if (!c.command.trim()) return `${c.name.trim()}: vul de opdracht in.`;
  return argsProblem(c.args) ?? argsProblem(c.argsNext);
}

/** `custom-<slug>` for a new own CLI: lower-case ASCII, digits and dashes, unique. */
export function customKey(name: string, taken: readonly string[]): `custom-${string}` {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'cli';
  let key: `custom-${string}` = `custom-${base}`;
  for (let n = 2; taken.includes(key); n++) key = `custom-${base}-${n}`;
  return key;
}

/**
 * The settings to save: `original` with the dialog's values. A built-in row's override keeps
 * only the fields that differ from the preset; a row equal to its preset has none.
 */
export function settingsToSave(
  original: AiSettings,
  values: {
    enabled: boolean;
    minutes: number;
    rows: readonly BuiltinRow[];
    custom: readonly CustomCli[];
  },
): AiSettings {
  const overrides: NonNullable<AiSettings['overrides']> = { ...(original.overrides ?? {}) };
  for (const row of values.rows) {
    const o: Partial<CommandPreset> = {};
    if (row.command !== row.defaults.command) o.command = row.command;
    if (row.args !== row.defaults.args) o.args = row.args;
    if (row.argsNext !== row.defaults.argsNext) o.argsNext = row.argsNext;
    if (Object.keys(o).length) overrides[row.builtin] = o;
    else delete overrides[row.builtin];
  }
  const out: AiSettings = {
    ...original,
    enabled: values.enabled,
    timeLimitMinutes: values.minutes,
    overrides,
    custom: values.custom.map((c) => ({
      key: c.key,
      name: c.name.trim(),
      command: c.command.trim(),
      args: c.args.trim(),
      argsNext: c.argsNext.trim(),
    })),
  };
  if (!Object.keys(overrides).length) delete out.overrides;
  if (!out.custom!.length) delete out.custom;
  return out;
}

/** The arguments a new own CLI starts with (plain-text output, decision 77). */
export const CUSTOM_DEFAULT_ARGS = '{prompt}';
