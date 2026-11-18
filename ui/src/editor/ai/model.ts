// SPDX-License-Identifier: AGPL-3.0-or-later

// The AI panel's pure parts (step 32b, spec 4.8.1, boards 59-61): context chips and what is
// remembered of them, the syllabus preselection, attachment limits, the transcript built from
// the streamed events, and the texts of the status line, summary row and diff card.

import type { Json } from '../../bridge/api';
import type {
  AiContextRequest,
  AiEvent,
  CheckReport,
  FileProposal,
  Hunk,
  HunkStatus,
  Proposal,
  RunSummary,
  Starter,
  StepKind,
  TranscriptStep,
} from '../../bridge/ai-api';
import { formatNumber } from '../../domain/format';

// ── Context chips (decisions 51, 64) ───────────────────────────────────────

export interface Chips {
  guide: boolean;
  metadata: boolean;
  diagnostics: boolean;
  pdf: boolean;
  /** A syllabus file name; null: "Geen". */
  syllabus: string | null;
  /** At most three opdracht ids (off by default). */
  others: string[];
  /** Never remembered, off after each message. */
  images: boolean;
}

export const MAX_OTHERS = 3;

/** The chips for this opdracht: the remembered ones, else the defaults (decision 51). */
export function chipsFrom(saved: Json | null, preselected: string | null): Chips {
  const s = (saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) as Record<
    string,
    unknown
  >;
  const flag = (k: string) => (typeof s[k] === 'boolean' ? (s[k] as boolean) : true);
  const others = Array.isArray(s.others)
    ? (s.others as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, MAX_OTHERS)
    : [];
  return {
    guide: flag('guide'),
    metadata: flag('metadata'),
    diagnostics: flag('diagnostics'),
    pdf: flag('pdf'),
    syllabus: 'syllabus' in s ? (typeof s.syllabus === 'string' ? s.syllabus : null) : preselected,
    others,
    images: false,
  };
}

/** What is stored per user per opdracht: everything but Afbeeldingen (decision 64). */
export function chipsToSave(chips: Chips): Json {
  return {
    guide: chips.guide,
    metadata: chips.metadata,
    diagnostics: chips.diagnostics,
    pdf: chips.pdf,
    syllabus: chips.syllabus,
    others: chips.others,
  };
}

/** The bridge's context of one message. */
export function contextRequest(chips: Chips, metadata: Json): AiContextRequest {
  return {
    guide: chips.guide,
    metadata: chips.metadata ? metadata : null,
    diagnostics: chips.diagnostics,
    pdf: chips.pdf,
    syllabus: chips.syllabus,
    others: chips.others.slice(0, MAX_OTHERS),
    images: chips.images,
  };
}

// ── Syllabus (decision 52) ─────────────────────────────────────────────────

const VAK_WORDS: Record<string, string[]> = {
  nat: ['natuurkunde', 'nat'],
  bio: ['biologie', 'bio'],
  schk: ['scheikunde', 'schk'],
  wisob: ['wiskunde'],
  wisa: ['wiskunde a', 'wiskunde-a', 'wisa'],
  wisb: ['wiskunde b', 'wiskunde-b', 'wisb'],
  wisc: ['wiskunde c', 'wiskunde-c', 'wisc'],
  wisd: ['wiskunde d', 'wiskunde-d', 'wisd'],
};

const words = (name: string) =>
  ` ${name
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/[_.]+/g, ' ')} `;

function matches(name: string, vakken: string[], schoolsoort: string[]) {
  const w = words(name);
  const vak = vakken.some((v) => (VAK_WORDS[v] ?? [v]).some((x) => w.includes(` ${x} `)));
  const ss = schoolsoort.some((s) => w.includes(` ${s.toLowerCase()} `));
  return { vak, ss };
}

const yearOf = (name: string) => Math.max(0, ...(name.match(/\d{4}/g) ?? []).map(Number));

/** The syllabus whose file name names the vak and the schoolsoort (newest year first). */
export function preselectSyllabus(
  files: string[],
  vakken: string[],
  schoolsoort: string[],
): string | null {
  const fits = files.filter((f) => {
    const m = matches(f, vakken, schoolsoort);
    return m.vak && m.ss;
  });
  fits.sort((a, b) => yearOf(b) - yearOf(a));
  return fits[0] ?? null;
}

/** The listbox subtitle of a syllabus file (board 60). */
export function syllabusSubtitle(
  file: string,
  vakken: string[],
  schoolsoort: string[],
  preselected: string | null,
): string {
  if (file === preselected) return 'Past bij vak en schoolsoort · voorgeselecteerd';
  const m = matches(file, vakken, schoolsoort);
  if (m.vak && m.ss) return 'Past bij vak en schoolsoort';
  if (m.vak) return 'Zelfde vak';
  return 'Ander vak';
}

/** "Natuurkunde havo 2026" for the chip. */
export const syllabusLabel = (file: string) => file.replace(/\.pdf$/i, '');

// ── Attachments (decisions 53, 65) ─────────────────────────────────────────

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
/** Pasted text from this length becomes a "Geplakte tekst" attachment. */
export const PASTE_TEXT_LIMIT = 2000;
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
export const ATTACHMENT_EXTS = [...IMAGE_EXTS, 'pdf', 'txt', 'md', 'typ', 'csv', 'json'];

export const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};

export const isImageName = (name: string) => IMAGE_EXTS.includes(extOf(name));

/** "412 kB", "31,4 MB" (decimal comma). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}

/** Why a file cannot be attached (board 60), or null. */
export function attachmentError(name: string, size: number): string | null {
  if (!ATTACHMENT_EXTS.includes(extOf(name))) return 'dit soort bestand kan niet mee.';
  if (size > MAX_ATTACHMENT_BYTES) return `te groot (${formatSize(size)}; max. 25 MB per bestand).`;
  return null;
}

// ── Transcript (decisions 55, 66) ──────────────────────────────────────────

export interface LiveStep {
  step: StepKind;
  title: string;
  detail: string | null;
  output: string[];
  error: boolean;
  startMs: number;
  /** null while running. */
  endMs: number | null;
}

export interface LiveRun {
  startMs: number;
  steps: LiveStep[];
  /** The AI's streamed answer so far. */
  text: string;
  /** Raw output lines (for "Details kopiëren"). */
  lines: string[];
  /** The latest notice (shown in the status line until the next step). */
  notice: string | null;
}

export const newRun = (now: number): LiveRun => ({
  startMs: now,
  steps: [],
  text: '',
  lines: [],
  notice: null,
});

/** Adds one streamed event to the run (in place; returns it). */
export function addEvent(run: LiveRun, event: AiEvent, now: number): LiveRun {
  const last = run.steps.at(-1);
  switch (event.kind) {
    case 'step':
      if (last && last.endMs === null) last.endMs = now;
      run.steps.push({
        step: event.step,
        title: event.title,
        detail: event.detail,
        output: [],
        error: false,
        startMs: now,
        endMs: null,
      });
      run.notice = null;
      break;
    case 'stepOutput':
      if (last) {
        last.output.push(event.text);
        if (event.error) last.error = true;
      }
      break;
    case 'text':
      run.text += (run.text && !run.text.endsWith('\n') ? '\n' : '') + event.text;
      break;
    case 'output':
      run.lines.push(event.line);
      if (run.lines.length > 200) run.lines.shift();
      break;
    case 'notice':
      run.notice = event.message;
      break;
    case 'session':
      break;
  }
  return run;
}

/** The status line's text: the notice or the current step, else "Start <naam>…". */
export function statusText(run: LiveRun, naam: string): string {
  if (run.notice) return run.notice;
  const last = run.steps.at(-1);
  if (!last) return `Start ${naam}…`;
  return last.title.endsWith('…') ? last.title : `${last.title}…`;
}

/** Closes the steps at the end of a run. */
export function finishRun(run: LiveRun, now: number, failed: boolean): void {
  const last = run.steps.at(-1);
  if (last && last.endMs === null) {
    last.endMs = now;
    if (failed) last.error = true;
  }
}

/** A finished transcript step from history in the live shape (durations unknown). */
export function fromHistory(steps: TranscriptStep[]): LiveStep[] {
  return steps.map((s) => ({
    step: s.step,
    title: s.title,
    detail: s.detail ?? null,
    output: s.output ? [s.output] : [],
    error: s.error,
    startMs: 0,
    endMs: 0,
  }));
}

/** "1:42" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const stappen = (n: number) => (n === 1 ? '1 stap' : `${n} stappen`);

/** The summary row after a run (board 59). */
export function summaryText(run: RunSummary): { text: string; tone: SummaryTone } {
  const t = formatClock(run.elapsedMs);
  const n = run.steps.length;
  switch (run.end) {
    case 'finished':
      return run.proposal
        ? { text: `Klaar in ${t} · ${stappen(n)}`, tone: 'success' }
        : { text: `Klaar in ${t} · geen wijzigingen`, tone: 'success' };
    case 'stopped':
      return { text: `Gestopt na ${t} · ${stappen(n)}`, tone: 'muted' };
    case 'timedOut':
      return { text: `Tijdslimiet bereikt na ${t}`, tone: 'warning' };
    default:
      return { text: `Mislukt na ${t}`, tone: 'danger' };
  }
}
export type SummaryTone = 'success' | 'muted' | 'warning' | 'danger';

/** Plain text of a transcript for "Kopiëren". */
export function transcriptText(command: string, steps: LiveStep[], lines: string[]): string {
  const out = [`Transcript · ${command}`];
  for (const s of steps) {
    out.push(`${s.error ? '✗' : '✓'} ${s.title}`);
    if (s.detail) out.push(`  ${s.detail}`);
    for (const o of s.output) out.push(...o.split('\n').map((l) => `  ${l}`));
  }
  if (lines.length) out.push('', ...lines);
  return out.join('\n');
}

// ── Starters (decision 57) ─────────────────────────────────────────────────

export interface StarterDef {
  key: Starter;
  label: string;
  subtitle: string;
  /** The text it puts in the input (it does not send). */
  text: string;
  /** Selected after filling, for the teacher to replace. */
  select?: string;
}

export function starters(errors: number): StarterDef[] {
  const list: StarterDef[] = [
    {
      key: 'completeAnswers',
      label: 'Antwoorden en punten aanvullen',
      subtitle: 'Antwoordmodel en punten per vraag',
      text: 'Vul bij elke vraag het antwoordmodel en het aantal punten aan waar die ontbreken.',
    },
    {
      key: 'rewrite',
      label: 'Herschrijven voor ander niveau',
      subtitle: 'Andere schoolsoort of jaarlaag',
      text: 'Herschrijf deze opdracht voor (schoolsoort en jaarlaag): eenvoudigere taal, dezelfde opgaven en puntenverdeling.',
      select: '(schoolsoort en jaarlaag)',
    },
    {
      key: 'newOpgave',
      label: 'Nieuwe opgave toevoegen',
      subtitle: 'Over een onderwerp dat jij kiest',
      text: 'Voeg een nieuwe opgave toe over ',
    },
  ];
  if (errors > 0)
    list.unshift({
      key: 'fixErrors',
      label: 'Fouten oplossen',
      subtitle: errors === 1 ? '1 fout in de opdracht' : `${errors} fouten in de opdracht`,
      text: 'Los de fouten en waarschuwingen in deze opdracht op. Verander verder niets aan de inhoud.',
    });
  return list;
}

// ── Diff card and dialog (decisions 56, 68, 69) ────────────────────────────

const wijzigingen = (n: number) => (n === 1 ? '1 wijziging' : `${n} wijzigingen`);
const bestanden = (n: number) => (n === 1 ? '1 bestand' : `${n} bestanden`);
const afbeeldingen = (n: number) => (n === 1 ? '1 afbeelding' : `${n} afbeeldingen`);

export const plusMinus = (f: FileProposal) => ({
  plus: f.hunks.reduce((n, h) => n + h.newLines.length, 0),
  minus: f.hunks.reduce((n, h) => n + h.baseLines.length, 0),
});

/** "4 wijzigingen · 2 bestanden": hunks plus new images; files incl. images and skipped. */
export function proposalHeadline(p: Proposal): string {
  const changes = p.files.reduce((n, f) => n + f.hunks.length, 0) + p.images.length;
  const files = p.files.length + p.images.length + p.skipped.length;
  return `${wijzigingen(changes)} · ${bestanden(files)}`;
}

export const changesPill = (f: FileProposal) => wijzigingen(f.hunks.length);

/** The footer after Toepassen: "Toegepast: 4 wijzigingen en 1 afbeelding". */
export function appliedText(hunks: number, images: number): string {
  const parts = [hunks ? wijzigingen(hunks) : '', images ? afbeeldingen(images) : ''].filter(
    Boolean,
  );
  return `Toegepast: ${parts.join(' en ') || 'niets'}`;
}

/** The skipped-file note: "main.typ: niet toegepast (alleen opdracht.typ en afbeeldingen)". */
export const skippedNote = (path: string) =>
  `${path}: niet toegepast (alleen opdracht.typ en afbeeldingen)`;

/** The diagnostics left after the proposal (amber box), or null when clean. */
export function remainingDiagnostics(check: CheckReport | null): string | null {
  if (!check || check.diagnostics.length === 0) return null;
  const errors = check.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = check.diagnostics.length - errors;
  const head = [
    errors ? (errors === 1 ? '1 fout' : `${errors} fouten`) : '',
    warnings ? (warnings === 1 ? '1 waarschuwing' : `${warnings} waarschuwingen`) : '',
  ]
    .filter(Boolean)
    .join(' en ');
  const first = check.diagnostics[0]!;
  const where = first.location ? `regel ${first.location.line}: ` : '';
  return `${head} ${check.diagnostics.length === 1 ? 'blijft' : 'blijven'} · ${where}${first.message}`;
}

/** Where a hunk is (board 61): "regels 17–18", "regel 8", "na regel 19 · 10 regels erbij". */
export function hunkLocation(h: Hunk): string {
  const from = h.baseStart + 1;
  if (h.baseLines.length === 0) {
    const n = h.newLines.length;
    const erbij = n === 1 ? '1 regel erbij' : `${n} regels erbij`;
    return h.baseStart === 0 ? `aan het begin · ${erbij}` : `na regel ${h.baseStart} · ${erbij}`;
  }
  const to = h.baseStart + h.baseLines.length;
  return from === to ? `regel ${from}` : `regels ${from}–${to}`;
}

/** Checkbox state of a file from its hunks' choices. */
export function triState(chosen: boolean[]): 'on' | 'off' | 'mixed' {
  if (chosen.length === 0 || chosen.every((c) => !c)) return 'off';
  return chosen.every(Boolean) ? 'on' : 'mixed';
}

/** A row of the side-by-side diff: base line (left) and proposed line (right). */
export interface DiffRow {
  left: { n: number; text: string; kind: 'del' | 'same' } | null;
  right: { n: number; text: string; kind: 'add' | 'same' } | null;
}

/** Side by side rows of one hunk: removed lines next to added ones, fillers where uneven. */
export function hunkRows(h: Hunk): DiffRow[] {
  const rows: DiffRow[] = [];
  const max = Math.max(h.baseLines.length, h.newLines.length);
  const strip = (s: string) => s.replace(/\r?\n$/, '');
  for (let i = 0; i < max; i++) {
    const b = h.baseLines[i];
    const a = h.newLines[i];
    rows.push({
      left: b === undefined ? null : { n: h.baseStart + i + 1, text: strip(b), kind: 'del' },
      right: a === undefined ? null : { n: h.baseStart + i + 1, text: strip(a), kind: 'add' },
    });
  }
  return rows;
}

/** A short title for a hunk: its first added non-empty line, else its first removed one. */
export function hunkTitle(h: Hunk, index: number): string {
  const line = [...h.newLines, ...h.baseLines]
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('//'));
  if (!line) return `Wijziging ${index + 1}`;
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

const splitLines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * The text with the chosen hunks applied at their rebased places (as `ai::diff::apply`), for
 * the "Voorstel" preview of the dialog; conflicts are skipped.
 */
export function applyHunks(
  current: string,
  hunks: Hunk[],
  statuses: HunkStatus[],
  chosen: Set<number>,
): string {
  const cur = splitLines(current);
  const todo = hunks
    .map((h, i) => ({ h, s: statuses[i] }))
    .filter(
      (x): x is { h: Hunk; s: { kind: 'clean'; at: number } } =>
        chosen.has(x.h.id) && x.s?.kind === 'clean',
    )
    .sort((a, b) => b.s.at - a.s.at || b.h.id - a.h.id);
  for (const { h, s } of todo) {
    const end = Math.min(s.at + h.baseLines.length, cur.length);
    if (
      end === cur.length &&
      h.baseLines.length === 0 &&
      h.newLines.length > 0 &&
      cur.length > 0 &&
      !cur[cur.length - 1]!.endsWith('\n')
    )
      cur[cur.length - 1] += '\n';
    cur.splice(s.at, end - s.at, ...h.newLines);
  }
  return cur.join('');
}
