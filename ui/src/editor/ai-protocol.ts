// SPDX-License-Identifier: AGPL-3.0-or-later

// The AI assistant's messages between the editor iframe and the main window (step 32b). The
// iframe has no bridge: it names a method of `window.maatwerk.ai` without the teacher and the
// opdracht, and the main window fills those in for the opdracht this editor was opened on and
// the logged-in teacher (U10). A turn's streamed events come back as `maatwerk-ai-event` with
// the run id the iframe chose.

import type { Json } from '../bridge/api';
import type { AiEvent, ProviderKey, Starter } from '../bridge/ai-api';

/** The methods the editor may call, with the arguments it passes (no gebruiker, no opdracht). */
export const AI_METHODS = [
  'info',
  'detect',
  'send',
  'stop',
  'conversations',
  'conversation',
  'newConversation',
  'proposal',
  'apply',
  'commitImages',
  'undoImages',
  'proposalImage',
  'context',
  'saveContext',
  'syllabusList',
  'openSyllabusFolder',
  'pickAttachments',
  'preview',
  // Step 32c: dialogs of the main window and the install help's "AI-assistent verbergen".
  'openSettings',
  'notice',
  'hideAssistant',
] as const;
export type AiMethod = (typeof AI_METHODS)[number];

export function isAiMethod(v: unknown): v is AiMethod {
  return typeof v === 'string' && (AI_METHODS as readonly string[]).includes(v);
}

/** A provider key as the bridge knows them (`claude`, `custom-<slug>`). */
export function isProviderKey(v: unknown): v is ProviderKey {
  return typeof v === 'string' && /^(?:[a-z]+|custom-[a-z0-9-]+)$/.test(v);
}

/** Another opdracht for "Andere opdrachten" (decision 51). */
export interface OtherOpdrachtInfo {
  id: string;
  naam: string;
  /** "Natuurkunde · 2, 3" */
  subtitle: string;
}

/**
 * A conversation the editor starts with (step 32c, decisions 74, 75): Opdracht toevoegen "met
 * AI" sends the description at once; "Laat AI dit oplossen" only fills the input and attaches
 * the error. Given once, on the first `info` after the editor opened.
 */
export interface AiStart {
  provider: ProviderKey;
  message: string;
  starter?: Starter;
  /** Text attachments (`Foutmelding genereren`). */
  attachments?: { name: string; text: string }[];
  /** True: send at once; false: the teacher sends it. */
  send: boolean;
}

/** What the panel needs from the main window (`info`). */
export interface AiEditorInfo {
  /** False without a logged-in teacher: no rail. */
  available: boolean;
  /** Opdrachtgegevens (decision 51): title, vak, schoolsoort, jaarlagen, linked observaties. */
  metadata: Json;
  vakken: string[];
  schoolsoort: string[];
  others: OtherOpdrachtInfo[];
  start?: AiStart;
}

/** `maatwerk-ai` request. */
export interface AiRequestMessage {
  type: 'maatwerk-ai';
  method: AiMethod;
  args: unknown[];
}

/** A streamed event of the run `runId` (`send`'s first argument). */
export interface AiEventMessage {
  type: 'maatwerk-ai-event';
  runId: string;
  event: AiEvent;
}
