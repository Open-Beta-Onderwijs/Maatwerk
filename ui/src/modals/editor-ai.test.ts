// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { AiEvent, AiSendRequest } from '../bridge/ai-api';
import { MockAi } from '../bridge/mock/mock-ai';
import type { Opdracht } from '../domain/types';
import { createEditorAi } from '../editor/ai/client';
import { aiEditorInfo, handleAiRequest, type AiRequestContext } from './editor-ai';

const opdracht: Opdracht = {
  id: 'opd-1',
  naam: 'Krachten',
  vakken: ['nat'],
  schoolsoort: ['havo'],
  jaarlagen: [4, 3],
  observaties: ['obs-1', 'obs-weg'],
};

function context(ai = new MockAi(), gebruiker: string | null = 'gebr-1') {
  const emitted: { runId: string; event: AiEvent }[] = [];
  const ctx: AiRequestContext = {
    ai,
    opdracht,
    gebruiker,
    opdrachten: [
      opdracht,
      { id: 'opd-2', naam: 'Arbeid', vakken: ['nat', 'schk'], jaarlagen: [3, 2] },
      { id: 'opd-3', naam: 'Atomen', vakken: ['schk'] },
    ],
    observaties: [{ id: 'obs-1', naam: 'Eenheden vergeten' }],
    preview: async (text) => ({ pages: [`<svg>${text.length}</svg>`] }),
    emit: (runId, event) => emitted.push({ runId, event }),
  };
  return { ai, ctx, emitted };
}

const request: AiSendRequest = {
  message: 'Iets',
  context: { guide: true, diagnostics: false, pdf: false, images: false },
  attachments: [],
  buffers: { 'opdracht.typ': 'a\n' },
};

describe('editor AI requests', () => {
  it('builds the opdrachtgegevens and the other opdrachten without this one', () => {
    const info = aiEditorInfo(context().ctx);
    expect(info.available).toBe(true);
    expect(info.metadata).toEqual({
      titel: 'Krachten',
      vakken: ['Natuurkunde'],
      schoolsoort: ['havo'],
      jaarlagen: ['4', '3'],
      observaties: ['Eenheden vergeten', 'obs-weg'],
    });
    expect(info.others).toEqual([
      { id: 'opd-2', naam: 'Arbeid', subtitle: 'Natuurkunde, Scheikunde · 2, 3' },
      { id: 'opd-3', naam: 'Atomen', subtitle: 'Scheikunde' },
    ]);
  });

  it('fills in the teacher and the opdracht of this editor', async () => {
    const { ai, ctx } = context();
    await handleAiRequest('newConversation', ['claude'], ctx);
    expect(ai.calls.at(-1)).toEqual({
      method: 'newConversation',
      args: ['gebr-1', 'opd-1', 'claude'],
    });
  });

  it('refuses unknown methods, bad providers and calls without a teacher', async () => {
    const { ctx } = context();
    await expect(handleAiRequest('saveSettings', [], ctx)).rejects.toThrow('not allowed');
    await expect(handleAiRequest('conversation', ['../x'], ctx)).rejects.toThrow('not allowed');
    await expect(handleAiRequest('apply', ['claude', {}, {}, [1]], ctx)).rejects.toThrow(
      'not allowed',
    );
    const anon = context(new MockAi(), null).ctx;
    expect(((await handleAiRequest('info', [], anon)) as { available: boolean }).available).toBe(
      false,
    );
    await expect(handleAiRequest('conversations', [], anon)).rejects.toThrow('Niet ingelogd');
  });

  it('streams the events of a run to the iframe client with its run id', async () => {
    const { ctx } = context();
    const listeners: ((data: unknown) => void)[] = [];
    ctx.emit = (runId, event) =>
      listeners.forEach((l) => l({ type: 'maatwerk-ai-event', runId, event }));
    const client = createEditorAi(
      (_type, { method, args }) => handleAiRequest(method, args, ctx),
      (l) => listeners.push(l),
    );
    const events: AiEvent[] = [];
    const result = await client.send('claude', request, (e) => events.push(e));
    expect(result.outcome).toBe('proposal');
    expect(events.map((e) => e.kind)).toContain('step');
    expect(await client.preview('abc')).toEqual({ pages: ['<svg>3</svg>'] });
  });

  // Review 32 m9: the workspace gets this window's opdrachtgegevens, whatever the iframe sends.
  it('replaces the metadata the iframe sends with its own, and drops it when off', async () => {
    const { ai, ctx } = context();
    const forged = {
      ...request,
      context: { ...request.context, metadata: { titel: 'Naam Leerling' } },
    };
    await handleAiRequest('send', ['run-1', 'claude', forged], ctx);
    expect(ai.calls.filter((c) => c.method === 'send')).toHaveLength(1);
    const first = ai.calls.find((c) => c.method === 'send')!.args[3] as AiSendRequest;
    expect(first.context.metadata).toEqual(aiEditorInfo(ctx).metadata);
    await handleAiRequest(
      'send',
      ['run-2', 'claude', { ...request, context: { ...request.context, metadata: null } }],
      ctx,
    );
    const second = ai.calls.filter((c) => c.method === 'send')[1]!.args[3] as AiSendRequest;
    expect(second.context.metadata).toBeNull();
  });
});
