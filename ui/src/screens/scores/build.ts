// SPDX-License-Identifier: AGPL-3.0-or-later

// Building the score modal's group grids, and building them ahead while an exam's menu is open
// (Step 7c).

import { escHtml } from '../../app.js';
import {
  recomputeRow,
  recomputeSummaryRow,
  scoreCellText,
  type GridCell,
  type GridData,
} from '../../domain/scoregrid';
import type { Exam, ScoreRecord, Student } from '../../domain/types';
import { Store } from '../../store.js';
import { nextIdle } from '../../utils/idle';
import { perfSpan, timed } from '../../utils/perf';
import { createGroupGrid } from './group-grid';
import { examGroups, examObservaties, groupStudentsOf, rosterSignature } from './roster';
import { destroyGridInstances, scoreSavesDone, session } from './session';

/**
 * Builds one grid per group. The first group is built at once; each further group waits for
 * idle time, so the modal paints its first rows within budget (Step 7c). `onFirst` runs when
 * the first grid is in the DOM; the further groups also wait for `held` (the prebuild holds
 * them until the modal opens). The promise resolves when every grid is in the DOM (or the
 * build was replaced).
 */
export async function loadScoreGrid(
  jaarlaag: string,
  examId: string,
  container: HTMLElement,
  year: string,
  onFirst?: () => void,
  held?: Promise<unknown>,
): Promise<void> {
  destroyGridInstances();
  const token = session.buildToken;
  // Saves queued from a previous modal must land before the files are read (review 3b m7).
  await scoreSavesDone();
  if (token !== session.buildToken) return;

  const exam = (Store.getExamsSync(year) as Exam[]).find((e) => e.id === examId);
  if (!exam) return;
  session.activeExam = { ...exam };
  session.activeRoster = rosterSignature(exam, year);

  const groups = examGroups(exam, year, jaarlaag);
  const allStudents = Store.getStudentsSync(year) as Student[];
  if (groups.length === 0) {
    container.innerHTML = '<p class="hint">Geen groepen gevonden. Voeg eerst groepen toe.</p>';
    return;
  }
  container.innerHTML = '';

  let built = 0;
  for (const group of groups) {
    const groupStudents = groupStudentsOf(group, allStudents);
    if (groupStudents.length === 0) continue;
    if (built > 0) {
      if (built === 1) await held;
      await nextIdle();
      if (token !== session.buildToken) return;
    }

    const section = document.createElement('div');
    section.className = 'score-group-section';
    // The heading sticks to the top of the scroll area while its grid scrolls by (board 13).
    section.innerHTML = `<div class="sc-group-head"><h3 class="group-heading">${escHtml(group.name)}</h3><span class="sc-group-info"></span></div><div class="score-grid-host"></div>`;
    container.appendChild(section);

    session.activeObs = examObservaties(exam);
    const obs = session.activeObs;
    const O = obs.length;
    const N = exam.questions.length;

    // Read right before building: a colleague's change that arrived while this group waited is
    // in the Store cache by now.
    const scoreRecs = (await timed('scores:read', () =>
      Promise.all(groupStudents.map((s) => Store.getStudentScores(s.id, year))),
    )) as ScoreRecord[];
    if (token !== session.buildToken) return;
    const endCompute = perfSpan('scores:compute');

    // Row: [id, naam, ...N scores, spacer1, ...O obs, spacer2?, Totaal, Cijfer, spacer3, R%…I%]
    const gridData: GridData = [];
    groupStudents.forEach((s, si) => {
      const rec = scoreRecs[si];
      const examScores = rec?.scores?.[examId] ?? {};
      const examObsIds = rec?.observations?.[examId] ?? [];
      const row: GridCell[] = [String(s.id), Store.fullName(s)];
      exam.questions.forEach((q) => {
        const v = examScores[q.id];
        row.push(v === undefined ? '' : v === null ? 'N' : scoreCellText(v));
      });
      row.push(''); // spacer1
      if (O > 0) {
        obs.forEach((o) => row.push(examObsIds.includes(o.id)));
        row.push(''); // spacer2
      }
      row.push('', '', '', '', '', '', ''); // Totaal, Cijfer, spacer3, R%, T1%, T2%, I%
      gridData.push(row);
    });

    // Summary rows: average (sentinel __avg__), then standard deviation (__std__).
    const trail = [
      '',
      ...(O > 0 ? [...Array<string>(O).fill(''), ''] : []),
      ...Array<string>(7).fill(''),
    ];
    gridData.push(['__avg__', 'Gemiddelde', ...Array<string>(N).fill(''), ...trail]);
    gridData.push(['__std__', 'Standaarddeviatie', ...Array<string>(N).fill(''), ...trail]);
    const avgIdx = gridData.length - 2;
    const stdIdx = gridData.length - 1;
    // Overwritten grades per student row ({ cijfer, berekend }), and what recomputeRow derived
    // from them (for the Cijfer cell's look and tooltip).
    gridData.overrides = Object.fromEntries(
      scoreRecs.map((rec, i) => [i, rec?.overrides?.[examId]]),
    );
    gridData.gradeInfo = {};
    const active = session.activeExam;
    for (let ri = 0; ri < avgIdx; ri++) recomputeRow(gridData, active, ri, O);
    recomputeSummaryRow(gridData, avgIdx, stdIdx, active, O);
    session.activeGridData.push(gridData);
    endCompute();

    const grid = timed('scores:dom', () =>
      createGroupGrid(
        section.querySelector<HTMLElement>('.score-grid-host')!,
        active,
        groupStudents,
        gridData,
        year,
        obs,
      ),
    );
    session.gridInstances.push(grid);

    // Center the grid (and its heading) when it is narrower than the modal.
    const tableWidth = grid.table.offsetWidth;
    if (tableWidth > 0) {
      section.style.maxWidth = `${tableWidth + 2}px`;
      section.style.marginInline = 'auto';
    }
    if (built++ === 0) onFirst?.();
  }
}

// ── Prebuild (Step 7c) ───────────────────────────────────────────────────────
// While an exam's menu is open, its grids are built off-screen, so "Scores invoeren" only has
// to move them into the modal. Only the first group is built ahead (the others wait for the
// modal, then idle time), so the modal's first frame lays out one grid, as without a prebuild.
// Colleagues hear nothing (presence) until the modal really opens. A prebuild is used only
// when no cached data changed since it started (Store.generation); otherwise, or when it is
// not used within PREBUILD_TTL_MS, it is thrown away.

const PREBUILD_TTL_MS = 15_000;

export interface Prebuilt {
  examId: string;
  year: string;
  login: string;
  host: HTMLElement;
  grids: HTMLElement;
  generation: number;
  token: number;
  first: Promise<unknown>;
  done: Promise<void>;
  release: () => void;
  timer: ReturnType<typeof setTimeout>;
}

let prebuilt: Prebuilt | null = null;
/** True while the score modal is open: its grids are the live ones. */
export const modalState = { open: false };

// Who the grids were built for: a logout and login within the TTL must not reuse them
// (review 7c n1).
const loginKey = () => `${Store.getActiveUser()?.id}|${Store.getActiveSubject()}`;

function discardPrebuilt(): void {
  if (!prebuilt) return;
  clearTimeout(prebuilt.timer);
  prebuilt.host.remove();
  if (prebuilt.token === session.buildToken) destroyGridInstances();
  prebuilt.release(); // the held build sees the new token and stops
  prebuilt = null;
}

export function prebuildScoreModal(examId: string, year: string): void {
  if (modalState.open) return;
  discardPrebuilt();
  const exam = (Store.getExamsSync(year) as Exam[]).find((e) => e.id === examId);
  if (!exam) return;
  const host = document.createElement('div');
  host.className = 'sc-prebuild';
  host.setAttribute('aria-hidden', 'true');
  const grids = document.createElement('div');
  host.appendChild(grids);
  document.body.appendChild(host);
  const generation = Store.generation() as number;
  let firstBuilt!: () => void;
  const first = new Promise<void>((resolve) => (firstBuilt = resolve));
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const done = loadScoreGrid(String(exam.jaarlaag), examId, grids, year, firstBuilt, held).finally(
    firstBuilt,
  );
  void done.catch(() => {}); // reported when the modal awaits it; unused, it is dropped
  prebuilt = {
    examId,
    year,
    login: loginKey(),
    host,
    grids,
    generation,
    token: session.buildToken, // loadScoreGrid took its token synchronously
    first,
    done,
    release,
    timer: setTimeout(discardPrebuilt, PREBUILD_TTL_MS),
  };
}

/** The prebuild for this exam if it is still current, else null (and it is gone). */
export function takePrebuilt(examId: string, year: string): Prebuilt | null {
  const pre = prebuilt;
  const current =
    pre &&
    pre.examId === examId &&
    pre.year === year &&
    pre.login === loginKey() &&
    pre.token === session.buildToken &&
    pre.generation === Store.generation();
  if (!pre || !current) {
    discardPrebuilt();
    return null;
  }
  clearTimeout(pre.timer);
  prebuilt = null;
  pre.release();
  return pre;
}
