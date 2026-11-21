// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { AiEvent, AiSendRequest } from '../ai-api';
import { MOCK_AI_LINES, MockAi } from './mock-ai';

const request = (text: string): AiSendRequest => ({
  message: 'Voeg iets toe',
  context: { guide: true, diagnostics: false, pdf: false, images: false },
  attachments: [],
  buffers: { 'opdracht.typ': text },
});

describe('MockAi', () => {
  it('detects the installed CLIs', async () => {
    const ai = new MockAi();
    const d = await ai.detect('gebr-1', false);
    expect(d.providers).toHaveLength(6);
    expect(d.providers.filter((p) => p.found).map((p) => p.key)).toEqual(['claude']);
  });

  it('streams a turn, proposes and applies with one hunk', async () => {
    const ai = new MockAi();
    const events: AiEvent[] = [];
    const r = await ai.send('gebr-1', 'opd-1', 'claude', request('a\n'), (e) => events.push(e));
    expect(r.outcome).toBe('proposal');
    expect(events[0]).toEqual({ kind: 'session', id: 'mock-session' });
    const view = await ai.proposal('gebr-1', 'opd-1', 'claude', { 'opdracht.typ': 'x\na\n' });
    expect(view.statuses['opdracht.typ']).toEqual([{ kind: 'clean', at: 2 }]);
    const applied = await ai.apply(
      'gebr-1',
      'opd-1',
      'claude',
      { 'opdracht.typ': 'x\na\n' },
      {
        'opdracht.typ': [0],
      },
    );
    expect(applied.files['opdracht.typ']?.text).toBe(`x\na\n${MOCK_AI_LINES}`);
    const conv = await ai.conversation('gebr-1', 'opd-1', 'claude');
    expect(conv.messages.map((m) => m.fromTeacher)).toEqual([true, false]);
    expect(conv.messages[1]?.run?.applied).toBe(true);
    expect((await ai.conversations('gebr-1', 'opd-1')).open).toEqual(['claude']);
  });

  it('stops a slow turn and refuses a second run', async () => {
    const ai = new MockAi();
    ai.stepDelayMs = 20;
    const turn = ai.send('gebr-1', 'opd-1', 'claude', request(''), () => {});
    await expect(ai.send('gebr-1', 'opd-1', 'codex', request(''), () => {})).rejects.toThrow();
    await ai.stop('opd-1');
    const r = await turn;
    expect(r.outcome).toBe('stopped');
    expect(r.proposal).toBeNull();
  });

  it('never remembers the images chip', async () => {
    const ai = new MockAi();
    await ai.saveContext('gebr-1', 'opd-1', { guide: true, images: true });
    expect(await ai.context('gebr-1', 'opd-1')).toEqual({ guide: true });
  });
});
