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
  recomputeAllRows,
  resetScoreModal,
  session,
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

const HELP =
  "Navigeer sneller door gebruik te maken van de numpad:&#10;0-9: Punten invullen&#10;Punt (.): N invullen (als '. → N' aangevinkt is)&#10;Enter: Bevestigen &amp; volgende veld&#10;/ of *: Vorige / volgende veld&#10;- of +: Vorige / volgende leerling&#10;F1, F2, …: Eerste, tweede, … observatie aan/uit voor de huidige leerling&#10;&#10;Cijfer overschrijven: typ een cijfer in de kolom Cijfer. Leegmaken (of rechtermuisklik) herstelt het berekende cijfer.";

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
    }<span>${escHtml(exam.title ?? '')}</span>`,
    className: 'modal-scores',
    fixedHeight: true,
    // The toolbar row stays in place: only the grids scroll (#sc-grid-container).
    body: `
    <div class="u-d-flex u-items-center u-gap-12 u-mb-16 u-flex-wrap u-shrink-0">
      <div class="u-d-flex u-items-center u-gap-6 u-flex-1 u-min-w-0">
        <div id="sc-presence" class="presence-badges"></div>
      </div>
      <div class="u-d-flex u-items-center u-gap-4 u-shrink-0">
        <button class="btn btn--icon" id="sc-undo" title="Ongedaan maken (Ctrl+Z)">&#x21B6;</button>
        <button class="btn btn--icon" id="sc-redo" title="Opnieuw (Ctrl+Y)">&#x21B7;</button>
        <button class="btn btn--secondary u-cursor-default u-text-subtle u-border-light" id="sc-help" disabled
          title="${HELP}">Help ?</button>
        <label class="sc-dot-toggle"
          title="Als deze checkbox aangevinkt is, wordt de Numpad '.' een sneltoets voor &quot;Niet gemaakt&quot;. Je kunt dan geen halve punten meer invoeren met alleen het numpad.">
          <input type="checkbox" id="sc-dot-n" ${session.numpadDotIsN ? 'checked' : ''} /> . → N
        </label>
      </div>
      <div class="u-d-flex u-items-center u-gap-8 u-shrink-0">
        <button class="btn btn--secondary" id="sc-edit-exam">Toets bewerken</button>
        <span class="toolbar-label">N-term:</span>
        <div class="num-spinner spinner-wrap-sm" id="sc-nterm"
          data-val="${exam.n_term ?? 1}" data-step="0.1" data-min="0" data-max="3">
          <button type="button" class="spin-btn spin-minus">&minus;</button>
          <input class="spin-val" value="${formatNumber(exam.n_term ?? 1)}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
    </div>
    <div id="sc-grid-container"></div>
  `,
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

      const shown = () => {
        void renderPresence(el, examId, year);
        void afterPaint().then(endOpen);
      };
      const container = el.querySelector<HTMLElement>('#sc-grid-container')!;
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
