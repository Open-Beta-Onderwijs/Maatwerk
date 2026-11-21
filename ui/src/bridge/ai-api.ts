// SPDX-License-Identifier: AGPL-3.0-or-later

// The AI assistant's bridge (step 32a, ADR-0009 as amended, PLAN-2 decisions 48-77):
// `window.maatwerk.ai`. The commands carry JSON in the shapes of
// `maatwerk_core::ai` (serde camelCase); these types mirror them. Everything
// lives in local app data per teacher (`gebruiker`), never in the data folder.

import type { Json } from './api';

export type Builtin = 'claude' | 'codex' | 'gemini' | 'antigravity' | 'vibe' | 'copilot';
/** A built-in key, or `custom-<slug>` for a teacher's own CLI (decision 77). */
export type ProviderKey = Builtin | `custom-${string}`;

/** Install help per CLI (decision 72). */
export interface InstallHelp {
  windows: string;
  unix: string;
  note: string | null;
  url: string;
}

export interface CommandPreset {
  command: string;
  args: string;
  argsNext: string;
}

/** One provider as the rail and AI-instellingen show it. */
export interface AiProvider extends CommandPreset {
  key: ProviderKey;
  name: string;
  builtin: Builtin | null;
  /** The program found; null when not installed. */
  path: string | null;
  version: string | null;
  found: boolean;
  /** The preset ("Standaard herstellen"); null for an own CLI. */
  defaults: CommandPreset | null;
  install: InstallHelp | null;
}

export interface AiPreset extends CommandPreset {
  builtin: Builtin;
  name: string;
  install: InstallHelp;
}

export interface CustomCli {
  key: `custom-${string}`;
  name: string;
  command: string;
  args: string;
  /** Empty: every message is a fresh run with the conversation in the request. */
  argsNext: string;
}

/** The teacher's AI settings on this computer (decision 71). */
export interface AiSettings {
  enabled: boolean;
  /** 1-30 (decision 71). */
  timeLimitMinutes: number;
  /** The first-use notice was confirmed (decision 70). */
  noticeSeen: boolean;
  overrides?: Partial<Record<Builtin, Partial<CommandPreset>>>;
  custom?: CustomCli[];
  [other: string]: unknown;
}

export interface AiDetection {
  providers: AiProvider[];
  settings: AiSettings;
  /** The school's switch in `instellingen.json` (decision 73); false: no AI anywhere. */
  school: boolean;
}

export type StepKind =
  'thinking' | 'read' | 'edit' | 'command' | 'check' | 'search' | 'fetch' | 'tool';

/** The streamed events of a run (status line and transcript, decisions 55, 66). */
export type AiEvent =
  | { kind: 'session'; id: string }
  | { kind: 'step'; step: StepKind; title: string; detail: string | null }
  | { kind: 'stepOutput'; text: string; error: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'output'; line: string; stderr: boolean }
  | { kind: 'notice'; message: string };

/** The starter buttons (decision 57). */
export type Starter = 'fixErrors' | 'completeAnswers' | 'rewrite' | 'newOpgave';

/** The context chips of one message (decisions 51, 64). */
export interface AiContextRequest {
  guide: boolean;
  /** Opdrachtgegevens; never student, toets or score data (decision 54). */
  metadata?: Json | null;
  diagnostics: boolean;
  pdf: boolean;
  /** A file name from `syllabusList()`. */
  syllabus?: string | null;
  /** At most three opdracht ids. */
  others?: string[];
  /** Never remembered (decision 64). */
  images: boolean;
}

/** An attachment: a picked file (token), pasted text, or bytes (drop, pasted image). */
export interface AiAttachmentRequest {
  name: string;
  token?: string;
  text?: string;
  dataBase64?: string;
}

export interface AiSendRequest {
  message: string;
  starter?: Starter | null;
  context: AiContextRequest;
  attachments: AiAttachmentRequest[];
  /** Editor text by file name (`opdracht.typ`, ...). */
  buffers: Record<string, string>;
}

export type Outcome =
  'proposal' | 'noChanges' | 'notLoggedIn' | 'cliError' | 'timedOut' | 'stopped' | 'notFound';

export interface Hunk {
  id: number;
  baseStart: number;
  baseLines: string[];
  newLines: string[];
}

export interface FileProposal {
  path: string;
  base: string;
  proposed: string;
  hunks: Hunk[];
}

export interface ImageProposal {
  /** `images/<name>.<ext>` */
  path: string;
  new: boolean;
  source: string;
}

export interface Proposal {
  files: FileProposal[];
  images: ImageProposal[];
  /** `main.typ`, `lib.typ`, removed images: listed struck through (decision 68). */
  skipped: string[];
}

export interface CheckLocation {
  file: string;
  line: number;
  column: number;
  range: [number, number];
}

/** `docs/schemas/assignment-check.schema.json` (the parts the UI uses). */
export interface CheckReport {
  ok: boolean;
  pageCount: number | null;
  diagnostics: {
    severity: 'error' | 'warning';
    message: string;
    hints: string[];
    location: CheckLocation | null;
  }[];
  checks: string[];
  totalPunten: number;
}

export interface TurnResult {
  outcome: Outcome;
  /** The AI's answer, or the error text. */
  answer: string | null;
  proposal: Proposal | null;
  /** The diagnostics left after the proposal (decision 68). */
  check: CheckReport | null;
  /** The last output lines (CLI-error card, decision 67). */
  tail: string[];
  fixRounds: number;
  elapsedMs: number;
}

export type HunkStatus = { kind: 'clean'; at: number } | { kind: 'conflict' };

export interface ProposalView {
  proposal: Proposal;
  /** Per file, per hunk, against the current editor text. */
  statuses: Record<string, HunkStatus[]>;
}

export interface Applied {
  text: string;
  applied: number[];
  conflicts: number[];
}

export interface ApplyResult {
  files: Record<string, Applied>;
  images: { path: string; new: boolean }[];
}

export interface TranscriptStep {
  step: StepKind;
  title: string;
  detail?: string;
  output?: string;
  error: boolean;
}

export interface RunSummary {
  end: 'finished' | 'failed' | 'timedOut' | 'stopped' | 'startFailed';
  elapsedMs: number;
  steps: TranscriptStep[];
  lines: string[];
  error?: string;
  authFailed: boolean;
  fixRounds: number;
  proposal: boolean;
  applied: boolean;
}

export interface AiMessage {
  fromTeacher: boolean;
  text: string;
  /** ISO 8601 UTC. */
  at: string;
  attachments?: string[];
  starter?: Starter;
  run?: RunSummary;
}

export interface Conversation {
  provider: ProviderKey;
  session?: string;
  messages: AiMessage[];
}

export interface AiConversations {
  /** Providers with a conversation about the opdracht (rail dots, decision 62). */
  open: ProviderKey[];
  /** The provider that runs now, if any (decision 63). */
  running: ProviderKey | null;
}

/** A file chosen with the paperclip (decision 53); `token` goes into `AiAttachmentRequest`. */
export interface PickedAttachment {
  token: string;
  name: string;
  /** Bytes. */
  size: number;
}

export interface SyllabusList {
  folder: string;
  files: string[];
}

export interface AiApi {
  detect(gebruiker: string, refresh: boolean): Promise<AiDetection>;
  saveSettings(gebruiker: string, settings: AiSettings): Promise<AiSettings>;
  /** True/false for CLIs that can tell without a prompt; null otherwise. */
  loginCheck(gebruiker: string, provider: ProviderKey): Promise<boolean | null>;
  /** Runs one turn; events arrive through `onEvent` until the promise settles. */
  send(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
    request: AiSendRequest,
    onEvent: (event: AiEvent) => void,
  ): Promise<TurnResult>;
  stop(opdrachtId: string): Promise<void>;
  conversations(gebruiker: string, opdrachtId: string): Promise<AiConversations>;
  conversation(gebruiker: string, opdrachtId: string, provider: ProviderKey): Promise<Conversation>;
  /** "Nieuw gesprek". */
  newConversation(gebruiker: string, opdrachtId: string, provider: ProviderKey): Promise<void>;
  /** The last proposal, rebased onto `current` (editor text by file name). */
  proposal(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
    current: Record<string, string>,
  ): Promise<ProposalView>;
  /** "Toepassen": the new texts (for one undo step in the editor) and the stored images. */
  apply(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
    current: Record<string, string>,
    hunks: Record<string, number[]>,
    images: string[],
  ): Promise<ApplyResult>;
  /** Ongedaan maken: the applied images back (none: only the history) and "not applied" again. */
  undoImages(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
    images: string[],
  ): Promise<void>;
  proposalImage(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
    path: string,
  ): Promise<string>;
  /** The remembered chips (decision 51); null when none yet. */
  context(gebruiker: string, opdrachtId: string): Promise<Json | null>;
  saveContext(gebruiker: string, opdrachtId: string, context: Json): Promise<void>;
  syllabusList(): Promise<SyllabusList>;
  openSyllabusFolder(): Promise<void>;
  presets(): Promise<AiPreset[]>;
  /** The paperclip's file dialog (images, PDF, text); empty when cancelled. */
  pickAttachments(): Promise<PickedAttachment[]>;
}
