// SPDX-License-Identifier: AGPL-3.0-or-later

// The main window's side of the editor's AI requests (step 32b, editor/ai-protocol.ts). The
// iframe names a method and its own arguments; the teacher and the opdracht are always the
// logged-in teacher and the opdracht this editor was opened on (U10). No toets or score data
// ever goes into the context (decision 54): the metadata is the opdracht's own fields.

import type { AiApi, AiEvent, ProviderKey } from '../bridge/ai-api';
import type { Json } from '../bridge/api';
import { VAK_LABEL } from '../domain/editor-header';
import type { Observatie, Opdracht } from '../domain/types';
import { ensureAiNotice } from './ai-notice';
import { openAiSettings } from './ai-settings';
import {
  isAiMethod,
  isProviderKey,
  type AiEditorInfo,
  type AiStart,
  type OtherOpdrachtInfo,
} from '../editor/ai-protocol';

/** What a request needs from the main window. */
export interface AiRequestContext {
  ai: AiApi;
  opdracht: Opdracht;
  /** The logged-in teacher's id; null: AI is not available. */
  gebruiker: string | null;
  /** The opdrachten (for "Andere opdrachten") and the observaties of the active vak. */
  opdrachten: Opdracht[];
  observaties: Observatie[];
  /** Renders `opdracht.typ` text as SVG pages (Voorstel bekijken). */
  preview(text: string): Promise<{ pages: string[] } | { error: string }>;
  /** Streams a run's events to the iframe. */
  emit(runId: string, event: AiEvent): void;
  /** The conversation to start with, once (Opdracht toevoegen met AI, Laat AI dit oplossen). */
  takeStart?(): AiStart | null;
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`not allowed: ${what}`);
  return v;
};
const provider = (v: unknown): ProviderKey => {
  if (!isProviderKey(v)) throw new Error('not allowed: provider');
  return v;
};
const record = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`not allowed: ${what}`);
  return v as Record<string, unknown>;
};
const strings = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string'))
    throw new Error(`not allowed: ${what}`);
  return v as string[];
};

const vakLabel = (v: string) => VAK_LABEL[v] ?? v;

function levels(o: Opdracht): string {
  const vakken = (o.vakken ?? []).map(vakLabel).join(', ');
  const jl = [...(o.jaarlagen ?? [])]
    .map(Number)
    .sort((a, b) => a - b)
    .join(', ');
  return [vakken, jl].filter(Boolean).join(' · ');
}

/** Opdrachtgegevens and the other opdrachten (decision 51). */
export function aiEditorInfo(
  ctx: Omit<AiRequestContext, 'ai' | 'preview' | 'emit' | 'takeStart'>,
): AiEditorInfo {
  const o = ctx.opdracht;
  const obsNames = new Map(ctx.observaties.map((x) => [x.id, x.naam ?? x.id]));
  const metadata: Json = {
    titel: o.naam ?? '',
    vakken: (o.vakken ?? []).map(vakLabel),
    schoolsoort: o.schoolsoort ?? [],
    jaarlagen: (o.jaarlagen ?? []).map(String),
    observaties: (o.observaties ?? []).map((id) => obsNames.get(id) ?? id),
  };
  const others: OtherOpdrachtInfo[] = ctx.opdrachten
    .filter((x) => x.id !== o.id)
    .map((x) => ({ id: x.id, naam: x.naam ?? x.id, subtitle: levels(x) }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  return {
    available: ctx.gebruiker !== null,
    metadata,
    vakken: o.vakken ?? [],
    schoolsoort: o.schoolsoort ?? [],
    others,
  };
}

/**
 * The Opdrachtgegevens chip's data as this window builds it, not as the iframe sends it back
 * (review 32 m9): what goes into the workspace does not depend on the iframe. Off (no
 * metadata in the request): none.
 */
function withOwnMetadata(
  request: Record<string, unknown>,
  ctx: Omit<AiRequestContext, 'ai' | 'preview' | 'emit' | 'takeStart'>,
): Record<string, unknown> {
  const context = request.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return request;
  const c = context as Record<string, unknown>;
  const on = c.metadata !== null && c.metadata !== undefined;
  return { ...request, context: { ...c, metadata: on ? aiEditorInfo(ctx).metadata : null } };
}

/** Runs one `maatwerk-ai` request; rejects with "not allowed: ..." for anything unexpected. */
export async function handleAiRequest(
  method: unknown,
  args: unknown,
  ctx: AiRequestContext,
): Promise<unknown> {
  if (!isAiMethod(method) || !Array.isArray(args))
    throw new Error(`not allowed: ${String(method)}`);
  if (method === 'info') {
    const start = ctx.takeStart?.() ?? null;
    return { ...aiEditorInfo(ctx), ...(start ? { start } : {}) };
  }
  const g = ctx.gebruiker;
  if (g === null) throw new Error('Niet ingelogd.');
  const { ai } = ctx;
  const id = ctx.opdracht.id;
  const a = args as unknown[];
  switch (method) {
    case 'detect':
      return ai.detect(g, a[0] === true);
    case 'send': {
      const runId = str(a[0], 'run id');
      const request = withOwnMetadata(record(a[2], 'request'), ctx);
      return ai.send(g, id, provider(a[1]), request as never, (event) => ctx.emit(runId, event));
    }
    case 'stop':
      return ai.stop(id);
    case 'conversations':
      return ai.conversations(g, id);
    case 'conversation':
      return ai.conversation(g, id, provider(a[0]));
    case 'newConversation':
      return ai.newConversation(g, id, provider(a[0]));
    case 'proposal':
      return ai.proposal(g, id, provider(a[0]), record(a[1], 'buffers') as never);
    case 'apply':
      return ai.apply(
        g,
        id,
        provider(a[0]),
        record(a[1], 'buffers') as never,
        record(a[2], 'hunks') as never,
        strings(a[3], 'images'),
      );
    case 'commitImages':
      return ai.commitImages(g, id, provider(a[0]), strings(a[1], 'images'));
    case 'undoImages':
      return ai.undoImages(g, id, provider(a[0]), strings(a[1], 'images'));
    case 'proposalImage':
      return ai.proposalImage(g, id, provider(a[0]), str(a[1], 'path'));
    case 'context':
      return ai.context(g, id);
    case 'saveContext':
      return ai.saveContext(g, id, record(a[0], 'context') as Json);
    case 'syllabusList':
      return ai.syllabusList();
    case 'openSyllabusFolder':
      return ai.openSyllabusFolder();
    case 'pickAttachments':
      return ai.pickAttachments();
    case 'preview':
      return ctx.preview(str(a[0], 'text'));
    case 'openSettings':
      return openAiSettings({ ai, gebruiker: g });
    case 'notice':
      return ensureAiNotice(ai, g);
    case 'hideAssistant': {
      const { settings } = await ai.detect(g, false);
      await ai.saveSettings(g, { ...settings, enabled: false });
      return;
    }
  }
}
