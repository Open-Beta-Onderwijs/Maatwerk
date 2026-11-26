// SPDX-License-Identifier: AGPL-3.0-or-later

// The AI rail and chat panel in the editor (step 32b, spec 4.8.1, boards 59-61, decisions
// 48-75). One conversation per provider per opdracht; one run per opdracht at a time, while
// the editor stays editable (decision 63). The bridge calls go through the main window
// (client.ts); the editor's text and undo history stay in editor-init.js (PanelHost).

import type {
  AiMessage,
  AiProvider,
  AiSendRequest,
  AiSettings,
  Conversation,
  ProposalView,
  ProviderKey,
  Starter,
  SyllabusList,
  TurnResult,
} from '../../bridge/ai-api';
import type { AiEditorInfo } from '../ai-protocol';
import {
  StatusCard,
  diffCard,
  endingCard,
  endingOf,
  proposalStatus,
  summaryRow,
  transcriptCard,
  type DiffCardState,
  type Ending,
  type ProposalFate,
} from './cards';
import type { EditorAi } from './client';
import { Composer, type PendingAttachment } from './composer';
import { append, h, icon, monogramEl } from './dom';
import { installList } from './install';
import { markdown } from './markdown';
import {
  MAX_ATTACHMENTS,
  addEvent,
  chipsFrom,
  chipsToSave,
  contextRequest,
  finishRun,
  formatSize,
  fromHistory,
  newRun,
  preselectSyllabus,
  starters,
  type Chips,
  type LiveRun,
} from './model';
import { Applier } from './applier';
import { openReview } from './review';

/** What the panel needs from the editor. */
export interface PanelHost {
  /** Editor text by file name (`opdracht.typ`, and `main.typ`/`lib.typ` when loaded). */
  buffers(): Record<string, string>;
  /**
   * Replaces the text of `file` as one undoable change (switching to its tab); false, and
   * nothing changed, when the text is no longer `base` (the teacher typed meanwhile).
   */
  applyText(file: string, text: string, base?: string): Promise<boolean>;
  /** Saves now (and waits for a save in flight); false when it failed. */
  save(): Promise<boolean>;
  /** Compile errors in the current text (Fouten oplossen). */
  errorCount(): number;
  /** "<naam> werkt op een kopie" bar and the header pill; null when the run ends. */
  setBusy(naam: string | null): void;
  /** Compile again after images changed on disk. */
  refreshPreview(): void;
  /** The panel opened or closed (the preview refits). */
  layoutChanged(): void;
}

interface LiveState {
  provider: ProviderKey;
  run: LiveRun;
  card: StatusCard;
  timer: ReturnType<typeof setInterval>;
}

export class AiPanel {
  private info!: AiEditorInfo;
  private providers: AiProvider[] = [];
  /** Every provider, also the ones not found (the install help). */
  private allProviders: AiProvider[] = [];
  private settings: AiSettings | null = null;
  private open = new Set<ProviderKey>();
  private selected: ProviderKey | null = null;
  private conv: Conversation | null = null;
  private chips!: Chips;
  private composer!: Composer;
  private live: LiveState | null = null;
  private lastTurn = new Map<ProviderKey, TurnResult>();
  private lastRequest = new Map<ProviderKey, AiSendRequest>();
  private readonly proposals: Applier;
  private readonly messagesEl: HTMLElement;
  private readonly headerEl: HTMLElement;
  private readonly dropEl: HTMLElement;
  /** The install help's footer (AI-assistent verbergen, Opnieuw zoeken). */
  private readonly helpFoot: HTMLElement;
  private helpOpen = false;
  /** The chat follows new content at its bottom (until the teacher scrolls up). */
  private stick = true;

  constructor(
    private readonly ai: EditorAi,
    private readonly host: PanelHost,
    private readonly rail: HTMLElement,
    private readonly panel: HTMLElement,
  ) {
    this.proposals = new Applier(ai, host, {
      markApplied: (key, applied) => this.markApplied(key, applied),
      changed: (key) => {
        if (this.selected === key) this.render();
      },
    });
    this.headerEl = h('header', { class: 'ai-head' });
    this.messagesEl = h('div', { class: 'ai-messages', 'aria-live': 'polite' });
    this.dropEl = h('div', { class: 'ai-drop', hidden: true });
    this.helpFoot = h('div', { class: 'ai-help-foot', hidden: true });
    this.followBottom();
  }

  /**
   * Keeps the newest content in view: content that grows above it later (the previous
   * proposal's diff card is filled after an await) no longer pushes the status card of a
   * follow-up message out of sight.
   */
  private followBottom(): void {
    const el = this.messagesEl;
    const distance = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    el.addEventListener('scroll', () => (this.stick = distance() < 40), { passive: true });
    new MutationObserver(() => {
      if (this.stick && distance() > 0) el.scrollTop = el.scrollHeight;
    }).observe(el, { childList: true, subtree: true, characterData: true });
  }

  async init(): Promise<void> {
    this.info = await this.ai.info();
    if (!this.info.available) return;
    const detection = await this.ai.detect(false);
    this.settings = detection.settings;
    // Off by the school or by the teacher: no rail (decisions 59, 73).
    if (!detection.school || !detection.settings.enabled) return;
    this.allProviders = detection.providers;
    this.providers = detection.providers.filter((p) => p.found);
    const syllabus = await this.ai
      .syllabusList()
      .catch((): SyllabusList => ({ folder: '', files: [] }));
    const preselected = preselectSyllabus(syllabus.files, this.info.vakken, this.info.schoolsoort);
    const saved = await this.ai.context().catch(() => null);
    this.chips = chipsFrom(saved, preselected);
    // A remembered syllabus that is gone from the folder counts as "Geen".
    if (this.chips.syllabus && !syllabus.files.includes(this.chips.syllabus))
      this.chips.syllabus = null;
    this.composer = new Composer({
      ai: this.ai,
      info: this.info,
      syllabus,
      preselected,
      chipsChanged: (chips) => {
        this.chips = chips;
        void this.ai.saveContext(chipsToSave(chips)).catch(() => {});
      },
      send: (message, starter, attachments, chips) =>
        void this.send(message, starter, attachments, chips),
      usedAttachments: () => this.usedAttachments(),
    });
    this.composer.setChips(this.chips);
    this.panel.append(this.headerEl, this.messagesEl, this.composer.el, this.helpFoot, this.dropEl);
    this.setupDrop();
    let convs = await this.ai.conversations().catch(() => ({ open: [], running: null }));
    // A run of an editor closed a moment ago is still being stopped (review 32 M3).
    for (let i = 0; convs.running && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      convs = await this.ai.conversations().catch(() => ({ open: convs.open, running: null }));
    }
    this.open = new Set(convs.open);
    this.rail.hidden = false;
    this.renderRail();
    await this.begin(this.info.start);
  }

  /** Opens the start conversation (decisions 74, 75): sends it, or leaves it for the teacher. */
  private async begin(start: AiEditorInfo['start']): Promise<void> {
    if (!start || !this.provider(start.provider)) return;
    await this.select(start.provider);
    if (this.selected !== start.provider) return; // the notice was closed
    this.composer.prefill(
      start.message,
      start.starter ?? null,
      start.attachments ?? [],
      start.send,
    );
  }

  private provider(key: ProviderKey | null): AiProvider | undefined {
    return this.providers.find((p) => p.key === key);
  }

  private limitMs(): number {
    return (this.settings?.timeLimitMinutes ?? 5) * 60_000;
  }

  private usedAttachments(): number {
    return (this.conv?.messages ?? []).reduce((n, m) => n + (m.attachments?.length ?? 0), 0);
  }

  // ── Rail (board 59) ───────────────────────────────────────────────────────

  private renderRail(): void {
    const buttons: HTMLElement[] = [h('span', { class: 'ai-rail-label' }, 'AI')];
    if (this.providers.length === 0) {
      buttons.push(
        h(
          'button',
          {
            type: 'button',
            class: `ai-rail-btn is-missing${this.helpOpen ? ' is-selected' : ''}`,
            title: 'Geen AI-programma gevonden',
            'aria-label': 'AI-assistent instellen',
            'aria-pressed': String(this.helpOpen),
            onclick: () => (this.helpOpen ? this.close() : this.showInstallHelp()),
          },
          '?',
        ),
      );
    }
    for (const p of this.providers) {
      const selected = this.selected === p.key;
      const running = this.live?.provider === p.key;
      const state = running ? ' · bezig' : this.open.has(p.key) ? ' · gesprek open' : '';
      const btn = h('button', {
        type: 'button',
        class: `ai-rail-btn${selected ? ' is-selected' : ''}`,
        title: `${p.name}${p.beta ? ' (bèta: nog niet getest)' : ''}${state}`,
        'aria-label': `${p.name}${p.beta ? ' (bèta)' : ''}${state}`,
        'aria-pressed': String(selected),
        onclick: () => void this.select(p.key),
      });
      monogramEl(btn, p.key, p.name);
      if (p.beta) btn.append(h('span', { class: 'ai-rail-beta', 'aria-hidden': 'true' }, 'bèta'));
      if (!selected && (running || this.open.has(p.key)))
        btn.append(h('span', { class: `ai-rail-dot${running ? ' is-running' : ''}` }));
      buttons.push(btn);
    }
    this.rail.replaceChildren(...buttons);
  }

  /** The "?" panel (board 62, decision 72): install help, Opnieuw zoeken, verbergen. */
  private showInstallHelp(): void {
    this.selected = null;
    this.helpOpen = true;
    this.panel.hidden = false;
    this.renderRail();
    this.headerEl.replaceChildren(
      h('span', { class: 'ai-avatar is-missing', 'aria-hidden': 'true' }, '?'),
      h('div', { class: 'ai-head-text' }, h('strong', {}, 'AI-assistent instellen')),
      this.closeButton(),
    );
    const rescan = h(
      'button',
      { type: 'button', class: 'ai-btn ai-btn-primary' },
      'Opnieuw zoeken',
    );
    rescan.addEventListener('click', async () => {
      rescan.disabled = true;
      try {
        await this.refresh(true);
      } finally {
        rescan.disabled = false;
      }
    });
    const hide = h(
      'button',
      { type: 'button', class: 'ai-link ai-help-hide' },
      'AI-assistent verbergen',
    );
    hide.addEventListener('click', async () => {
      await this.ai.hideAssistant().catch(() => {});
      this.hideAll();
    });
    this.messagesEl.replaceChildren(
      h(
        'div',
        { class: 'ai-help' },
        h('h3', {}, 'Geen AI-programma gevonden'),
        h(
          'p',
          { class: 'ai-intro-text' },
          'Maatwerk gebruikt een AI-programma voor de command line dat je zelf installeert, met ' +
            'je eigen account of abonnement. Installeer er één, log er in een terminal één keer ' +
            'mee in en klik op Opnieuw zoeken.',
        ),
        installList(this.allProviders),
      ),
    );
    this.composer.el.hidden = true;
    this.helpFoot.replaceChildren(hide, rescan);
    this.helpFoot.hidden = false;
    this.host.layoutChanged();
  }

  /** Detects again (after AI-instellingen or Opnieuw zoeken) and redraws the rail. */
  private async refresh(rescan: boolean): Promise<void> {
    const d = await this.ai.detect(rescan);
    this.settings = d.settings;
    if (!d.school || !d.settings.enabled) return this.hideAll();
    this.allProviders = d.providers;
    // A run keeps its provider; the rail catches up when it ends.
    if (this.live) return;
    this.providers = d.providers.filter((p) => p.found);
    if (this.helpOpen) {
      if (this.providers.length) this.close();
      else this.showInstallHelp();
    } else if (this.selected && !this.provider(this.selected)) {
      this.close();
    } else if (this.selected) {
      this.render();
    }
    this.renderRail();
  }

  /** The teacher switched the assistant off: no rail, no panel. */
  private hideAll(): void {
    this.close();
    this.rail.hidden = true;
    this.host.layoutChanged();
  }

  /** AI-instellingen (board 62) in the main window; the rail follows a save. */
  private async openSettings(): Promise<void> {
    if (await this.ai.openSettings().catch(() => false)) await this.refresh(false);
  }

  private closeButton(): HTMLElement {
    return h(
      'button',
      {
        type: 'button',
        class: 'ai-icon-btn',
        'aria-label': 'Chat sluiten',
        title: 'Chat sluiten',
        onclick: () => this.close(),
      },
      icon('x', 18),
    );
  }

  private close(): void {
    this.selected = null;
    this.conv = null;
    this.helpOpen = false;
    this.helpFoot.hidden = true;
    this.panel.hidden = true;
    this.renderRail();
    this.host.layoutChanged();
  }

  /** Opens the conversation of `key`; clicking the open one closes the panel. */
  async select(key: ProviderKey): Promise<void> {
    if (this.selected === key) return this.close();
    // The first-use notice (decision 70), once per teacher, before any conversation.
    if (this.settings && !this.settings.noticeSeen) {
      if (!(await this.ai.notice().catch(() => false))) return;
      this.settings = { ...this.settings, noticeSeen: true };
    }
    this.helpOpen = false;
    this.helpFoot.hidden = true;
    this.selected = key;
    this.stick = true;
    this.conv = { provider: key, messages: [] };
    this.composer.reset();
    this.composer.el.hidden = false;
    this.panel.hidden = false;
    this.renderRail();
    this.render();
    this.host.layoutChanged();
    try {
      const conv = await this.ai.conversation(key);
      if (this.selected === key) this.conv = conv;
    } catch {
      /* an unreadable history starts empty */
    }
    if (this.selected === key) this.render();
    this.composer.focus();
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  private renderHeader(p: AiProvider): void {
    const avatar = monogramEl(h('span', { class: 'ai-avatar' }), p.key, p.name);
    this.headerEl.replaceChildren();
    append(
      this.headerEl,
      avatar,
      h(
        'div',
        { class: 'ai-head-text' },
        h('strong', {}, p.name),
        h('span', {}, 'via command line'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'ai-new',
          title: 'Nieuw gesprek',
          disabled: this.live?.provider === p.key,
          onclick: () => void this.newConversation(p.key),
        },
        icon('plus', 15),
        'Nieuw gesprek',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'ai-icon-btn',
          'aria-label': 'AI-instellingen',
          title: 'AI-instellingen',
          onclick: () => void this.openSettings(),
        },
        icon('gear', 18, 1.9),
      ),
      this.closeButton(),
    );
  }

  private async newConversation(key: ProviderKey): Promise<void> {
    await this.ai.newConversation(key).catch(() => {});
    this.open.delete(key);
    this.lastTurn.delete(key);
    this.lastRequest.delete(key);
    this.proposals.forget(key);
    if (this.selected === key) {
      this.conv = { provider: key, messages: [] };
      this.composer.reset();
      this.render();
    }
    this.renderRail();
  }

  private render(): void {
    const p = this.provider(this.selected);
    if (!p || !this.conv) return;
    this.renderHeader(p);
    const busy = this.live !== null;
    this.composer.setBusy(busy, this.provider(this.live?.provider ?? null)?.name ?? '');
    const msgs = this.conv.messages;
    const children: HTMLElement[] = [];
    if (msgs.length === 0 && !(busy && this.live?.provider === p.key)) {
      children.push(this.emptyState(p));
    }
    // Only the newest proposal has a card, and only while no run came after it (each run
    // replaces the saved proposal); older ones get a status line (user, 2026-11-20).
    let lastRun = -1;
    let lastProposal = -1;
    msgs.forEach((m, i) => {
      if (m.fromTeacher || !m.run) return;
      lastRun = i;
      if (m.run.proposal) lastProposal = i;
    });
    const runningHere = busy && this.live?.provider === p.key;
    const current = !runningHere && lastProposal === lastRun ? lastProposal : -1;
    msgs.forEach((m, i) => {
      if (m.fromTeacher) {
        children.push(this.teacherBubble(m));
        return;
      }
      const fate: ProposalFate | null =
        m.run?.proposal && i !== current
          ? m.run.applied
            ? 'applied'
            : msgs.slice(i + 1).some((x) => !x.fromTeacher && x.run?.proposal)
              ? 'replaced'
              : 'notApplied'
          : null;
      children.push(this.aiMessage(p, m, i === current, fate, i === msgs.length - 1));
    });
    const live = this.live;
    if (live && live.provider === p.key) {
      children.push(live.card.el);
    } else if (msgs.at(-1)?.fromTeacher && this.lastTurn.has(p.key)) {
      // The turn failed before a run was recorded (CLI missing, bad request).
      const r = this.lastTurn.get(p.key)!;
      const ending = this.endingOfTurn(r);
      if (ending) children.push(this.ending(p, ending));
    }
    // A run in progress always shows its status card.
    if (busy) this.stick = true;
    this.messagesEl.replaceChildren(...children);
    if (this.stick) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private emptyState(p: AiProvider): HTMLElement {
    return h(
      'div',
      { class: 'ai-empty' },
      h(
        'div',
        { class: 'ai-intro' },
        h('h3', {}, `Waar kan ${p.name} mee helpen?`),
        h(
          'p',
          { class: 'ai-intro-text' },
          'De AI werkt op een kopie van deze opdracht en stelt wijzigingen voor. Jij kiest wat je toepast.',
        ),
      ),
      h(
        'div',
        { class: 'ai-starters' },
        ...starters(this.host.errorCount()).map((s) =>
          h(
            'button',
            {
              type: 'button',
              class: `ai-starter${s.key === 'fixErrors' ? ' is-danger' : ''}`,
              onclick: () => this.composer.fill(s.text, s.key, s.select),
            },
            h(
              'span',
              { class: 'ai-starter-icon' },
              icon(
                s.key === 'fixErrors'
                  ? 'warn'
                  : s.key === 'completeAnswers'
                    ? 'pencil'
                    : s.key === 'rewrite'
                      ? 'swap'
                      : 'plus',
                16,
              ),
            ),
            h(
              'span',
              { class: 'ai-starter-text' },
              h('span', { class: 'ai-starter-label' }, s.label),
              h('span', { class: 'ai-starter-sub' }, s.subtitle),
            ),
          ),
        ),
      ),
    );
  }

  private teacherBubble(m: AiMessage): HTMLElement {
    return h(
      'div',
      { class: 'ai-msg is-teacher' },
      h('div', { class: 'ai-bubble' }, m.text),
      m.attachments?.length
        ? h(
            'div',
            { class: 'ai-msg-attachments' },
            ...m.attachments.map((a) =>
              h('span', { class: 'ai-attachment is-sent' }, icon('file', 13), a),
            ),
          )
        : null,
    );
  }

  private aiMessage(
    p: AiProvider,
    m: AiMessage,
    withProposal: boolean,
    fate: ProposalFate | null,
    last: boolean,
  ): HTMLElement {
    const el = h('div', { class: 'ai-msg is-ai' });
    const run = m.run;
    if (run) {
      const ended = run.end === 'stopped' ? 'stopped' : run.end === 'timedOut' ? 'timedOut' : null;
      el.append(
        summaryRow(run, () =>
          transcriptCard(p.command, fromHistory(run.steps), run.lines, ended, this.limitMs()),
        ),
      );
    }
    // The CLIs answer in Markdown (user, 2026-11-20).
    if (m.text.trim()) el.append(h('div', { class: 'ai-bubble is-md' }, markdown(m.text)));
    if (run && withProposal) {
      const host = h('div', { class: 'ai-diff-host' });
      el.append(host);
      void this.fillDiffCard(p.key, host, run.applied);
    } else if (fate) {
      el.append(proposalStatus(fate));
    } else if (run) {
      const ending = endingOf(run, this.limitMs());
      // Only the last message offers Opnieuw proberen; older ones keep their card.
      if (ending) el.append(this.ending(p, ending, last));
    }
    return el;
  }

  private endingOfTurn(r: TurnResult): Ending | null {
    switch (r.outcome) {
      case 'proposal':
        return null;
      case 'noChanges':
        return { kind: 'noChanges' };
      case 'notLoggedIn':
        return { kind: 'notLoggedIn' };
      case 'timedOut':
        return { kind: 'timedOut', limitMs: this.limitMs() };
      case 'stopped':
        return { kind: 'stopped', elapsedMs: r.elapsedMs };
      case 'notFound':
        return { kind: 'notFound' };
      default:
        return { kind: 'cliError', tail: r.tail.length ? r.tail : [r.answer ?? ''] };
    }
  }

  private ending(p: AiProvider, e: Ending, withRetry = true): HTMLElement {
    const card = endingCard(e, p.name, p.command, {
      retry: () => this.retry(p.key),
      settings: () => void this.openSettings(),
    });
    if (!withRetry || this.live) card.querySelector('.ai-end-buttons')?.remove();
    return card;
  }

  /** Opnieuw proberen: the last request again, else its text back in the input. */
  private retry(key: ProviderKey): void {
    if (this.live) return;
    const req = this.lastRequest.get(key);
    if (req) {
      void this.run(key, { ...req, buffers: this.host.buffers() });
      return;
    }
    const lastText = [...(this.conv?.messages ?? [])].reverse().find((m) => m.fromTeacher)?.text;
    if (lastText) this.composer.fill(lastText, null);
  }

  // ── Sending and running (decisions 55, 63, 66) ────────────────────────────

  private async send(
    message: string,
    starter: Starter | null,
    attachments: PendingAttachment[],
    chips: Chips,
  ): Promise<void> {
    const key = this.selected;
    if (!key || this.live) return;
    const request: AiSendRequest = {
      message,
      starter,
      context: contextRequest(chips, this.info.metadata),
      attachments: Composer.requests(attachments),
      buffers: this.host.buffers(),
    };
    this.chips = { ...chips, images: false };
    this.conv?.messages.push({
      fromTeacher: true,
      text: message,
      at: new Date().toISOString(),
      attachments: attachments.map((a) => `${a.name} ${formatSize(a.size)}`),
    });
    await this.run(key, request);
  }

  private async run(key: ProviderKey, request: AiSendRequest): Promise<void> {
    const p = this.provider(key);
    if (!p || this.live) return;
    this.lastRequest.set(key, request);
    this.lastTurn.delete(key);
    this.proposals.forget(key);
    const run = newRun(Date.now());
    const card = new StatusCard(p.name, p.command, this.limitMs(), () => void this.stop());
    card.update(run, Date.now());
    const timer = setInterval(() => card.update(run, Date.now()), 1000);
    this.live = { provider: key, run, card, timer };
    this.open.add(key);
    this.host.setBusy(p.name);
    this.renderRail();
    this.render();
    let result: TurnResult;
    try {
      result = await this.ai.send(key, request, (event) => {
        addEvent(run, event, Date.now());
        card.update(run, Date.now());
      });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      result = {
        outcome: 'cliError',
        answer: message,
        proposal: null,
        check: null,
        tail: [message],
        fixRounds: 0,
        elapsedMs: Date.now() - run.startMs,
      };
    }
    finishRun(run, Date.now(), result.outcome !== 'proposal' && result.outcome !== 'noChanges');
    clearInterval(timer);
    this.live = null;
    this.host.setBusy(null);
    this.lastTurn.set(key, result);
    try {
      const conv = await this.ai.conversation(key);
      if (this.selected === key) this.conv = conv;
    } catch {
      /* keep what is shown */
    }
    this.renderRail();
    this.render();
  }

  private async stop(): Promise<void> {
    await this.ai.stop().catch(() => {});
  }

  // ── Proposal (decisions 56, 68, 69) ───────────────────────────────────────

  /**
   * The newest proposal's card. `applied`: the history says it was applied (in this session,
   * `cardState` has the counts and Ongedaan maken; after reopening only "Toegepast").
   */
  private async fillDiffCard(key: ProviderKey, host: HTMLElement, applied: boolean) {
    let view: ProposalView;
    try {
      view = await this.ai.proposal(key, this.host.buffers());
    } catch {
      // The saved proposal is gone (a run that did not record itself): the status line.
      host.replaceChildren(proposalStatus(applied ? 'applied' : 'notApplied'));
      return;
    }
    const check = this.lastTurn.get(key)?.check ?? null;
    const state: DiffCardState =
      this.proposals.cardState.get(key) ??
      (applied ? { kind: 'appliedEarlier' } : { kind: 'ready' });
    const isApplied = state.kind === 'applied' || state.kind === 'appliedEarlier';
    host.replaceChildren(
      diffCard(view, check, state, {
        // Applied: Bekijken only shows the proposal (user, 2026-11-20).
        review: () =>
          void openReview({
            ai: this.ai,
            provider: this.provider(key)!,
            view,
            check,
            buffers: this.host.buffers(),
            apply: isApplied ? null : (hunks, images) => this.proposals.apply(key, hunks, images),
          }),
        apply: () => void this.proposals.applyAll(key),
        undo: () => void this.proposals.undo(key),
      }),
    );
  }

  /** The editor's save of `opdracht.typ` (see [`Applier.saveWithImages`], review 32 m4). */
  saveWithImages<T extends { ok?: boolean } | null | undefined>(
    write: () => Promise<T>,
  ): Promise<T> {
    return this.proposals.saveWithImages(write);
  }

  /** The in-memory history follows `ai_apply` / `ai_undo_images` (the card and status lines). */
  private markApplied(key: ProviderKey, applied: boolean): void {
    if (this.selected !== key || !this.conv) return;
    const last = [...this.conv.messages].reverse().find((m) => !m.fromTeacher && m.run?.proposal);
    if (last?.run) last.run.applied = applied;
  }

  // ── Drop (board 60) ───────────────────────────────────────────────────────

  private setupDrop(): void {
    this.panel.setAttribute('data-file-drop', '');
    let depth = 0;
    const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const show = (on: boolean) => {
      this.dropEl.hidden = !on;
      if (on)
        this.dropEl.replaceChildren(
          icon('upload', 34, 1.8),
          h('strong', {}, 'Laat los om toe te voegen'),
          h(
            'span',
            {},
            'Afbeeldingen, PDF of tekst · max. 25 MB per bestand',
            h('br'),
            `Nog ${this.composer.remaining()} van ${MAX_ATTACHMENTS} bijlagen in dit gesprek`,
          ),
        );
    };
    const usable = () => this.selected !== null && this.live === null && !this.composer.el.hidden;
    this.panel.addEventListener('dragenter', (e) => {
      if (!isFiles(e) || !usable()) return;
      e.preventDefault();
      depth += 1;
      show(true);
    });
    this.panel.addEventListener('dragover', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = usable() ? 'copy' : 'none';
    });
    this.panel.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) show(false);
    });
    this.panel.addEventListener('drop', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0;
      show(false);
      if (usable() && e.dataTransfer) void this.composer.addFiles(e.dataTransfer.files);
    });
  }
}
