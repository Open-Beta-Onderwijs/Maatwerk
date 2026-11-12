// SPDX-License-Identifier: AGPL-3.0-or-later

// The "Scores invoeren" modal of a test (design spec 4.10): header actions, presence of
// colleagues, their changes while it is open, and the group grids.

import {
  changedByName,
  closeModal,
  escHtml,
  onModalCleanup,
  onModalSync,
  openModal,
  showReloadNotice,
} from '../../app.js';
import { formatNumber } from '../../domain/format';
import { testBadgeClass } from '../../domain/test-type';
import type { Exam } from '../../domain/types';
import * as Presence from '../../presence.js';
import { Store } from '../../store.js';
import { afterPaint, perfSpan } from '../../utils/perf';
import { spinnerValue, wireSpinners } from '../../utils/spinners';
import { loadScoreGrid, modalState, takePrebuilt } from './build';
import { onlyNTermDiffers, rosterSignature } from './roster';
import {
  REMOTE_FLASH_COLOR,
  REMOTE_FLASH_MS,
  destroyGridInstances,
  pendingSaves,
  recomputeAllRows,
  resetScoreModal,
  session,
  unsavedCount,
  waitForPendingSaves,
  wireHistory,
} from './session';

export interface ScoreModalDeps {
  openExamModal(examId: string, onSaved: () => unknown): void;
  renderToetsenList(): void;
}

interface SyncEvent {
  id: string;
  year?: string;
  subject?: string;
  kind?: string;
  after: unknown;
}

// Shortcuts and explanation, shown under the ? button on hover, focus or click (spec 4.10).
const HELP_ROWS: [string, string][] = [
  ['0-9, Enter', 'Punten invullen en naar het volgende veld'],
  ['. (numpad)', 'N invullen (niet gemaakt), als ". → N" aan staat'],
  ['Tab, Shift+Tab', 'Volgende / vorige veld'],
  ['* en / (numpad)', 'Volgende / vorige veld'],
  ['Home, End', 'Eerste / laatste vraag of observatie'],
  ['- en + (numpad)', 'Vorige / volgende leerling'],
  ['F1, F2, …', 'Eerste, tweede, … observatie aan of uit'],
  ['0 / 1 bij een observatie', 'Observatie uit / aan'],
  ['Ctrl+C, Ctrl+X, Ctrl+V', 'Kopiëren, knippen en plakken (ook uit Excel)'],
  ['Delete, Backspace', 'Gekozen scores wissen'],
  ['Ctrl+Z, Ctrl+Y', 'Ongedaan maken / opnieuw'],
];

const HELP_HTML = `
  <div class="sc-help-pop" id="sc-help-pop" role="tooltip">
    <table class="sc-help-table">${HELP_ROWS.map(
      ([k, v]) => `<tr><th scope="row">${escHtml(k)}</th><td>${escHtml(v)}</td></tr>`,
    ).join('')}</table>
    <p>Cijfer overschrijven: typ een cijfer in de kolom Cijfer. Leegmaken of rechtermuisklik
      herstelt het berekende cijfer.</p>
    <p>Kleuren: groen volle punten, geel deels, rood 0 punten, grijs N. Een balkje voor het
      nummer: scores ontbreken (geel), een ongeldige score (rood) of een overschreven cijfer
      (accentkleur).</p>
  </div>`;

const UNDO_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>';
const REDO_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>';

export function openScoreModal(examId: string, year: string, deps: ScoreModalDeps): void {
  const endOpen = perfSpan('modal:scores');
  const generationAtOpen = Store.generation();
  const pre = takePrebuilt(examId, year);
  resetScoreModal({ keepGrids: Boolean(pre) });
  const exam = (Store.getExamsSync(year) as Exam[]).find((e) => e.id === examId);
  if (!exam) {
    if (pre) destroyGridInstances();
    return;
  }

  openModal({
    title: 'Scores invoeren',
    key: 'scores',
    // The exam badge sits before the exam name, in the line under the title.
    subtitleHtml: `${
      exam.volgnummer
        ? `<span class="${testBadgeClass(exam)}">${escHtml(String(exam.volgnummer))}</span>`
        : ''
    }<span class="sc-exam-name">${escHtml(exam.title ?? '')}</span>`,
    className: 'modal-scores',
    fixedHeight: true,
    // One header row (board 13): the actions sit between the title and ✕; only the grids
    // scroll (#sc-grid-container), so the sticky group headings stick to its top.
    headerActionsHtml: `
      <div id="sc-presence" class="presence-badges"></div>
      <span class="sc-help-wrap">
        <button type="button" class="btn btn--icon" id="sc-help" aria-label="Sneltoetsen en uitleg"
          aria-describedby="sc-help-pop" aria-expanded="false">?</button>${HELP_HTML}
      </span>
      <button type="button" class="btn btn--icon" id="sc-undo" aria-label="Ongedaan maken"
        title="Ongedaan maken (Ctrl+Z)">${UNDO_ICON}</button>
      <button type="button" class="btn btn--icon" id="sc-redo" aria-label="Opnieuw"
        title="Opnieuw (Ctrl+Y)">${REDO_ICON}</button>
      <span class="sc-head-sep" aria-hidden="true"></span>
      <label class="sc-dot-toggle"
        title="Aangevinkt: de punt op het numpad vult N in (niet gemaakt). Halve punten typ je dan met een komma.">
        <input type="checkbox" id="sc-dot-n" ${session.numpadDotIsN ? 'checked' : ''} /> . → N
      </label>
      <button type="button" class="btn btn--secondary btn--sm" id="sc-edit-exam">Toets bewerken</button>
      <span class="sc-nterm">N-term
        <span class="num-spinner spinner-wrap-sm" id="sc-nterm"
          data-val="${escHtml(String(exam.n_term ?? 1))}" data-step="0.1" data-min="0" data-max="3">
          <button type="button" class="spin-btn spin-minus" aria-label="N-term lager">&minus;</button>
          <input class="spin-val" aria-label="N-term" value="${formatNumber(exam.n_term ?? 1)}" />
          <button type="button" class="spin-btn spin-plus" aria-label="N-term hoger">+</button>
        </span>
      </span>`,
    body: '<div id="sc-grid-container"></div>',
    footerHtml: `
      <span class="sc-legend"><i class="sc-full"></i>volle punten</span>
      <span class="sc-legend"><i class="sc-part"></i>deels</span>
      <span class="sc-legend"><i class="sc-zero"></i>0 punten</span>
      <span class="sc-legend"><i class="sc-n"></i>N = niet gemaakt</span>
      <span class="sc-saved" id="sc-saved" role="status">● Alles opgeslagen</span>`,
    onShow: async (el: HTMLElement) => {
      wireSpinners(el);
      const ntermSp = el.querySelector<HTMLElement>('#sc-nterm')!;
      const ntermInput = ntermSp.querySelector<HTMLInputElement>('.spin-val')!;
      const handleNtermChange = async () => {
        const val = spinnerValue(ntermSp);
        const active = session.activeExam;
        if (isNaN(val) || !active) return;
        active.n_term = val;
        await Store.setExamNTerm(active.id, val, year);
        recomputeAllRows();
      };
      ntermSp
        .querySelectorAll('.spin-btn')
        .forEach((b) => b.addEventListener('click', () => setTimeout(handleNtermChange, 0)));
      ntermInput.addEventListener('change', () => void handleNtermChange());

      el.querySelector<HTMLInputElement>('#sc-dot-n')!.addEventListener('change', (e) => {
        session.numpadDotIsN = (e.target as HTMLInputElement).checked;
      });

      wireHistory(
        el.querySelector<HTMLButtonElement>('#sc-undo')!,
        el.querySelector<HTMLButtonElement>('#sc-redo')!,
      );
      wireHelp(el);
      const savedEl = el.querySelector<HTMLElement>('#sc-saved')!;
      session.onSaveState = () => showSaveState(savedEl);
      onModalCleanup(resetScoreModal);

      el.querySelector('#sc-edit-exam')!.addEventListener('click', () => {
        closeModal();
        deps.openExamModal(examId, () => {
          deps.renderToetsenList();
          openScoreModal(examId, year, deps);
        });
      });

      modalState.open = true;
      onModalCleanup(() => (modalState.open = false));

      // ── Presence: tell colleagues we're here, show who else is ─────────────
      Presence.setScoreModal({ year, subject: Store.getActiveSubject(), examId });
      onModalCleanup(() => Presence.setScoreModal(null));
      onModalCleanup(Presence.onChange(() => void renderPresence(el, examId, year)));

      // ── Changes made by other teachers while this modal is open ────────────
      onModalSync('scores', (ev: SyncEvent) => {
        if (ev.year !== year || ev.subject !== Store.getActiveSubject()) return;
        if (ev.after === null && ev.kind !== 'deleted') return; // not loaded here
        session.rowUpdaters.forEach((apply) => apply(ev.id, ev.after as never));
      });

      // An N-term change by someone else is applied in place. Any other edit of this exam
      // reloads the modal; a deleted exam closes it.
      onModalSync('exam', async (ev: SyncEvent) => {
        const active = session.activeExam;
        if (ev.id !== examId || ev.year !== year || !active) return;
        const after = ev.after as Exam | null;
        if (!after) {
          showReloadNotice(
            `Toets ${active.title} is verwijderd door een collega. Het scorescherm wordt gesloten.`,
            closeModal,
          );
          return;
        }
        if (!onlyNTermDiffers(active, after)) {
          const who = await changedByName(ev);
          showReloadNotice(
            `Toets ${after.title} is gewijzigd door ${who}. Het scorescherm wordt opnieuw geladen.`,
            () => reloadScoreModal(examId, year, deps),
          );
          return;
        }
        if (document.activeElement === ntermInput) return; // the user's own input wins
        const val = after.n_term ?? 1;
        if (val === active.n_term) return;
        active.n_term = val;
        ntermSp.dataset.val = String(val);
        ntermInput.value = formatNumber(val);
        recomputeAllRows();
        ntermInput.style.transition = 'none';
        ntermInput.style.background = REMOTE_FLASH_COLOR;
        setTimeout(() => {
          ntermInput.style.transition = 'background 0.6s';
          ntermInput.style.background = '';
        }, REMOTE_FLASH_MS);
      });

      // Groups, students or observaties shown in this modal changed: reload it.
      const NOTICE_SUBJECT = {
        group: 'Groepsgegevens',
        students: 'Leerlinggegevens',
        observatie: 'Observaties',
      } as const;
      for (const type of Object.keys(NOTICE_SUBJECT) as (keyof typeof NOTICE_SUBJECT)[]) {
        onModalSync(type, async (ev: SyncEvent) => {
          if (ev.year && ev.year !== year) return;
          const active = session.activeExam;
          if (!active || rosterSignature(active, year) === session.activeRoster) return;
          const who = await changedByName(ev);
          showReloadNotice(
            `${NOTICE_SUBJECT[type]} zijn gewijzigd door ${who}. Het scorescherm wordt opnieuw geladen.`,
            () => reloadScoreModal(examId, year, deps),
          );
        });
      }

      const container = el.querySelector<HTMLElement>('#sc-grid-container')!;
      const shown = () => {
        // Keyboard navigation scrolls a cell clear of the sticky parts (review 25 M1).
        const thead = container.querySelector<HTMLElement>('.score-grid-table thead');
        if (thead?.offsetHeight) {
          container.style.setProperty('--sc-thead-h', `${thead.offsetHeight}px`);
        }
        void renderPresence(el, examId, year);
        void afterPaint().then(endOpen);
      };
      if (pre) {
        // Later groups of the prebuild keep arriving in `grids`, now in the modal.
        container.appendChild(pre.grids);
        pre.host.remove();
        void pre.first.then(shown);
        await pre.done;
      } else {
        await loadScoreGrid(String(exam.jaarlaag), examId, container, year, shown);
      }
      // All grids built: colleagues' cursors in the later ones too.
      void renderPresence(el, examId, year);
      void afterPaint().then(endOpen); // no grid at all (no groups)
    },
    // The exam list shows statistics: redraw it only when something was saved.
    onClose: () => {
      if (Store.generation() !== generationAtOpen) deps?.renderToetsenList?.();
    },
  });
}

interface PresenceEntry {
  userId: string;
  status: string;
  scoreModal: { cell?: { studentId: string; questionId: string } };
}

interface PresenceUser {
  id: string;
  kleur?: string;
  voornaam?: string;
  afkorting?: string;
  [key: string]: unknown;
}

// Badges of colleagues in this score modal (green: entered scores in the last 2 minutes,
// orange: only has it open) and their cursor positions in the grids.
async function renderPresence(el: HTMLElement, examId: string, year: string): Promise<void> {
  const host = el.querySelector<HTMLElement>('#sc-presence');
  if (!host) return;
  const users = (await Store.loadUsers()) as PresenceUser[];
  const others = (Presence.inScoreModal(year, Store.getActiveSubject(), examId) as PresenceEntry[])
    .map((o) => ({ ...o, user: users.find((u) => u.id === o.userId) }))
    .filter((o): o is PresenceEntry & { user: PresenceUser } => !!o.user);
  host.innerHTML = others
    .map((o) => {
      const name = Store.fullName(o.user);
      const what =
        o.status === 'active'
          ? 'heeft de afgelopen 2 minuten scores ingevoerd'
          : 'heeft dit scorescherm open';
      return Presence.badgeHtml(o.user, o.status, `${name} ${what}`);
    })
    .join('');
  void Presence.loadPhotos(host);
  const active = others.find((o) => o.status === 'active');
  session.remoteFlashColor = active?.user.kleur ?? REMOTE_FLASH_COLOR;
  const cursors = others.flatMap((o) =>
    o.scoreModal.cell
      ? [
          {
            ...o.scoreModal.cell,
            color: o.user.kleur ?? '#888',
            name: o.user.voornaam || o.user.afkorting || '?',
          },
        ]
      : [],
  );
  session.cursorUpdaters.forEach((draw) => draw(cursors));
}

// Close and reopen the score modal after committing any open cell editor.
async function reloadScoreModal(examId: string, year: string, deps: ScoreModalDeps) {
  session.gridInstances.forEach((g) => g.finishEditing());
  await waitForPendingSaves();
  closeModal();
  if ((Store.getExamsSync(year) as Exam[]).some((e) => e.id === examId)) {
    openScoreModal(examId, year, deps);
  }
}

// The ? button: its explanation shows on hover and focus (CSS) and stays open after a click
// until the next click, Escape or a click elsewhere.
function wireHelp(el: HTMLElement): void {
  const btn = el.querySelector<HTMLButtonElement>('#sc-help')!;
  const wrap = btn.parentElement!;
  const setOpen = (open: boolean) => {
    wrap.classList.toggle('sc-help-wrap--open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', () => setOpen(!wrap.classList.contains('sc-help-wrap--open')));
  const onDown = (e: MouseEvent) => {
    if (!wrap.contains(e.target as Node)) setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !wrap.classList.contains('sc-help-wrap--open')) return;
    e.preventDefault(); // handled: the modal stays open
    e.stopPropagation();
    setOpen(false);
  };
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  onModalCleanup(() => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  });
}

// The footer's save status: saving, all saved, or how many cells were not saved.
function showSaveState(el: HTMLElement): void {
  const failed = unsavedCount();
  const busy = pendingSaves.size > 0;
  el.dataset.state = failed ? 'error' : busy ? 'busy' : 'ok';
  el.textContent = failed
    ? `● ${failed} ${failed === 1 ? 'score' : 'scores'} niet opgeslagen`
    : busy
      ? 'Opslaan…'
      : '● Alles opgeslagen';
}
