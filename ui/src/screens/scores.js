// SPDX-License-Identifier: AGPL-3.0-or-later

import { gradeColor, stdDevGradeColor, rttiPctColor, examTypeColor } from '../utils/colors.js';
import { wireSpinners, spinnerValue } from '../utils/spinners.js';
import {
  showModal,
  closeModal,
  toast,
  persistentError,
  escHtml,
  formatGrade,
  onModalSync,
  showReloadNotice,
  changedByName,
  onModalCleanup,
} from '../app.js';
import * as Presence from '../presence.js';
import { createScoreGrid } from '../components/score-grid/score-grid';
import {
  computeRowStatus as rowStatusOf,
  normalizeScore,
  parseGradeInput,
  parseScoreNum,
  recomputeRow,
  recomputeSummaryRow,
  sameOverride,
  scoreCellText,
} from '../domain/scoregrid';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Scores invoeren
// Col layout (TOFF = O > 0 ? O + 1 : 0):
//   0..1        = id, naam
//   2..N+1      = question scores
//   N+2         = spacer1
//   N+3..N+2+O  = obs checkboxes (only when O > 0)
//   N+3+O       = spacer2 (only when O > 0)
//   N+3+TOFF    = Totaal
//   N+4+TOFF    = Cijfer
//   N+5+TOFF    = spacer3
//   N+6+TOFF    = R%
//   N+7+TOFF    = T1%
//   N+8+TOFF    = T2%
//   N+9+TOFF    = I%
// When O=0, TOFF=0 and layout matches the simpler variant without obs cols.
// ═══════════════════════════════════════════════════════════════════════════════

let activeExam = null;
let activeObs = []; // observaties applicable to current exam jaarlaag
let activeGridData = [];
let gridInstances = [];
let scoreHistory = []; // undo stack
let redoHistory = []; // redo stack
let undoKeydownHandler = null;
let undoBtnEl = null;
let redoBtnEl = null;
const MAX_HISTORY = 50;
// Numpad '.' writes N instead of a decimal point (toggle in the modal header;
// kept for the rest of the app session).
let numpadDotIsN = true;

// ── Background changes (other teachers) ──────────────────────────────────────
// One updater per group grid: (studentId, scoreRecord) => applies that record.
let rowUpdaters = [];
// Groups, students and observaties shown in the open modal; when a background
// change alters this, the modal has to be reloaded.
let activeRoster = null;
// Cells with a save in flight ("studentId:col" -> count). Background updates
// skip these, so a slightly older file on disk never overwrites fresh input.
const pendingSaves = new Map();
const REMOTE_FLASH_MS = 2000;
const REMOTE_FLASH_COLOR = '#f5a623';
// Outline color for cells changed by a colleague: the color of the colleague
// in this modal who edited most recently (set by renderPresence).
let remoteFlashColor = REMOTE_FLASH_COLOR;
// One per group grid: (cursors) => draws colleagues' positions in that grid.
let cursorUpdaters = [];

// Saves run one after the other, in the order they were made: a value typed
// while an earlier save is still in flight is queued, never dropped (U2).
let saveChain = Promise.resolve();
// Cells whose last save failed ("studentId:col"); typing the same value again
// retries the save (G53).
const unsavedCells = new Set();

const cellKey = (student, col) => `${student?.id}:${col}`;
const isUnsaved = (student, col) => unsavedCells.has(cellKey(student, col));

function renderAllGrids() {
  gridInstances.forEach((g) => g.render());
}

/**
 * Queues `write` (a Store call saving one cell of `student`) behind the saves
 * before it. The cell counts as "save in flight" from now on, so background
 * updates leave it alone (see pendingSaves). A conflict rejects the returned
 * promise (reported by the global handler in app.js); any other failure is
 * shown and marks the cell as not saved.
 */
function saveCell(student, col, write) {
  const key = cellKey(student, col);
  pendingSaves.set(key, (pendingSaves.get(key) ?? 0) + 1);
  Presence.markEdit();
  const run = saveChain.then(async () => {
    try {
      await write();
      if (unsavedCells.delete(key)) renderAllGrids();
    } catch (err) {
      if (err?.code === 'conflict') throw err;
      // U3: any other failure (locked file, broken JSON, disk full) was silently lost.
      unsavedCells.add(key);
      renderAllGrids();
      persistentError(
        `Score niet opgeslagen (${student ? Store.fullName(student) : 'onbekend'}): ${err?.message ?? err}. Controleer de gedeelde map en voer de score opnieuw in.`,
      );
    } finally {
      const n = pendingSaves.get(key) - 1;
      if (n > 0) pendingSaves.set(key, n);
      else pendingSaves.delete(key);
    }
  });
  saveChain = run.catch(() => {});
  return run;
}

/** Resolves when every queued score save has run (before a change of user or subject). */
export function scoreSavesDone() {
  return saveChain;
}

async function waitForPendingSaves(timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (pendingSaves.size > 0 && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

function changedInBackground(action) {
  toast(`Niet ${action}: deze score is intussen door een collega gewijzigd.`, 'info');
  return false;
}

function updateUndoRedoBtns() {
  if (undoBtnEl) undoBtnEl.disabled = scoreHistory.length === 0;
  if (redoBtnEl) redoBtnEl.disabled = redoHistory.length === 0;
}

// While set, pushHistory collects entries here (one undo step for a paste or
// Delete of a range, review 3b m6).
let historyBatch = null;

function pushHistory(entry) {
  if (historyBatch) {
    historyBatch.push(entry);
    return;
  }
  scoreHistory.push(entry);
  if (scoreHistory.length > MAX_HISTORY) scoreHistory.shift();
  redoHistory = []; // a new action clears the redo stack
  updateUndoRedoBtns();
}

async function undoLast() {
  if (scoreHistory.length === 0) return;
  const entry = scoreHistory.pop();
  redoHistory.push(entry);
  // An entry returns false when the cell was changed by someone else since;
  // it is then dropped instead of overwriting their value.
  if ((await entry.undo()) === false) redoHistory.pop();
  updateUndoRedoBtns();
}

async function redoLast() {
  if (redoHistory.length === 0) return;
  const entry = redoHistory.pop();
  scoreHistory.push(entry);
  if ((await entry.redo()) === false) scoreHistory.pop();
  updateUndoRedoBtns();
}

export function destroyGridInstances() {
  gridInstances.forEach((g) => g.destroy());
  gridInstances = [];
  unsavedCells.clear();
  rowUpdaters = [];
  cursorUpdaters = [];
  activeRoster = null;
  activeGridData = [];
  activeExam = null;
  activeObs = [];
}

// Everything the score modal set up: the grids, the undo history and its
// buttons, and the Ctrl+Z / Ctrl+Y listener. loadScoreGrid only replaces the
// grids, so the listener and buttons stay wired (U1).
function resetScoreModal() {
  destroyGridInstances();
  scoreHistory = [];
  redoHistory = [];
  undoBtnEl = null;
  redoBtnEl = null;
  if (undoKeydownHandler) {
    document.removeEventListener('keydown', undoKeydownHandler);
    undoKeydownHandler = null;
  }
}

export async function openScoreModal(examId, year, deps) {
  resetScoreModal();
  const exam = Store.getExamsSync(year).find((e) => e.id === examId);
  if (!exam) return;

  showModal(
    `
    <div class="u-d-flex u-items-center u-gap-12 u-mb-16 u-flex-wrap u-pr-30 u-shrink-0">
      <div class="u-d-flex u-items-center u-gap-6 u-flex-1 u-min-w-0 u-fs-17 u-fw-600">
        <span class="u-nowrap">Scores invoeren voor</span>
        ${
          exam.volgnummer
            ? `<span class="volgnummer u-mr-0 u-shrink-0" data-bg="${examTypeColor(exam)}">${escHtml(String(exam.volgnummer))}</span>`
            : ''
        }
        <em class="u-min-w-0 u-overflow-hidden u-ellipsis u-nowrap">${escHtml(exam.title)}</em>
        <div id="sc-presence" class="presence-badges"></div>
      </div>
      <div class="u-d-flex u-items-center u-gap-4 u-shrink-0">
        <button class="u-w-32 u-h-32 u-p-0 u-fs-16 btn-secondary" id="sc-undo" title="Ongedaan maken (Ctrl+Z)">&#x21B6;</button>
        <button class="u-w-32 u-h-32 u-p-0 u-fs-16 btn-secondary" id="sc-redo" title="Opnieuw (Ctrl+Y)">&#x21B7;</button>
        <button class="u-cursor-default u-text-subtle u-border-light btn-secondary" id="sc-help" disabled
          title="Navigeer sneller door gebruik te maken van de numpad:&#10;0-9: Punten invullen&#10;Punt (.): N invullen (als '. → N' aangevinkt is)&#10;Enter: Bevestigen &amp; volgende veld&#10;/ of *: Vorige / volgende veld&#10;- of +: Vorige / volgende leerling&#10;F1, F2, …: Eerste, tweede, … observatie aan/uit voor de huidige leerling&#10;&#10;Cijfer overschrijven: typ een cijfer in de kolom Cijfer. Leegmaken (of rechtermuisklik) herstelt het berekende cijfer."
         >Help ?</button>
        <label class="sc-dot-toggle"
          title="Als deze checkbox aangevinkt is, wordt de Numpad '.' een sneltoets voor &quot;Niet gemaakt&quot;. Je kunt dan geen halve punten meer invoeren met alleen het numpad.">
          <input type="checkbox" id="sc-dot-n" ${numpadDotIsN ? 'checked' : ''} /> . → N
        </label>
      </div>
      <div class="u-d-flex u-items-center u-gap-8 u-shrink-0">
        <button class="btn-secondary" id="sc-edit-exam">Toets bewerken</button>
        <span class="toolbar-label">N-term:</span>
        <div class="num-spinner spinner-wrap-sm" id="sc-nterm"
          data-val="${exam.n_term ?? 1}" data-step="0.1" data-min="0" data-max="3">
          <button type="button" class="spin-btn spin-minus">&minus;</button>
          <input class="spin-val" value="${String(exam.n_term ?? 1).replace('.', ',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
    </div>
    <div id="sc-grid-container"></div>
  `,
    async (el) => {
      wireSpinners(el);

      const ntermSp = el.querySelector('#sc-nterm');
      const handleNtermChange = async () => {
        const val = spinnerValue(ntermSp);
        if (isNaN(val) || !activeExam) return;
        activeExam.n_term = val;
        await Store.setExamNTerm(activeExam.id, val, year);
        recomputeAllRows();
      };
      ntermSp
        .querySelectorAll('.spin-btn')
        .forEach((b) => b.addEventListener('click', () => setTimeout(handleNtermChange, 0)));
      ntermSp.querySelector('.spin-val').addEventListener('change', handleNtermChange);

      el.querySelector('#sc-dot-n').addEventListener('change', (e) => {
        numpadDotIsN = e.target.checked;
      });

      undoBtnEl = el.querySelector('#sc-undo');
      redoBtnEl = el.querySelector('#sc-redo');
      undoBtnEl.addEventListener('click', () => undoLast());
      redoBtnEl.addEventListener('click', () => redoLast());
      updateUndoRedoBtns();

      // Also from the score grid, which leaves these keys to the app (G46, U1).
      undoKeydownHandler = (e) => {
        // While typing in a cell, Ctrl+Z undoes the typing (native text undo).
        if (e.target?.classList?.contains('score-grid-editor')) return;
        const key = e.key.toLowerCase(); // 'Z' with Shift or Caps Lock
        if (e.ctrlKey && !e.shiftKey && key === 'z') {
          e.preventDefault();
          undoLast();
        }
        if ((e.ctrlKey && key === 'y') || (e.ctrlKey && e.shiftKey && key === 'z')) {
          e.preventDefault();
          redoLast();
        }
      };
      document.addEventListener('keydown', undoKeydownHandler);
      onModalCleanup(resetScoreModal);

      el.querySelector('#sc-edit-exam').addEventListener('click', () => {
        closeModal();
        deps.openExamModal(examId, async () => {
          deps.renderToetsenList();
          openScoreModal(examId, year, deps);
        });
      });

      // ── Presence: tell colleagues we're here, show who else is ─────────────
      Presence.setScoreModal({ year, subject: Store.getActiveSubject(), examId });
      onModalCleanup(() => Presence.setScoreModal(null));
      onModalCleanup(Presence.onChange(() => renderPresence(el, examId, year)));

      // ── Changes made by other teachers while this modal is open ────────────
      onModalSync('scores', (ev) => {
        if (ev.year !== year || ev.subject !== Store.getActiveSubject()) return;
        if (ev.after === null && ev.kind !== 'deleted') return; // not loaded here
        rowUpdaters.forEach((apply) => apply(ev.id, ev.after));
      });

      // An N-term change by someone else is applied in place. Any other edit
      // of this exam reloads the modal; a deleted exam closes it.
      onModalSync('exam', async (ev) => {
        if (ev.id !== examId || ev.year !== year || !activeExam) return;
        if (!ev.after) {
          showReloadNotice(
            `Toets ${activeExam.title} is verwijderd door een collega. Het scorescherm wordt gesloten.`,
            closeModal,
          );
          return;
        }
        if (!onlyNTermDiffers(activeExam, ev.after)) {
          const who = await changedByName(ev);
          showReloadNotice(
            `Toets ${ev.after.title} is gewijzigd door ${who}. Het scorescherm wordt opnieuw geladen.`,
            () => reloadScoreModal(examId, year, deps),
          );
          return;
        }
        const input = ntermSp.querySelector('.spin-val');
        if (document.activeElement === input) return; // the user's own input wins
        const val = ev.after.n_term ?? 1;
        if (val === activeExam.n_term) return;
        activeExam.n_term = val;
        ntermSp.dataset.val = val;
        input.value = String(val).replace('.', ',');
        recomputeAllRows();
        input.style.transition = 'none';
        input.style.background = REMOTE_FLASH_COLOR;
        setTimeout(() => {
          input.style.transition = 'background 0.6s';
          input.style.background = '';
        }, REMOTE_FLASH_MS);
      });

      // Groups, students or observaties shown in this modal changed: reload it.
      const NOTICE_SUBJECT = {
        group: 'Groepsgegevens',
        students: 'Leerlinggegevens',
        observatie: 'Observaties',
      };
      for (const type of Object.keys(NOTICE_SUBJECT)) {
        onModalSync(type, async (ev) => {
          if (ev.year && ev.year !== year) return;
          if (!activeExam || rosterSignature(activeExam, year) === activeRoster) return;
          const who = await changedByName(ev);
          showReloadNotice(
            `${NOTICE_SUBJECT[type]} zijn gewijzigd door ${who}. Het scorescherm wordt opnieuw geladen.`,
            () => reloadScoreModal(examId, year, deps),
          );
        });
      }

      await loadScoreGrid(
        String(exam.jaarlaag),
        examId,
        el.querySelector('#sc-grid-container'),
        year,
      );
      renderPresence(el, examId, year);
    },
    'modal-scores',
    deps?.renderToetsenList,
  );
}

// Badges of colleagues in this score modal (green: entered scores in the last
// 2 minutes, orange: only has it open) and their cursor positions in the grids.
async function renderPresence(el, examId, year) {
  const host = el.querySelector('#sc-presence');
  if (!host) return;
  const users = await Store.loadUsers();
  const others = Presence.inScoreModal(year, Store.getActiveSubject(), examId)
    .map((o) => ({ ...o, user: users.find((u) => u.id === o.userId) }))
    .filter((o) => o.user);
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
  const active = others.find((o) => o.status === 'active');
  remoteFlashColor = active?.user.kleur ?? REMOTE_FLASH_COLOR;
  const cursors = others
    .filter((o) => o.scoreModal.cell)
    .map((o) => ({
      ...o.scoreModal.cell,
      color: o.user.kleur ?? '#888',
      name: o.user.voornaam || o.user.afkorting || '?',
    }));
  cursorUpdaters.forEach((draw) => draw(cursors));
}

// Recalculate totals, grades and summary rows of every group (e.g. after an N-term change).
function recomputeAllRows() {
  activeGridData.forEach((gd) => {
    const ai = gd.findIndex((r) => r[0] === '__avg__');
    const si2 = gd.findIndex((r) => r[0] === '__std__');
    const _O = activeObs ? activeObs.length : 0;
    gd.forEach((_, ri) => {
      if (ri < ai) recomputeRow(gd, activeExam, ri, _O);
    });
    recomputeSummaryRow(gd, ai, si2, activeExam, _O);
  });
  renderAllGrids();
}

// JSON with sorted keys, so two versions of an object compare regardless of key order.
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

// True when two versions of an exam differ only in their N-term (and version info).
function onlyNTermDiffers(a, b) {
  const strip = ({ n_term: _n, _meta: _m, ...rest }) => rest;
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

// Groups (in display order) whose students take this exam.
export function examGroups(exam, year, jaarlaag = exam.jaarlaag) {
  const examSchoolsoort = exam.schoolsoort ?? [];
  return Store.getGroupsSync(year)
    .filter((g) => {
      if (String(g.jaarlaag) !== String(jaarlaag)) return false;
      if (examSchoolsoort.length === 0) return true;
      return (g.schoolsoort ?? []).some((ss) => examSchoolsoort.includes(ss));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupStudentsOf(group, allStudents) {
  return allStudents
    .filter((s) => group.student_ids.includes(s.id))
    .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));
}

// Everything about the modal's layout that comes from groups, students and observaties.
function rosterSignature(exam, year) {
  const allStudents = Store.getStudentsSync(year);
  const allObs = Store.getObservatiesSync();
  return stableStringify({
    groups: examGroups(exam, year).map((g) => [
      g.id,
      g.name,
      groupStudentsOf(g, allStudents).map((s) => [s.id, Store.fullName(s)]),
    ]),
    obs: (exam.obs_ids ?? []).map((id) => {
      const o = allObs.find((x) => x.id === id);
      return o ? [o.id, o.naam, o.icon] : null;
    }),
  });
}

// Close and reopen the score modal after committing any open cell editor.
async function reloadScoreModal(examId, year, deps) {
  gridInstances.forEach((g) => g.finishEditing());
  await waitForPendingSaves();
  closeModal();
  if (Store.getExamsSync(year).some((e) => e.id === examId)) openScoreModal(examId, year, deps);
}

export async function loadScoreGrid(jaarlaag, examId, container, year) {
  destroyGridInstances();
  // Saves queued from a previous modal must land before the files are read (review 3b m7).
  await saveChain;
  if (!container) container = document.getElementById('score-grid-container');
  if (!examId) {
    container.innerHTML = '<p class="hint">Selecteer een toets.</p>';
    return;
  }

  if (!year) year = Store.getConfigSync().activeYear;
  const exam = Store.getExamsSync(year).find((e) => e.id === examId);
  if (!exam) return;
  activeExam = { ...exam };
  activeRoster = rosterSignature(exam, year);

  const groups = examGroups(exam, year, jaarlaag);
  const allStudents = Store.getStudentsSync(year);

  if (groups.length === 0) {
    container.innerHTML = '<p class="hint">Geen groepen gevonden. Voeg eerst groepen toe.</p>';
    return;
  }

  container.innerHTML = '';

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const groupStudents = groupStudentsOf(group, allStudents);
    if (groupStudents.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'score-group-section';
    section.innerHTML = `<h3 class="group-heading">${escHtml(group.name)}</h3><div class="score-grid-host"></div>`;
    container.appendChild(section);

    // Row: [id, naam, ...N scores, spacer1, ...O obs, spacer2?, Totaal, Cijfer, spacer3, R%, T1%, T2%, I%]
    const N = exam.questions.length;
    const gridData = [];
    const allObs = Store.getObservatiesSync();
    activeObs = (exam.obs_ids ?? [])
      .map((id) => allObs.find((o) => o.id === id))
      .filter(Boolean)
      .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));

    const scoreRecs = await Promise.all(
      groupStudents.map((s) => Store.getStudentScores(s.id, year)),
    );

    for (let si = 0; si < groupStudents.length; si++) {
      const s = groupStudents[si];
      const rec = scoreRecs[si];
      const examScores = rec.scores[examId] ?? {};
      const examObsIds = rec.observations?.[examId] ?? [];
      const row = [String(s.id), Store.fullName(s)];
      exam.questions.forEach((q) => {
        const v = examScores[q.id];
        row.push(v === undefined ? '' : v === null ? 'N' : scoreCellText(v));
      });
      // spacer1 (N+2)
      row.push('');
      // obs cols (N+3..N+2+O) and spacer2 (N+3+O) — only when O > 0
      if (activeObs.length > 0) {
        activeObs.forEach((o) => row.push(examObsIds.includes(o.id)));
        row.push(''); // spacer2
      }
      // Totaal, Cijfer, spacer3, R%, T1%, T2%, I%
      row.push('', '', '', '', '', '', '');
      gridData.push(row);
    }

    // Summary rows: avg (sentinel __avg__) then std dev (sentinel __std__)
    const O = activeObs.length;
    const obsInsert = O > 0 ? [...Array(O).fill(''), ''] : [];
    const trailCells = ['', ...obsInsert, '', '', '', '', '', '', ''];
    gridData.push(['__avg__', 'Gemiddelde', ...Array(N).fill(''), ...trailCells]);
    gridData.push(['__std__', 'Standaarddeviatie', ...Array(N).fill(''), ...trailCells]);

    const avgIdx = gridData.length - 2;
    const stdIdx = gridData.length - 1;
    // Overwritten grades per student row ({ cijfer, berekend }), and what
    // recomputeRow derived from them (for the Cijfer cell's look and tooltip).
    gridData.overrides = scoreRecs.map((rec) => rec.overrides?.[examId]);
    gridData.gradeInfo = [];
    gridData.forEach((_, ri) => {
      if (ri < avgIdx) recomputeRow(gridData, activeExam, ri, O);
    });
    recomputeSummaryRow(gridData, avgIdx, stdIdx, activeExam, O);
    activeGridData.push(gridData);

    const grid = createGroupGrid(
      section.querySelector('.score-grid-host'),
      activeExam,
      groupStudents,
      gridData,
      year,
      activeObs,
    );
    gridInstances.push(grid);

    // Center the grid (and its heading) when it is narrower than the modal.
    const tableWidth = grid.table.offsetWidth;
    if (tableWidth > 0) {
      section.style.maxWidth = `${tableWidth + 2}px`;
      section.style.marginInline = 'auto';
    }
  }
}

// Small context menu at (x, y) with the look of the exam card menus.
// items: [{ icon, label, run }]
function showCellMenu(x, y, items) {
  const menu = document.createElement('div');
  menu.className = 'exam-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map(
      (it, i) =>
        `<button class="exam-menu-item" role="menuitem" data-idx="${i}"><span class="exam-menu-icon">${escHtml(it.icon)}</span><span>${escHtml(it.label)}</span></button>`,
    )
    .join('');
  document.body.appendChild(menu);
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;

  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
  };
  const onDocDown = (e) => {
    if (!menu.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // don't close the score modal as well
    close();
  };
  menu.addEventListener('click', (e) => {
    const el = e.target.closest('.exam-menu-item');
    if (!el) return;
    close();
    items[Number(el.dataset.idx)].run();
  });
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  onModalCleanup(close);
}

export function createGroupGrid(container, exam, students, gridData, year, obsArr = []) {
  const N = exam.questions.length;
  const summaryIdx = gridData.findIndex((r) => r[0] === '__avg__');
  const stdIdx = gridData.findIndex((r) => r[0] === '__std__');
  const O = obsArr.length;
  // ── Navigation constants ──────────────────────────────────────────────────
  const firstQCol = 2;
  const lastQCol = N + 1;
  const obsStart = N + 3; // first obs col (only valid when O > 0)
  const firstObsCol = obsStart;
  const lastObsCol = O > 0 ? obsStart + O - 1 : -1;
  const firstDataRow = 0;
  const lastDataRow = summaryIdx - 1;
  const gradeCol = N + 4 + (O > 0 ? O + 1 : 0);

  const editableCols = [
    ...Array.from({ length: N }, (_, i) => 2 + i),
    ...(O > 0 ? Array.from({ length: O }, (_, i) => obsStart + i) : []),
  ];

  function isQCol(col) {
    return col >= firstQCol && col <= lastQCol;
  }
  function isObsCol(col) {
    return O > 0 && col >= firstObsCol && col <= lastObsCol;
  }
  // Returns the first empty question col, or null if all are filled.
  function firstEmptyQ(row) {
    for (let c = firstQCol; c <= lastQCol; c++) {
      const v = gridData[row][c];
      if (v === '' || v === undefined || v === null) return c;
    }
    return null;
  }
  function goTo(row, col) {
    if (row < firstDataRow || row > lastDataRow) return;
    if (col < 0) return;
    grid.selectCell(row, col);
  }

  // ── Selected cell tracking (per grid) ─────────────────────────────────────
  let selectedCell = { row: -1, col: -1 };

  // ── Saving & background changes ───────────────────────────────────────────
  const save = (row, col, write) => saveCell(students[row], col, write);
  // Saves are queued and may run after a switch of subject: pin this one.
  const subject = Store.getActiveSubject();

  // Cells recently changed by someone else ("row:col" -> time the flash ends).
  const flashUntil = new Map();

  // Apply a score file saved by another teacher to this student's row.
  function applyRemoteRecord(studentId, rec) {
    const row = students.findIndex((st) => String(st.id) === String(studentId));
    if (row < 0 || grid.isDestroyed) return;
    const examScores = rec?.scores?.[exam.id] ?? {};
    const obsIds = rec?.observations?.[exam.id] ?? [];
    const editing = grid.getEditingCell();
    const isEditing = (col) => editing && editing[0] === row && editing[1] === col;
    let changed = false;
    const setCell = (col, value) => {
      if (gridData[row][col] === value) return;
      if (isEditing(col)) return;
      if (pendingSaves.has(cellKey(students[row], col))) return;
      gridData[row][col] = value;
      flashUntil.set(`${row}:${col}`, Date.now() + REMOTE_FLASH_MS);
      changed = true;
    };
    exam.questions.forEach((q, qi) => {
      const v = examScores[q.id];
      setCell(2 + qi, v === undefined ? '' : v === null ? 'N' : scoreCellText(v));
    });
    obsArr.forEach((o, oi) => setCell(obsStart + oi, obsIds.includes(o.id)));
    const override = rec?.overrides?.[exam.id];
    if (
      !sameOverride(override, gridData.overrides[row]) &&
      !pendingSaves.has(cellKey(students[row], gradeCol)) &&
      !isEditing(gradeCol)
    ) {
      gridData.overrides[row] = override;
      flashUntil.set(`${row}:${gradeCol}`, Date.now() + REMOTE_FLASH_MS);
      changed = true;
    }
    if (!changed) return;
    rowStatus[row] = computeRowStatus(row);
    recomputeRow(gridData, exam, row, O);
    recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, O);
    const rows = [row, summaryIdx, stdIdx];
    grid.render({ rows });
    setTimeout(() => {
      if (!grid.isDestroyed) grid.render({ rows });
    }, REMOTE_FLASH_MS + 50);
  }
  rowUpdaters.push(applyRemoteRecord);

  // ── Colleagues' cursors ───────────────────────────────────────────────────
  // Drawn as an overlay (thick colored border + name flag) on the group's
  // section, because table cells clip their content.
  let remoteCursors = [];
  const layer = container.parentElement;
  layer.style.position = 'relative';

  function cellOf({ studentId, questionId }) {
    const row = students.findIndex((st) => String(st.id) === String(studentId));
    if (row < 0) return null;
    if (String(questionId).startsWith('obs:')) {
      const oi = obsArr.findIndex((o) => `obs:${o.id}` === questionId);
      return oi < 0 ? null : { row, col: obsStart + oi };
    }
    const qi = exam.questions.findIndex((q) => q.id === questionId);
    return qi < 0 ? null : { row, col: 2 + qi };
  }

  function drawCursors() {
    layer.querySelectorAll(':scope > .remote-cursor').forEach((n) => n.remove());
    if (grid.isDestroyed) return;
    const base = layer.getBoundingClientRect();
    for (const cursor of remoteCursors) {
      const cell = cellOf(cursor);
      const td = cell && grid.getCell(cell.row, cell.col);
      if (!td) continue;
      const r = td.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'remote-cursor';
      box.style.cssText =
        `left:${r.left - base.left}px;top:${r.top - base.top}px;` +
        `width:${r.width}px;height:${r.height}px;--cursor-color:${cursor.color}`;
      box.innerHTML = `<span class="remote-cursor-flag">${escHtml(cursor.name)}</span>`;
      layer.appendChild(box);
    }
  }

  cursorUpdaters.push((cursors) => {
    remoteCursors = cursors;
    drawCursors();
  });

  // Question headers: RTTI (top) → pts → section → number (bottom)
  const qHeaders = exam.questions.map((q) => {
    const isSpecial = qKind(q) !== 'normal';
    const tooltip =
      qKind(q) === 'bonus' ? 'Bonusvraag' : qKind(q) === 'diag' ? 'Diagnostische vraag' : '';
    if (isSpecial) {
      return (
        `<span class="u-text-subtle u-italic" title="${tooltip}">` +
        `<span class="hdr-rtti">${escHtml(q.rtti)}</span>` +
        `<span class="hdr-pts">${q.max_points}p</span>` +
        `<span class="u-text-subtle hdr-opgave">${escHtml(q.section)}</span>` +
        `<span class="u-text-subtle hdr-vraag">${escHtml(String(q.number))}</span>` +
        `</span>`
      );
    }
    return (
      `<span class="hdr-rtti">${escHtml(q.rtti)}</span>` +
      `<span class="hdr-pts">${q.max_points}p</span>` +
      `<span class="hdr-opgave">${escHtml(q.section)}</span>` +
      `<span class="hdr-vraag">${escHtml(String(q.number))}</span>`
    );
  });
  // Tint bonus/diag question headers to match the cell background.
  const qHeaderClass = (q) =>
    qKind(q) === 'bonus' ? 'sg-hdr-bonus' : qKind(q) === 'diag' ? 'sg-hdr-diag' : undefined;

  const obsHeaders = obsArr.map(
    (o, oi) =>
      `<span class="hdr-obs" title="${escHtml(o.naam)}${oi < 12 ? ` (F${oi + 1})` : ''}">${escHtml(o.icon)}</span>`,
  );

  // ── Row validation status ─────────────────────────────────────────────────

  function computeRowStatus(rowIdx) {
    return rowStatusOf(gridData[rowIdx], exam);
  }

  const rowStatus = gridData.map((_, i) => computeRowStatus(i));

  // ── Highlight helper ──────────────────────────────────────────────────────

  function applyHighlight(TD, row, col) {
    const flashEnd = flashUntil.get(`${row}:${col}`);
    const flashing = flashEnd !== undefined && flashEnd > Date.now();
    if (flashEnd !== undefined && !flashing) flashUntil.delete(`${row}:${col}`);
    TD.style.boxShadow = flashing ? `inset 0 0 0 2px ${remoteFlashColor}` : '';
    // A save of this cell failed: it is retried when the value is typed again.
    TD.classList.toggle('cell-unsaved', row <= lastDataRow && isUnsaved(students[row], col));
    const onRow = row === selectedCell.row;
    const onCol = col === selectedCell.col;
    if (!onRow && !onCol) return;
    const alpha = onRow && onCol ? 0.16 : 0.08;
    // backgroundImage overlays on top of the background color already set
    TD.style.backgroundImage = `linear-gradient(rgba(74,144,217,${alpha}), rgba(74,144,217,${alpha}))`;
  }

  // Recompute a student's row and the summary rows after a change, and redraw
  // them (only them: a modal can hold 10,000 cells).
  function refreshRow(row) {
    rowStatus[row] = computeRowStatus(row);
    recomputeRow(gridData, exam, row, O);
    recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam, O);
    grid.render({ rows: [row, summaryIdx, stdIdx] });
  }

  // ── Scores ────────────────────────────────────────────────────────────────
  // Typed, pasted or cleared in a question cell. The cell shows the new value
  // at once; the save is queued (saveCell), so fast entry is never lost (U2).
  function scoreTyped(row, col, oldVal, newVal) {
    const student = students[row];
    const q = exam.questions[col - 2];
    if (!student || !q) return;
    const next = normalizeScore(newVal, q);
    const before = normalizeScore(oldVal, q).cell;
    // Unchanged: nothing to do, unless the last save of this cell failed.
    if (next.cell === before && !isUnsaved(student, col)) return;

    // Undo/redo only apply while the cell still holds the value this entry
    // left behind (a colleague may have changed it).
    const applyScore = (str) => {
      const { cell, value } = normalizeScore(str, q);
      gridData[row][col] = cell;
      refreshRow(row);
      return save(row, col, () => Store.setScore(student.id, exam.id, q.id, value, year, subject));
    };
    pushHistory({
      undo: () =>
        gridData[row][col] === next.cell
          ? applyScore(oldVal)
          : changedInBackground('ongedaan gemaakt'),
      redo: () =>
        gridData[row][col] === before
          ? applyScore(newVal)
          : changedInBackground('opnieuw uitgevoerd'),
    });
    const saved = applyScore(newVal);
    // Anything that is not empty, N or a number 0…max is kept as typed.
    if (typeof next.value === 'string') {
      persistentError(
        `Ongeldige score "${next.value}" voor vraag ${q.section}${q.number} (max ${q.max_points}). Controleer en herstel.`,
      );
    }
    return saved;
  }

  // ── Observations ──────────────────────────────────────────────────────────
  // Check or uncheck observation obsIdx for the student on `row`: undoable and
  // saved at once. Used by the checkboxes, the 0/1 keys, F1, F2, … and paste.
  function setObs(row, obsIdx, checked) {
    const col = obsStart + obsIdx;
    const obs = obsArr[obsIdx];
    const student = students[row];
    if (!obs || !student) return;
    const prevVal = gridData[row][col] === true;
    const apply = (val) => {
      gridData[row][col] = val;
      grid.render({ rows: [row] });
      return save(row, col, () =>
        Store.setObservation(student.id, exam.id, obs.id, val, year, subject),
      );
    };
    pushHistory({
      undo: () =>
        gridData[row][col] === checked ? apply(prevVal) : changedInBackground('ongedaan gemaakt'),
      redo: () =>
        gridData[row][col] === prevVal ? apply(checked) : changedInBackground('opnieuw uitgevoerd'),
    });
    return apply(checked);
  }

  // ── Overwritten grades ────────────────────────────────────────────────────
  // Set (cijfer) or remove (null) the overwritten grade of the student on
  // `row`: undoable and saved at once. `berekend` remembers the calculated
  // grade, so a later change of it can be flagged.
  function setGradeOverride(row, cijfer) {
    const student = students[row];
    if (!student) return;
    const prev = gridData.overrides[row];
    const calc = gridData.gradeInfo[row]?.calculatedGrade ?? null;
    const next =
      cijfer === null
        ? undefined
        : { cijfer, berekend: calc === null ? null : Math.round(calc * 10) / 10 };
    const apply = (ov) => {
      gridData.overrides[row] = ov;
      refreshRow(row);
      return save(row, gradeCol, () =>
        Store.setGradeOverride(
          student.id,
          exam.id,
          ov?.cijfer ?? null,
          ov?.berekend,
          year,
          subject,
        ),
      );
    };
    pushHistory({
      undo: () =>
        sameOverride(gridData.overrides[row], next)
          ? apply(prev)
          : changedInBackground('ongedaan gemaakt'),
      redo: () =>
        sameOverride(gridData.overrides[row], prev)
          ? apply(next)
          : changedInBackground('opnieuw uitgevoerd'),
    });
    return apply(next);
  }

  // Typed into the Cijfer cell: a grade overwrites, empty restores the calculated one.
  function gradeTyped(row, oldVal, newVal) {
    const raw = String(newVal ?? '').trim();
    const prev = gridData.overrides[row];
    const retry = isUnsaved(students[row], gradeCol);
    if (raw === '') {
      if (prev || retry) return setGradeOverride(row, null);
      return; // the calculated grade can't be removed
    }
    const cijfer = parseGradeInput(raw);
    if (isNaN(cijfer)) {
      toast(`Ongeldig cijfer "${raw}": vul een cijfer van 1,0 tot en met 10,0 in.`, 'error');
      return;
    }
    // Unchanged: nothing to do — except confirming a flagged override again,
    // which accepts the new calculated grade, or retrying a failed save.
    const unchanged = prev ? cijfer === prev.cijfer : raw === String(oldVal ?? '').trim();
    if (unchanged && !gridData.gradeInfo[row]?.stale && !retry) return;
    return setGradeOverride(row, cijfer);
  }

  // Edits from the grid: typed, pasted (also into observaties, U4) or cleared.
  function onGridChange(changes) {
    const batch = [];
    historyBatch = batch;
    try {
      for (const { row, col, oldValue, newValue } of changes) {
        if (row > lastDataRow) continue;
        if (col === gradeCol) gradeTyped(row, oldValue, newValue);
        else if (isQCol(col)) scoreTyped(row, col, oldValue, newValue);
        else if (isObsCol(col)) setObs(row, col - firstObsCol, newValue === true);
      }
    } finally {
      historyBatch = null;
    }
    if (batch.length === 1) pushHistory(batch[0]);
    else if (batch.length > 1) {
      // Entries changed by a colleague in the meantime are skipped one by one.
      pushHistory({
        undo: async () => {
          for (const e of [...batch].reverse()) await e.undo();
        },
        redo: async () => {
          for (const e of batch) await e.redo();
        },
      });
    }
  }

  // Right-click on an overwritten grade: "Berekend cijfer herstellen".
  container.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td');
    if (!td || grid.isDestroyed) return;
    const coords = grid.getCoords(td);
    if (!coords || coords.col !== gradeCol || coords.row < 0 || coords.row >= summaryIdx) return;
    if (!gridData.overrides[coords.row]) return;
    e.preventDefault();
    const items = [
      {
        icon: '↺',
        label: 'Berekend cijfer herstellen',
        run: () => setGradeOverride(coords.row, null),
      },
    ];
    // Accepting the new calculated grade = setting the same grade again.
    if (gridData.gradeInfo[coords.row]?.stale) {
      items.push({
        icon: '✓',
        label: 'Waarschuwing negeren',
        run: () => setGradeOverride(coords.row, gridData.overrides[coords.row].cijfer),
      });
    }
    showCellMenu(e.clientX, e.clientY, items);
  });

  // ── Cell renderers ────────────────────────────────────────────────────────
  // The grid has already reset the cell and set its text (or checkbox).

  // Background of the # and Naam cells: red for invalid scores, yellow for
  // missing scores, light blue for an overwritten grade.
  function rowBackground(row, status) {
    if (row === summaryIdx || row === stdIdx) return '#e8ecf2';
    if (status === 'invalid') return '#ff0033';
    if (status === 'partial') return '#fff3cd';
    if (gridData.gradeInfo[row]?.overridden) return '#dce9fa';
    return '#f8f9fb';
  }

  function idRenderer(TD, row, col) {
    const isSpecial = row === summaryIdx || row === stdIdx;
    const status = isSpecial ? null : rowStatus[row];
    TD.style.background = rowBackground(row, status);
    TD.style.color = status === 'invalid' ? '#fff' : '';
    TD.style.textAlign = 'center';
    if (isSpecial) TD.style.color = 'transparent';
    applyHighlight(TD, row, col);
  }

  function naamRenderer(TD, row, col) {
    const isSpecial = row === summaryIdx || row === stdIdx;
    const status = isSpecial ? null : rowStatus[row];
    TD.style.background = rowBackground(row, status);
    TD.style.color = status === 'invalid' ? '#fff' : isSpecial ? 'var(--muted, #7f8c8d)' : '#000';
    TD.style.fontWeight = isSpecial ? '700' : '400';
    TD.style.fontStyle = isSpecial ? 'italic' : 'normal';
    applyHighlight(TD, row, col);
  }

  function calcCentered(TD, row, col) {
    TD.style.textAlign = 'center';
    TD.style.background = row === summaryIdx || row === stdIdx ? '#dde4f0' : '#eef2f7';
    TD.style.fontWeight = '600';
    applyHighlight(TD, row, col);
  }

  function gradeRenderer(TD, row, col, value) {
    TD.style.textAlign = 'center';
    TD.style.fontWeight = 'bold';
    TD.style.color = '#000';
    if (row === stdIdx) {
      TD.style.background = stdDevGradeColor(value) || '#dde4f0';
    } else if (row === summaryIdx) {
      TD.style.background = gradeColor(value) || '#dde4f0';
    } else {
      TD.style.background = gradeColor(value) || '#eef2f7';
    }
    const info = row < summaryIdx ? gridData.gradeInfo[row] : null;
    const overridden = !!info?.overridden;
    TD.classList.toggle('grade-override', overridden);
    TD.classList.toggle('grade-override-stale', overridden && info.stale);
    TD.title = overridden
      ? `Met de hand overschreven cijfer. Berekend cijfer: ${formatGrade(info.calculatedGrade)}.` +
        (info.stale
          ? `\nLet op: het berekende cijfer is gewijzigd sinds het overschrijven (was ${formatGrade(info.berekend)}). Vul het cijfer opnieuw in om dit te bevestigen.`
          : '') +
        `\nLeegmaken of rechtermuisklik herstelt het berekende cijfer.`
      : '';
    applyHighlight(TD, row, col);
  }

  function rttiRenderer(TD, row, col, value) {
    TD.style.textAlign = 'center';
    TD.style.fontWeight = '500';
    TD.style.background = row === summaryIdx ? '#e8ecf2' : rttiPctColor(value) || '#eef2f7';
    applyHighlight(TD, row, col);
  }

  function scoreRenderer(TD, row, col, value) {
    TD.style.textAlign = 'center';
    if (row === summaryIdx || row === stdIdx) {
      TD.style.background = '#e8ecf2';
      applyHighlight(TD, row, col);
      return;
    }
    const q = exam.questions[col - 2];
    const kind = q ? qKind(q) : 'normal';

    // Bonus: always blue; Diag: always gray — regardless of value
    if (kind === 'bonus') {
      TD.style.background = '#cce5ff';
      TD.style.fontStyle = 'italic';
    } else if (kind === 'diag') {
      TD.style.background = '#d0d6df';
      TD.style.fontStyle = 'italic';
    }

    if (!value || !q) {
      applyHighlight(TD, row, col);
      return;
    }

    const upper = String(value).toUpperCase().trim();
    if (upper === 'N') {
      TD.style.background = '#d0d6df';
      TD.style.color = '#4a5568';
      TD.style.fontWeight = '600';
      applyHighlight(TD, row, col);
      return;
    }

    const num = parseScoreNum(value);
    if (isNaN(num) || num < 0 || num > q.max_points) {
      TD.style.background = '#ff0033';
      TD.style.color = '#fff';
      TD.style.fontWeight = '700';
      applyHighlight(TD, row, col);
      return;
    }

    // Normal questions: apply value-based colors
    if (kind === 'normal') {
      if (value === '0') {
        TD.style.background = '#f8d7da';
      } else if (num === q.max_points) {
        TD.style.background = '#d4edda';
      } else {
        TD.style.background = '#fff3cd';
      }
    }
    // Bonus/diag: keep their column background (already set above)
    applyHighlight(TD, row, col);
  }

  function obsRenderer(TD, row, col) {
    if (row === summaryIdx || row === stdIdx) TD.style.background = '#e8ecf2';
    applyHighlight(TD, row, col);
  }

  function plainRenderer(TD, row, col) {
    applyHighlight(TD, row, col);
  }

  // Column order: #, Naam, scores, spacer1, obs + spacer2, Totaal, Cijfer, spacer3, RTTI
  const spacer = { width: 20, header: '', render: plainRenderer };
  const columns = [
    { width: 72, header: '#', render: idRenderer },
    { width: 150, header: 'Naam', headerClass: 'sg-left', render: naamRenderer },
    ...exam.questions.map((q, qi) => ({
      width: 32,
      header: qHeaders[qi],
      headerClass: qHeaderClass(q),
      render: scoreRenderer,
    })),
    spacer,
    ...(O > 0
      ? [
          ...obsArr.map((_, oi) => ({
            width: 28,
            header: obsHeaders[oi],
            kind: 'checkbox',
            render: obsRenderer,
          })),
          spacer,
        ]
      : []),
    { width: 72, header: 'Totaal', render: calcCentered },
    { width: 52, header: 'Cijfer', render: gradeRenderer },
    spacer,
    ...['R%', 'T1%', 'T2%', 'I%'].map((header) => ({ width: 44, header, render: rttiRenderer })),
  ];

  // ── Keyboard ──────────────────────────────────────────────────────────────
  // Runs before the grid's own handling (arrows, typing, Escape, F2, Delete).
  // Returns true when the key was handled here.
  function onKeyDown(event, { row, col, editing }) {
    if (row >= summaryIdx) return false;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };

    // ── Numpad dot → write N directly into the question cell (also while
    // typing, which discards the typed value) ──────────────────────────
    if (event.code === 'NumpadDecimal' && numpadDotIsN && isQCol(col)) {
      if (editing) grid.cancelEditing();
      onGridChange([{ row, col, oldValue: gridData[row][col], newValue: 'N' }]);
      return handled();
    }

    // ── Enter / Numpad Enter / multiply → confirm edit + next editable cell
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'NumpadMultiply') {
      if (editing) grid.finishEditing();
      if (col === gradeCol) {
        // Cijfer: confirm and go to the next student's grade
        if (row < lastDataRow) goTo(row + 1, col);
        return handled();
      }
      const pos = editableCols.indexOf(col);
      const isLastEditable = pos === editableCols.length - 1;
      if (!isLastEditable) {
        // Not the last editable cell: just advance right
        goTo(row, editableCols[pos + 1]);
      } else if (row < lastDataRow) {
        // Last editable cell, next student exists: first empty Q or same col
        goTo(row + 1, firstEmptyQ(row + 1) ?? col);
      }
      // Last editable cell of last student: stay
      return handled();
    }

    // ── Tab → next question, then the observaties, then the next student's
    // first question; stops after the last student. Shift+Tab: previous one.
    if (event.key === 'Tab' && (isQCol(col) || isObsCol(col))) {
      if (editing) grid.finishEditing();
      const pos = editableCols.indexOf(col);
      if (event.shiftKey) {
        if (pos > 0) goTo(row, editableCols[pos - 1]);
      } else if (pos < editableCols.length - 1) {
        goTo(row, editableCols[pos + 1]);
      } else if (row < lastDataRow) {
        goTo(row + 1, firstQCol);
      }
      return handled();
    }

    // ── F1, F2, … → toggle observation 1, 2, … of this student, without
    // moving the selection or closing an open editor (as the reference) ────────────────────────────────────────────────
    const fKey = /^F(\d{1,2})$/.exec(event.key);
    if (fKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      const obsIdx = Number(fKey[1]) - 1;
      if (obsIdx >= O) return false;
      setObs(row, obsIdx, gridData[row][obsStart + obsIdx] !== true);
      return handled();
    }

    // The keys below only apply when not typing in a cell.
    if (editing) return false;

    // ── Numpad divide → previous editable cell ────────────────────────────
    if (event.code === 'NumpadDivide') {
      const pos = editableCols.indexOf(col);
      if (pos > 0) goTo(row, editableCols[pos - 1]);
      return handled();
    }

    // ── Numpad minus / plus → previous / next student (first empty Q, or
    // same col) ────────────────────────────────────────────────────────────
    if (event.code === 'NumpadSubtract' || event.code === 'NumpadAdd') {
      const targetRow = event.code === 'NumpadAdd' ? row + 1 : row - 1;
      if (targetRow >= firstDataRow && targetRow <= lastDataRow) {
        goTo(targetRow, firstEmptyQ(targetRow) ?? col);
      }
      return handled();
    }

    // ── Home ──────────────────────────────────────────────────────────────
    if (event.key === 'Home') {
      if (isQCol(col)) {
        goTo(row, firstQCol);
      } else if (isObsCol(col)) {
        goTo(row, col === firstObsCol ? firstQCol : firstObsCol);
      }
      return handled();
    }

    // ── End ───────────────────────────────────────────────────────────────
    if (event.key === 'End') {
      if (isQCol(col)) {
        goTo(row, col === lastQCol && O > 0 ? lastObsCol : lastQCol);
      } else if (isObsCol(col)) {
        goTo(row, lastObsCol);
      }
      return handled();
    }

    // ── Obs cells: 0 unchecks, 1 checks (other printable keys do nothing) ─
    if (isObsCol(col) && (event.key === '0' || event.key === '1')) {
      setObs(row, col - firstObsCol, event.key === '1');
      return handled();
    }

    return false;
  }

  const grid = createScoreGrid(container, {
    data: gridData,
    columns,
    isEditable(row, col) {
      if (row === summaryIdx || row === stdIdx) return false;
      // Score cols, observaties, and Cijfer (typing there overwrites the grade)
      return isQCol(col) || isObsCol(col) || col === gradeCol;
    },
    renderCell(td, row, col, value) {
      columns[col].render(td, row, col, value);
    },
    onChange: onGridChange,
    onSelect(row, col) {
      if (row < summaryIdx && students[row]) {
        if (isQCol(col)) Presence.setPosition(students[row].id, exam.questions[col - 2].id);
        else if (isObsCol(col)) {
          Presence.setPosition(students[row].id, `obs:${obsArr[col - firstObsCol].id}`);
        }
      }
      // Redraw the cross-hair (G58): the old and the new row and column.
      const prev = selectedCell;
      selectedCell = { row, col };
      grid.render({ rows: [prev.row, row], cols: [prev.col, col] });
    },
    onRender() {
      if (remoteCursors.length) drawCursors();
    },
    onKeyDown,
  });

  return grid;
}
