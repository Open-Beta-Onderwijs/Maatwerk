// SPDX-License-Identifier: AGPL-3.0-or-later

// The chat's cards (spec 4.8.1, board 59): the status card while a run works (spinner, step,
// elapsed / limit, transcript chevron, Stop, progress bar), the transcript, the summary row
// after a run, the error and end-state cards, and the diff card with Bekijken and Toepassen.

import type { CheckReport, ProposalView, RunSummary } from '../../bridge/ai-api';
import { h, icon, copyText, type IconName } from './dom';
import {
  appliedText,
  changesPill,
  formatClock,
  plusMinus,
  proposalHeadline,
  remainingDiagnostics,
  skippedNote,
  statusText,
  summaryText,
  transcriptText,
  type LiveRun,
  type LiveStep,
} from './model';

// ── Transcript ─────────────────────────────────────────────────────────────

function stepRow(s: LiveStep, now: number, ended: 'stopped' | 'timedOut' | null): HTMLElement {
  const running = s.endMs === null;
  const state = running ? (ended ? 'error' : 'running') : s.error ? 'error' : 'done';
  const duration = running
    ? ended === 'stopped'
      ? 'gestopt'
      : ended
        ? ''
        : 'bezig'
    : s.endMs && s.startMs
      ? formatClock(s.endMs - s.startMs)
      : '';
  const body = [s.detail ?? '', ...s.output].filter(Boolean).join('\n');
  const details = h(
    'details',
    { class: 'ai-step' },
    h(
      'summary',
      { class: 'ai-step-row' },
      icon('chevronRight', 12, 2.6),
      h('span', { class: `ai-dot is-${state}` }),
      h('span', { class: 'ai-step-title' }, s.title),
      h('span', { class: 'ai-step-time' }, duration),
    ),
  );
  if (body) {
    const pre = h('pre', { class: 'ai-step-body' });
    for (const line of body.split('\n')) {
      const kind = /^\+/.test(line)
        ? 'add'
        : s.error && /error|fout/i.test(line)
          ? 'error'
          : /^\$ /.test(line)
            ? 'command'
            : '';
      pre.append(h('span', { class: kind ? `is-${kind}` : '' }, `${line}\n`));
    }
    details.append(pre);
  }
  void now;
  return details;
}

/** The transcript card: one collapsible row per step, Kopiëren copies it as text. */
export function transcriptCard(
  command: string,
  steps: LiveStep[],
  lines: string[],
  ended: 'stopped' | 'timedOut' | null,
  limitMs: number,
): HTMLElement {
  const copy = h('button', { type: 'button', class: 'ai-link' }, 'Kopiëren');
  copy.addEventListener('click', async () => {
    copy.textContent = (await copyText(transcriptText(command, steps, lines)))
      ? 'Gekopieerd'
      : 'Kopiëren mislukt';
  });
  const card = h(
    'div',
    { class: 'ai-transcript' },
    h('div', { class: 'ai-transcript-head' }, h('span', {}, `Transcript · ${command}`), copy),
    ...steps.map((s) => stepRow(s, Date.now(), ended)),
  );
  if (ended)
    card.append(
      h(
        'div',
        { class: 'ai-transcript-end' },
        ended === 'stopped'
          ? '■ gestopt door de docent'
          : `■ tijdslimiet bereikt (${formatClock(limitMs)})`,
      ),
    );
  if (steps.length === 0 && !ended)
    card.append(h('div', { class: 'ai-transcript-end' }, 'Nog geen stappen.'));
  return card;
}

// ── Status card while running (decision 66) ────────────────────────────────

export class StatusCard {
  readonly el: HTMLElement;
  private open = false;
  private readonly text: HTMLElement;
  private readonly time: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly chevron: HTMLButtonElement;
  private readonly transcriptHost: HTMLElement;

  constructor(
    private readonly naam: string,
    private readonly command: string,
    private readonly limitMs: number,
    onStop: () => void,
  ) {
    this.text = h('span', { class: 'ai-status-text', role: 'status', 'aria-live': 'polite' });
    this.time = h('span', {
      class: 'ai-status-time',
      title: `Tijdslimiet ${Math.round(limitMs / 60000)} minuten`,
    });
    this.chevron = h(
      'button',
      {
        type: 'button',
        class: 'ai-icon-btn ai-chevron',
        'aria-label': 'Volledig transcript',
        title: 'Volledig transcript',
        'aria-expanded': 'false',
      },
      icon('chevronDown', 16, 2.2),
    );
    this.chevron.addEventListener('click', () => {
      this.open = !this.open;
      this.chevron.setAttribute('aria-expanded', String(this.open));
      this.el.classList.toggle('is-open', this.open);
    });
    const stop = h(
      'button',
      { type: 'button', class: 'ai-stop', onclick: onStop },
      h('span', { class: 'ai-stop-square' }),
      'Stop',
    );
    this.bar = h('span', { class: 'ai-progress-fill' });
    this.transcriptHost = h('div', { class: 'ai-status-transcript' });
    this.el = h(
      'div',
      { class: 'ai-status-card' },
      h(
        'div',
        { class: 'ai-status-row' },
        h('span', { class: 'ai-spinner' }, icon('spinner', 15, 3)),
        this.text,
        this.time,
        this.chevron,
        stop,
      ),
      h('div', { class: 'ai-progress' }, this.bar),
      this.transcriptHost,
    );
  }

  update(run: LiveRun, now: number): void {
    const elapsed = now - run.startMs;
    this.text.textContent = statusText(run, this.naam);
    this.time.textContent = `${formatClock(elapsed)} / ${formatClock(this.limitMs)}`;
    this.bar.style.width = `${Math.min(100, (elapsed / this.limitMs) * 100)}%`;
    if (this.open) {
      const openRows = new Set(
        [...this.transcriptHost.querySelectorAll('details')]
          .map((d, i) => (d.open ? i : -1))
          .filter((i) => i >= 0),
      );
      const card = transcriptCard(this.command, run.steps, run.lines, null, this.limitMs);
      card.querySelectorAll('details').forEach((d, i) => (d.open = openRows.has(i)));
      this.transcriptHost.replaceChildren(card);
    }
  }
}

// ── Summary row after a run ────────────────────────────────────────────────

const TONE_ICON: Record<string, IconName> = {
  success: 'check',
  muted: 'stop',
  warning: 'clock',
  danger: 'x',
};

export function summaryRow(run: RunSummary, transcript: () => HTMLElement): HTMLElement {
  const { text, tone } = summaryText(run);
  const host = h('div', { class: 'ai-summary-transcript' });
  const btn = h(
    'button',
    { type: 'button', class: `ai-summary is-${tone}`, 'aria-expanded': 'false' },
    icon(TONE_ICON[tone]!, 14, 2.6),
    h('span', { class: 'ai-summary-text' }, text),
    h('span', { class: 'ai-summary-link' }, 'Transcript'),
    icon('chevronDown', 14, 2.2),
  );
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    host.replaceChildren(...(open ? [transcript()] : []));
  });
  return h('div', { class: 'ai-summary-wrap' }, btn, host);
}

// ── Error and end-state cards (decision 67) ────────────────────────────────

export type Ending =
  | { kind: 'notLoggedIn' }
  | { kind: 'cliError'; tail: string[] }
  | { kind: 'notFound' }
  | { kind: 'timedOut'; limitMs: number }
  | { kind: 'stopped'; elapsedMs: number }
  | { kind: 'noChanges' };

/** The ending of a stored run, or null for a run with a proposal. */
export function endingOf(run: RunSummary, limitMs: number): Ending | null {
  switch (run.end) {
    case 'finished':
      return run.proposal ? null : { kind: 'noChanges' };
    case 'stopped':
      return { kind: 'stopped', elapsedMs: run.elapsedMs };
    case 'timedOut':
      return { kind: 'timedOut', limitMs };
    default:
      if (run.authFailed) return { kind: 'notLoggedIn' };
      return {
        kind: 'cliError',
        tail: [...run.lines.slice(-6), ...(run.error ? [run.error] : [])],
      };
  }
}

export interface EndingActions {
  retry(): void;
  settings?(): void;
}

export function endingCard(
  e: Ending,
  naam: string,
  command: string,
  actions: EndingActions,
): HTMLElement {
  const retry = () =>
    h(
      'button',
      { type: 'button', class: 'ai-btn ai-btn-primary', onclick: () => actions.retry() },
      'Opnieuw proberen',
    );
  const card = (
    tone: 'danger' | 'warning' | 'neutral',
    ic: IconName,
    title: string,
    body: (HTMLElement | string)[],
    buttons: HTMLElement[],
  ) =>
    h(
      'div',
      { class: `ai-end is-${tone}`, role: 'alert' },
      h('div', { class: 'ai-end-title' }, icon(ic, 16), h('span', {}, title)),
      ...body.map((b) => (typeof b === 'string' ? h('p', { class: 'ai-end-body' }, b) : b)),
      buttons.length ? h('div', { class: 'ai-end-buttons' }, ...buttons) : null,
    );
  switch (e.kind) {
    case 'notLoggedIn': {
      const help = h(
        'p',
        { class: 'ai-end-help', hidden: true },
        `Typ in een terminal (PowerShell of Terminal) `,
        h('code', {}, command),
        ` en volg de stappen om in te loggen met je eigen account. Sluit daarna de terminal.`,
      );
      return card(
        'danger',
        'key',
        `${naam} is niet ingelogd`,
        [
          `Open een terminal, start ${command} en log in met je eigen account. Probeer het daarna opnieuw.`,
          help,
        ],
        [
          retry(),
          h(
            'button',
            { type: 'button', class: 'ai-btn', onclick: () => (help.hidden = !help.hidden) },
            'Hulp bij inloggen',
          ),
        ],
      );
    }
    case 'cliError': {
      const tail = e.tail.join('\n') || '(geen uitvoer)';
      const copy = h('button', { type: 'button', class: 'ai-btn' }, 'Details kopiëren');
      copy.addEventListener('click', async () => {
        copy.textContent = (await copyText(tail)) ? 'Gekopieerd' : 'Kopiëren mislukt';
      });
      return card(
        'danger',
        'warn',
        `${naam} stopte met een fout`,
        [
          'Er is niets aan je opdracht veranderd. De laatste regels van de command line:',
          h('pre', { class: 'ai-end-code' }, tail),
        ],
        [retry(), copy],
      );
    }
    case 'notFound':
      return card(
        'danger',
        'warn',
        `${naam} is niet gevonden`,
        [`Maatwerk kon ${command} niet starten. Controleer of het programma nog geïnstalleerd is.`],
        [retry()],
      );
    case 'timedOut': {
      const min = Math.round(e.limitMs / 60000);
      const buttons = [retry()];
      if (actions.settings)
        buttons.push(
          h(
            'button',
            { type: 'button', class: 'ai-btn', onclick: () => actions.settings!() },
            'AI-instellingen',
          ),
        );
      return card(
        'warning',
        'clock',
        `Gestopt na ${min} ${min === 1 ? 'minuut' : 'minuten'}`,
        [
          'De tijdslimiet is bereikt. Er is niets aan je opdracht veranderd. Probeer een kleinere vraag, of verhoog de limiet in AI-instellingen.',
        ],
        buttons,
      );
    }
    case 'stopped':
      return card(
        'neutral',
        'stop',
        `Je hebt de AI gestopt na ${formatClock(e.elapsedMs)}`,
        ['Wat de AI tot dan toe deed, is weggegooid. Je opdracht is niet veranderd.'],
        [retry()],
      );
    case 'noChanges':
      return card(
        'neutral',
        'info',
        'Geen wijzigingen voorgesteld',
        [
          'De opdracht is hetzelfde gebleven. Stel een vervolgvraag als je toch iets wilt laten aanpassen.',
        ],
        [],
      );
  }
}

// ── Diff card (decision 68) ────────────────────────────────────────────────

export interface DiffCardActions {
  review(): void;
  apply(): void;
  undo(): void;
}

export type DiffCardState =
  | { kind: 'ready' }
  | { kind: 'applied'; hunks: number; images: number; conflicts: number }
  | { kind: 'error'; message: string };

export function diffCard(
  view: ProposalView,
  check: CheckReport | null,
  state: DiffCardState,
  actions: DiffCardActions,
): HTMLElement {
  const p = view.proposal;
  const rows: HTMLElement[] = [];
  for (const f of p.files) {
    const { plus, minus } = plusMinus(f);
    rows.push(
      h(
        'div',
        { class: 'ai-diff-file' },
        h('span', { class: 'ai-mono ai-ellipsis' }, f.path),
        h('span', { class: 'ai-plus' }, `+${plus}`),
        h('span', { class: 'ai-minus' }, `−${minus}`),
        h('span', { class: 'ai-pill' }, changesPill(f)),
      ),
    );
  }
  for (const img of p.images)
    rows.push(
      h(
        'div',
        { class: 'ai-diff-file' },
        h('span', { class: 'ai-mono ai-ellipsis' }, img.path),
        h('span', { class: `ai-pill ${img.new ? 'is-new' : ''}` }, img.new ? 'nieuw' : 'gewijzigd'),
      ),
    );
  for (const s of p.skipped)
    rows.push(
      h(
        'div',
        { class: 'ai-diff-file is-skipped' },
        h('span', { class: 'ai-mono ai-ellipsis' }, s),
        h('span', { class: 'ai-pill' }, 'niet toegepast'),
      ),
    );
  const notes = p.skipped
    .filter((s) => s.endsWith('.typ'))
    .map((s) => h('p', { class: 'ai-diff-note' }, skippedNote(s)));
  const left = remainingDiagnostics(check);
  const conflicts = Object.values(view.statuses)
    .flat()
    .filter((s) => s.kind === 'conflict').length;

  let footer: HTMLElement;
  if (state.kind === 'applied') {
    footer = h(
      'div',
      { class: 'ai-diff-foot is-applied', role: 'status' },
      icon('check', 14, 2.6),
      h(
        'span',
        {},
        appliedText(state.hunks, state.images) +
          (state.conflicts ? ` · ${state.conflicts} overgeslagen (conflict)` : ''),
      ),
      h(
        'button',
        { type: 'button', class: 'ai-link', onclick: () => actions.undo() },
        'Ongedaan maken',
      ),
    );
  } else {
    footer = h(
      'div',
      { class: 'ai-diff-foot' },
      state.kind === 'error'
        ? h('span', { class: 'ai-diff-error', role: 'alert' }, state.message)
        : null,
      conflicts && state.kind === 'ready'
        ? h(
            'span',
            { class: 'ai-diff-conflicts' },
            `${conflicts} ${conflicts === 1 ? 'conflict wordt' : 'conflicten worden'} overgeslagen`,
          )
        : null,
      h('button', { type: 'button', class: 'ai-btn', onclick: () => actions.review() }, 'Bekijken'),
      h(
        'button',
        { type: 'button', class: 'ai-btn ai-btn-primary', onclick: () => actions.apply() },
        'Toepassen',
      ),
    );
  }
  return h(
    'div',
    { class: 'ai-diff-card' },
    h(
      'div',
      { class: 'ai-diff-head' },
      h('strong', {}, 'Voorstel'),
      h('span', {}, proposalHeadline(p)),
    ),
    ...rows,
    ...notes,
    left ? h('div', { class: 'ai-diff-left' }, icon('warn', 14), h('span', {}, left)) : null,
    footer,
  );
}
