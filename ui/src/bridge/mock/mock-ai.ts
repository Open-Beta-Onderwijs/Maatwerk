// SPDX-License-Identifier: AGPL-3.0-or-later

// `window.maatwerk.ai` in the mock build and the UI tests (decision 61: a scripted
// fake instead of a real CLI). Claude Code is "installed"; a turn streams a few
// events and proposes to append lines to opdracht.typ. Tests script the next turn
// through `nextTurn`, or slow it down with `stepDelayMs` to try Stop.

import type { Json } from '../api';
import type {
  AiApi,
  AiConversations,
  AiDetection,
  AiEvent,
  AiPreset,
  AiProvider,
  AiSendRequest,
  AiSettings,
  ApplyResult,
  Builtin,
  Conversation,
  HunkStatus,
  Proposal,
  ProposalView,
  PickedAttachment,
  ProviderKey,
  SyllabusList,
  TurnResult,
} from '../ai-api';

const PRESETS: AiPreset[] = (
  [
    ['claude', 'Claude Code', 'claude'],
    ['codex', 'Codex', 'codex'],
    ['gemini', 'Gemini CLI', 'gemini'],
    ['antigravity', 'Antigravity', 'agy'],
    ['vibe', 'Mistral Vibe', 'vibe'],
    ['copilot', 'GitHub Copilot', 'copilot'],
  ] as [Builtin, string, string][]
).map(([builtin, name, command]) => ({
  builtin,
  name,
  command,
  args: '-p {prompt}',
  argsNext: '-p {prompt} --resume {session}',
  install: { windows: `install ${command}`, unix: `install ${command}`, note: null, url: '' },
}));

/** The lines the default mock turn appends to opdracht.typ. */
export const MOCK_AI_LINES = '\n// Voorgesteld door de AI (mock)\n';

/** What a scripted turn does. */
export interface MockTurn {
  events?: AiEvent[];
  /** Appended to opdracht.typ (a proposal); empty: no changes. */
  append?: string;
  answer?: string;
  outcome?: TurnResult['outcome'];
}

const defaultSettings = (): AiSettings => ({
  enabled: true,
  timeLimitMinutes: 5,
  noticeSeen: false,
});

export class MockAi implements AiApi {
  /** Builtins that count as installed. */
  installed: Builtin[] = ['claude'];
  /** The next turn's script; consumed by `send`. */
  nextTurn: MockTurn | null = null;
  /** What the next paperclip dialog returns (consumed). */
  nextPick: PickedAttachment[] = [];
  /** Delay between streamed events (ms). */
  stepDelayMs = 0;
  readonly calls: { method: string; args: unknown[] }[] = [];
  private settings = new Map<string, AiSettings>();
  private conversationsBy = new Map<string, Conversation>();
  private proposals = new Map<string, { base: string; append: string }>();
  private contexts = new Map<string, Json>();
  private running = new Map<string, { provider: ProviderKey; stop: boolean }>();

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  async detect(gebruiker: string, refresh: boolean): Promise<AiDetection> {
    this.record('detect', [gebruiker, refresh]);
    const settings = this.settings.get(gebruiker) ?? defaultSettings();
    const providers: AiProvider[] = PRESETS.map((p) => {
      const found = this.installed.includes(p.builtin);
      const o = settings.overrides?.[p.builtin] ?? {};
      return {
        key: p.builtin,
        name: p.name,
        builtin: p.builtin,
        command: o.command ?? p.command,
        args: o.args ?? p.args,
        argsNext: o.argsNext ?? p.argsNext,
        path: found ? `/mock/bin/${p.command}` : null,
        version: found ? `${p.command} 1.0 (mock)` : null,
        found,
        defaults: { command: p.command, args: p.args, argsNext: p.argsNext },
        install: p.install,
      };
    });
    for (const c of settings.custom ?? []) {
      providers.push({
        ...c,
        builtin: null,
        path: null,
        version: null,
        found: false,
        defaults: null,
        install: null,
      });
    }
    return { providers, settings };
  }

  async saveSettings(gebruiker: string, settings: AiSettings): Promise<AiSettings> {
    this.record('saveSettings', [gebruiker, settings]);
    if (settings.timeLimitMinutes < 1 || settings.timeLimitMinutes > 30) {
      throw new Error('De tijdslimiet is 1 tot 30 minuten.');
    }
    this.settings.set(gebruiker, structuredClone(settings));
    return settings;
  }

  async loginCheck(): Promise<boolean | null> {
    return true;
  }

  private convKey(gebruiker: string, opdrachtId: string, provider: string): string {
    return `${gebruiker}/${opdrachtId}/${provider}`;
  }

  private conv(gebruiker: string, opdrachtId: string, provider: ProviderKey): Conversation {
    const k = this.convKey(gebruiker, opdrachtId, provider);
    let c = this.conversationsBy.get(k);
    if (!c) {
      c = { provider, messages: [] };
      this.conversationsBy.set(k, c);
    }
    return c;
  }

  async send(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
    request: AiSendRequest,
    onEvent: (event: AiEvent) => void,
  ): Promise<TurnResult> {
    this.record('send', [gebruiker, opdrachtId, provider, request]);
    if (this.running.has(opdrachtId)) {
      throw new Error('Er loopt al een AI-opdracht voor deze opdracht.');
    }
    const run = { provider, stop: false };
    this.running.set(opdrachtId, run);
    const script = this.nextTurn ?? {};
    this.nextTurn = null;
    const conv = this.conv(gebruiker, opdrachtId, provider);
    conv.messages.push({
      fromTeacher: true,
      text: request.message,
      at: new Date().toISOString(),
      attachments: request.attachments.map((a) => a.name),
      ...(request.starter ? { starter: request.starter } : {}),
    });
    const events: AiEvent[] = script.events ?? [
      { kind: 'session', id: 'mock-session' },
      { kind: 'step', step: 'read', title: 'Lezen: opdracht.typ', detail: null },
      { kind: 'step', step: 'edit', title: 'Bestand bewerken: opdracht.typ', detail: null },
      { kind: 'step', step: 'check', title: 'Opdracht controleren', detail: null },
      { kind: 'stepOutput', text: '{"ok": true}', error: false },
      { kind: 'text', text: 'Ik heb een regel toegevoegd.' },
    ];
    const started = Date.now();
    try {
      for (const e of events) {
        if (this.stepDelayMs) await new Promise((r) => setTimeout(r, this.stepDelayMs));
        if (run.stop) break;
        onEvent(e);
      }
      const append = script.append ?? MOCK_AI_LINES;
      const outcome: TurnResult['outcome'] = run.stop
        ? 'stopped'
        : (script.outcome ?? (append ? 'proposal' : 'noChanges'));
      const base = request.buffers['opdracht.typ'] ?? '';
      let proposal: Proposal | null = null;
      if (outcome === 'proposal') {
        this.proposals.set(this.convKey(gebruiker, opdrachtId, provider), { base, append });
        proposal = mockProposal(base, append);
      }
      const answer = run.stop ? null : (script.answer ?? 'Ik heb een regel toegevoegd.');
      conv.messages.push({
        fromTeacher: false,
        text: answer ?? '',
        at: new Date().toISOString(),
        run: {
          end: run.stop ? 'stopped' : outcome === 'cliError' ? 'failed' : 'finished',
          elapsedMs: Date.now() - started,
          steps: [],
          lines: [],
          authFailed: outcome === 'notLoggedIn',
          fixRounds: 0,
          proposal: proposal !== null,
          applied: false,
        },
      });
      return {
        outcome,
        answer,
        proposal,
        check: proposal
          ? { ok: true, pageCount: 1, diagnostics: [], checks: [], totalPunten: 0 }
          : null,
        tail: [],
        fixRounds: 0,
        elapsedMs: Date.now() - started,
      };
    } finally {
      this.running.delete(opdrachtId);
    }
  }

  async stop(opdrachtId: string): Promise<void> {
    this.record('stop', [opdrachtId]);
    const run = this.running.get(opdrachtId);
    if (run) run.stop = true;
  }

  async conversations(gebruiker: string, opdrachtId: string): Promise<AiConversations> {
    const prefix = `${gebruiker}/${opdrachtId}/`;
    const open = [...this.conversationsBy.entries()]
      .filter(([k, c]) => k.startsWith(prefix) && c.messages.length > 0)
      .map(([, c]) => c.provider);
    return { open, running: this.running.get(opdrachtId)?.provider ?? null };
  }

  async conversation(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
  ): Promise<Conversation> {
    return structuredClone(this.conv(gebruiker, opdrachtId, provider));
  }

  async newConversation(gebruiker: string, opdrachtId: string, provider: ProviderKey) {
    this.record('newConversation', [gebruiker, opdrachtId, provider]);
    const k = this.convKey(gebruiker, opdrachtId, provider);
    this.conversationsBy.delete(k);
    this.proposals.delete(k);
  }

  private saved(gebruiker: string, opdrachtId: string, provider: ProviderKey) {
    const p = this.proposals.get(this.convKey(gebruiker, opdrachtId, provider));
    if (!p) throw new Error('Er is geen voorstel (meer).');
    return p;
  }

  async proposal(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
    current: Record<string, string>,
  ): Promise<ProposalView> {
    const { base, append } = this.saved(gebruiker, opdrachtId, provider);
    const status = appendStatus(base, current['opdracht.typ'] ?? base);
    return { proposal: mockProposal(base, append), statuses: { 'opdracht.typ': [status] } };
  }

  async apply(
    gebruiker: string,
    opdrachtId: string,
    provider: ProviderKey,
    current: Record<string, string>,
    hunks: Record<string, number[]>,
  ): Promise<ApplyResult> {
    this.record('apply', [gebruiker, opdrachtId, provider, current, hunks]);
    const { base, append } = this.saved(gebruiker, opdrachtId, provider);
    const text = current['opdracht.typ'] ?? base;
    const chosen = hunks['opdracht.typ']?.includes(0) ?? false;
    const status = appendStatus(base, text);
    const ok = chosen && status.kind === 'clean';
    const conv = this.conv(gebruiker, opdrachtId, provider);
    const last = [...conv.messages].reverse().find((m) => m.run?.proposal);
    if (last?.run && ok) last.run.applied = true;
    return {
      files: {
        'opdracht.typ': {
          text: ok ? text + append : text,
          applied: ok ? [0] : [],
          conflicts: chosen && !ok ? [0] : [],
        },
      },
      images: [],
    };
  }

  async undoImages(): Promise<void> {}

  async proposalImage(): Promise<string> {
    return 'data:image/png;base64,';
  }

  async context(gebruiker: string, opdrachtId: string): Promise<Json | null> {
    return this.contexts.get(`${gebruiker}/${opdrachtId}`) ?? null;
  }

  async saveContext(gebruiker: string, opdrachtId: string, context: Json): Promise<void> {
    const copy = structuredClone(context) as Record<string, unknown>;
    delete copy.images;
    this.contexts.set(`${gebruiker}/${opdrachtId}`, copy);
  }

  async syllabusList(): Promise<SyllabusList> {
    return { folder: '/mock/syllabus', files: ['Syllabus natuurkunde havo 2026.pdf'] };
  }

  async openSyllabusFolder(): Promise<void> {
    this.record('openSyllabusFolder', []);
  }

  async presets(): Promise<AiPreset[]> {
    return structuredClone(PRESETS);
  }

  async pickAttachments(): Promise<PickedAttachment[]> {
    this.record('pickAttachments', []);
    const picked = this.nextPick;
    this.nextPick = [];
    return picked;
  }
}

function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function mockProposal(base: string, append: string): Proposal {
  return {
    files: [
      {
        path: 'opdracht.typ',
        base,
        proposed: base + append,
        hunks: [{ id: 0, baseStart: lines(base).length, baseLines: [], newLines: lines(append) }],
      },
    ],
    images: [],
    skipped: [],
  };
}

/** The appended hunk fits while the base's last line is still the text's last line. */
function appendStatus(base: string, current: string): HunkStatus {
  const last = lines(base).at(-1) ?? '';
  return current.endsWith(last)
    ? { kind: 'clean', at: lines(current).length }
    : { kind: 'conflict' };
}
