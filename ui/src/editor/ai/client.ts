// SPDX-License-Identifier: AGPL-3.0-or-later

// The editor iframe's view of `window.maatwerk.ai` (step 32b): every call goes to the main
// window as `maatwerk-ai` (editor/ai-protocol.ts), which adds the teacher and the opdracht.
// A turn's events arrive as `maatwerk-ai-event` for the run id chosen here.

import type { Json } from '../../bridge/api';
import type {
  AiConversations,
  AiDetection,
  AiEvent,
  AiSendRequest,
  ApplyResult,
  Conversation,
  PickedAttachment,
  ProposalView,
  ProviderKey,
  SyllabusList,
  TurnResult,
} from '../../bridge/ai-api';
import type { AiEditorInfo, AiEventMessage, AiMethod } from '../ai-protocol';

/** Sends a request to the main window and resolves with its answer. */
export type Ask = (
  type: 'maatwerk-ai',
  data: { method: AiMethod; args: unknown[] },
) => Promise<unknown>;

export interface EditorAi {
  info(): Promise<AiEditorInfo>;
  detect(refresh?: boolean): Promise<AiDetection>;
  loginCheck(provider: ProviderKey): Promise<boolean | null>;
  send(
    provider: ProviderKey,
    request: AiSendRequest,
    onEvent: (event: AiEvent) => void,
  ): Promise<TurnResult>;
  stop(): Promise<void>;
  conversations(): Promise<AiConversations>;
  conversation(provider: ProviderKey): Promise<Conversation>;
  newConversation(provider: ProviderKey): Promise<void>;
  proposal(provider: ProviderKey, current: Record<string, string>): Promise<ProposalView>;
  apply(
    provider: ProviderKey,
    current: Record<string, string>,
    hunks: Record<string, number[]>,
    images: string[],
  ): Promise<ApplyResult>;
  commitImages(provider: ProviderKey, images: string[]): Promise<{ path: string; new: boolean }[]>;
  undoImages(provider: ProviderKey, images: string[]): Promise<void>;
  proposalImage(provider: ProviderKey, path: string): Promise<string>;
  context(): Promise<Json | null>;
  saveContext(context: Json): Promise<void>;
  syllabusList(): Promise<SyllabusList>;
  openSyllabusFolder(): Promise<void>;
  pickAttachments(): Promise<PickedAttachment[]>;
  /** SVG pages of `opdracht.typ` text, or the compile error. */
  preview(text: string): Promise<{ pages: string[] } | { error: string }>;
  /** AI-instellingen in the main window; true after Opslaan. */
  openSettings(): Promise<boolean>;
  /** The first-use notice when it was not seen yet; false when closed without Begrepen. */
  notice(): Promise<boolean>;
  /** "AI-assistent verbergen": the teacher's switch off. */
  hideAssistant(): Promise<void>;
}

let runSeq = 0;

/**
 * The client over `ask`. `listen` subscribes to the window's messages (only the app's own
 * origin may post them, as for the other answers).
 */
export function createEditorAi(
  ask: Ask,
  listen: (handler: (data: unknown) => void) => void,
): EditorAi {
  const runs = new Map<string, (event: AiEvent) => void>();
  listen((data) => {
    const msg = data as AiEventMessage | null;
    if (msg?.type !== 'maatwerk-ai-event' || typeof msg.runId !== 'string') return;
    runs.get(msg.runId)?.(msg.event);
  });
  const call = <T>(method: AiMethod, ...args: unknown[]) =>
    ask('maatwerk-ai', { method, args }) as Promise<T>;
  return {
    info: () => call('info'),
    detect: (refresh = false) => call('detect', refresh),
    loginCheck: (p) => call('loginCheck', p),
    async send(p, request, onEvent) {
      const runId = `run-${Date.now()}-${++runSeq}`;
      runs.set(runId, onEvent);
      try {
        return await call<TurnResult>('send', runId, p, request);
      } finally {
        runs.delete(runId);
      }
    },
    stop: () => call('stop'),
    conversations: () => call('conversations'),
    conversation: (p) => call('conversation', p),
    newConversation: (p) => call('newConversation', p),
    proposal: (p, current) => call('proposal', p, current),
    apply: (p, current, hunks, images) => call('apply', p, current, hunks, images),
    commitImages: (p, images) => call('commitImages', p, images),
    undoImages: (p, images) => call('undoImages', p, images),
    proposalImage: (p, path) => call('proposalImage', p, path),
    context: () => call('context'),
    saveContext: (context) => call('saveContext', context),
    syllabusList: () => call('syllabusList'),
    openSyllabusFolder: () => call('openSyllabusFolder'),
    pickAttachments: () => call('pickAttachments'),
    preview: (text) => call('preview', text),
    openSettings: () => call('openSettings'),
    notice: () => call('notice'),
    hideAssistant: () => call('hideAssistant'),
  };
}
