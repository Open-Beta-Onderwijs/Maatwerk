// SPDX-License-Identifier: AGPL-3.0-or-later

// Projectgroepen (step 22, design spec 4.13, board 17; PLAN-2 decisions 18, 19, 22): step 2 of a
// new PO, the PO's own "Projectgroepen" dialog, and a PO herkansing (same rubric, the original's
// groups copied and editable). Left the students of the matching classes nobody has placed yet
// (class filter; click adds to the active group, or drag), right the groups. Empty groups are
// dropped on save; a student who changes group takes the new group's scores (decision 19).

import { closeModal, guardModalClose, openModal, toast } from '../app.js';
import { confirmDialog, esc, openDialog } from '../components/dialog';
import {
  classesByStudent,
  compareStudents,
  copyGroups,
  groupName,
  groupsToSave,
  leftStudents,
  matchingClasses,
  memberCount,
  movedStudents,
  newGroupId,
  placeStudent,
  randomGroups,
  unplaced,
  type PoClass,
  type Projectgroep,
} from '../domain/po';
import { attemptCode } from '../domain/exam-info';
import { clearGrading, gradingOf, groupSource, writeGrading } from '../domain/po-grading';
import { testBadgeClass } from '../domain/test-type';
import type { Exam, ScoreRecord, Student } from '../domain/types';
import { renderToetsen } from '../screens/toetsen';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import { spinnerValue, wireSpinners } from '../utils/spinners';
import { stepper } from './exam-fields';
import { openNewPoModal, poSteps, type PoDraft } from './po-gegevens';

export interface GroupsOptions {
  /** `new`: step 2 of a new PO; `edit`: an existing PO's groups; `resit`: a new herkansing. */
  mode: 'new' | 'edit' | 'resit';
  year: string;
  /** The original of a herkansing. */
  parent?: Exam;
}

interface State {
  groups: Projectgroep[];
  /** The group a click on a student adds to. */
  active: string | null;
  /** A class id, or null for every class. */
  filter: string | null;
}

const RANDOM_SIZE_DEFAULT = 3;

/** The drag data type of a student in this dialog. */
const DRAG_TYPE = 'application/x-maatwerk-student';

function fullName(s: Student | undefined, id: string): string {
  return s ? (Store.fullName(s) as string) : `Leerling ${id}`;
}

/** Opens the groups of `po` (see the module docs). */
export function showProjectgroepen(po: PoDraft, opts: GroupsOptions): void {
  const { year, mode } = opts;
  const scope = { subject: po.subject, schoolsoort: po.schoolsoort, jaarlaag: po.jaarlaag };
  const classes = matchingClasses(Store.getGroupsSync(year) as PoClass[], scope);
  const byStudent = classesByStudent(classes);
  const students = new Map<string, Student>(
    (Store.getStudentsSync(year) as Student[]).map((s) => [String(s.id), s]),
  );
  const name = (id: string) => fullName(students.get(id), id);
  const tag = (id: string) => byStudent.get(id)?.[0] ?? '—';
  const tagTitle = (id: string) => byStudent.get(id)?.join(', ') ?? 'In geen passende klas';
  // Everyone a class offers, by name.
  // By achternaam, in the list and in every group (user 2026-11-10).
  const order = (a: string, b: string) => compareStudents(students.get(a), students.get(b));
  const eligible = [...byStudent.keys()].sort(order);

  const before = structuredClone(po.projectgroepen ?? []);
  const state: State = {
    groups: structuredClone(before),
    active: null,
    filter: null,
  };
  // Shown by achternaam: sorted before the close guard's snapshot, so a file in another order
  // is not a change (step 23).
  for (const g of state.groups) g.student_ids = g.student_ids.map(String).sort(order);
  if (!state.groups.length) state.groups.push({ id: newGroupId(), student_ids: [] });
  state.active = state.groups[0]!.id;

  const vak =
    (Store.SUBJECT_DISPLAY as Record<string, string>)[po.subject ?? ''] ?? po.subject ?? '';
  const scopeText = [vak, (po.schoolsoort ?? []).join(', '), `jaarlaag ${po.jaarlaag}`].join(' · ');
  const title =
    mode === 'edit'
      ? 'Projectgroepen'
      : mode === 'resit'
        ? 'Herkansing toevoegen'
        : 'Nieuwe praktische opdracht';
  const badge = opts.parent
    ? `<span class="${testBadgeClass(opts.parent)}">${esc(attemptCode(opts.parent))}</span> `
    : '';

  openModal({
    title,
    ...(mode === 'new' ? poSteps('groepen') : {}),
    ...(mode === 'edit' ? { subtitle: po.title } : {}),
    ...(mode === 'resit' ? { subtitleHtml: `van ${badge}${esc(opts.parent?.title ?? '')}` } : {}),
    key: 'exam-edit',
    size: 'xl',
    className: 'dlg--po-groups',
    fixedHeight: true,
    bodyClass: 'po-groups-body',
    footerHtml: `
      ${mode === 'new' ? '<button class="btn btn--text" data-align="start" id="po-back">← Gegevens</button>' : ''}
      <span class="po-free-note" id="po-free-note" aria-live="polite"></span>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
      <button class="btn btn--primary" id="po-groups-save">Opslaan</button>
    `,
    body: `
      <aside class="po-free" aria-labelledby="po-free-title">
        <div class="po-free-head">
          <div class="po-free-title"><b id="po-free-title">Niet ingedeeld</b> <span class="muted" id="po-free-count"></span></div>
          <span class="po-free-hint">Uit de klassen van ${esc(scopeText)}. Klik op een leerling om die aan <b id="po-active-name"></b> toe te voegen, of sleep.</span>
          <div class="po-class-filter" role="group" aria-label="Klas">
            ${[{ id: '', name: 'Alle' }, ...classes]
              .map(
                (c) =>
                  `<button type="button" class="filter-btn po-class-chip${c.id ? '' : ' filter-btn-active'}" data-class="${esc(c.id)}" aria-pressed="${!c.id}">${esc(c.name)}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="po-free-list" id="po-free-list" data-drop="free"></div>
      </aside>
      <section class="po-groups-main" aria-label="Projectgroepen">
        <div class="po-groups-bar">
          <span class="muted" id="po-group-count"></span>
          <button type="button" class="btn btn--secondary btn--sm" id="po-random">Willekeurig indelen…</button>
          <button type="button" class="btn btn--primary btn--sm" id="po-add-group">+ Projectgroep</button>
        </div>
        <div class="po-group-grid" id="po-group-grid"></div>
      </section>`,
    onShow: (el: HTMLElement) => {
      const $ = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
      const freeList = $('#po-free-list');
      const grid = $('#po-group-grid');
      const initial = JSON.stringify(groupsToSave(state.groups));
      guardModalClose(
        () => mode !== 'edit' || JSON.stringify(groupsToSave(state.groups)) !== initial,
      );

      const visibleFree = (): string[] => {
        const cls = classes.find((c) => c.id === state.filter);
        const pool = cls
          ? eligible.filter((s) => cls.student_ids.map(String).includes(s))
          : eligible;
        return unplaced(pool, state.groups);
      };

      const studentButton = (id: string) =>
        `<button type="button" class="po-stu" draggable="true" data-student="${esc(id)}" aria-label="${esc(name(id))} (${esc(tag(id))}) toevoegen aan de actieve projectgroep">
          <span class="po-stu-name">${esc(name(id))}</span>
          <span class="po-tag" title="${esc(tagTitle(id))}">${esc(tag(id))}</span>
          <span class="po-stu-add" aria-hidden="true">+</span>
        </button>`;

      const groupCard = (g: Projectgroep, i: number) => `
        <div class="po-group${g.id === state.active ? ' po-group--active' : ''}" data-group="${esc(g.id)}" data-drop="group">
          <div class="po-group-head">
            <input class="po-group-name" type="text" value="${esc(g.naam ?? '')}" placeholder="${esc(groupName({ ...g, naam: '' }, i))}" aria-label="Naam projectgroep ${i + 1}" />
            <span class="po-group-count">${memberCount(g.student_ids.length)}</span>${g.student_ids.length ? '' : `<button type="button" class="btn btn--icon po-group-delete" data-delete-group="${esc(g.id)}" title="Lege projectgroep verwijderen" aria-label="${esc(groupName(g, i))} verwijderen">${ICONS.trash}</button>`}
          </div>
          ${g.student_ids
            .map(
              (s) => `
            <div class="po-member" draggable="true" data-student="${esc(s)}">
              <span class="po-member-name">${esc(name(String(s)))}</span>
              <span class="po-tag" title="${esc(tagTitle(String(s)))}">${esc(tag(String(s)))}</span>
              <button type="button" class="po-member-remove" data-remove="${esc(s)}" aria-label="${esc(name(String(s)))} uit de projectgroep halen">×</button>
            </div>`,
            )
            .join('')}
          ${g.student_ids.length ? '' : '<span class="po-group-empty">Klik links leerlingen aan of sleep ze hierheen</span>'}
        </div>`;

      const renderFree = () => {
        const free = visibleFree();
        freeList.innerHTML = free.length
          ? free.map(studentButton).join('')
          : `<p class="po-free-empty muted">${eligible.length ? 'Iedereen uit deze selectie is ingedeeld.' : 'Geen leerlingen: er is geen klas met dit vak, deze schoolsoort en deze jaarlaag.'}</p>`;
        const all = unplaced(eligible, state.groups).length;
        $('#po-free-count').textContent = `${all} ${all === 1 ? 'leerling' : 'leerlingen'}`;
        const note = $('#po-free-note');
        note.textContent = all
          ? `${all} ${all === 1 ? 'leerling nog niet ingedeeld: die krijgt' : 'leerlingen nog niet ingedeeld: zij krijgen'} pas een cijfer in een projectgroep.`
          : 'Iedereen is ingedeeld.';
        // Placed students outside the matching classes, e.g. after a jaarlaag change (review 22 m2).
        const outside = state.groups
          .flatMap((g) => g.student_ids.map(String))
          .filter((s) => !byStudent.has(s)).length;
        if (outside)
          note.textContent += ` ${outside} ingedeelde ${outside === 1 ? 'leerling zit' : 'leerlingen zitten'} in geen passende klas (—).`;
        note.classList.toggle('po-free-note--open', all > 0 || outside > 0);
      };

      const renderActive = () => {
        const i = state.groups.findIndex((g) => g.id === state.active);
        const g = state.groups[i];
        $('#po-active-name').textContent = g ? groupName(g, i) : 'een nieuwe projectgroep';
        grid
          .querySelectorAll<HTMLElement>('.po-group')
          .forEach((c) => c.classList.toggle('po-group--active', c.dataset.group === state.active));
      };

      const renderGroups = () => {
        grid.innerHTML = state.groups.map(groupCard).join('');
        const n = state.groups.length;
        $('#po-group-count').textContent =
          `${n} ${n === 1 ? 'projectgroep' : 'projectgroepen'} · leerlingen uit verschillende klassen mogen samen`;
      };

      const render = () => {
        for (const g of state.groups) g.student_ids = g.student_ids.map(String).sort(order);
        renderGroups();
        renderFree();
        renderActive();
      };

      const addGroup = (members: string[] = []): string => {
        const g = { id: newGroupId(), student_ids: members };
        state.groups.push(g);
        return g.id;
      };

      const place = (student: string, to: string | null) => {
        if (to === null && !state.groups.some((g) => g.student_ids.map(String).includes(student)))
          return;
        state.groups = placeStudent(state.groups, student, to);
        render();
      };

      // Clicks: add a student, activate a group, remove a member, filter.
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const stu = t.closest<HTMLElement>('.po-stu');
        if (stu) {
          state.active ??= addGroup();
          if (!state.groups.some((g) => g.id === state.active)) state.active = addGroup();
          const at = [...freeList.querySelectorAll('.po-stu')].indexOf(stu);
          place(stu.dataset.student ?? '', state.active);
          // Keyboard: on to the next student (review 22 m4).
          const left = freeList.querySelectorAll<HTMLElement>('.po-stu');
          (left[Math.min(at, left.length - 1)] ?? freeList).focus?.();
          return;
        }
        const del = t.closest<HTMLElement>('[data-delete-group]');
        if (del) {
          // Only an empty group has the button (user 2026-11-10).
          const at = state.groups.findIndex((g) => g.id === del.dataset.deleteGroup);
          if (at >= 0 && !state.groups[at]!.student_ids.length) state.groups.splice(at, 1);
          if (!state.groups.some((g) => g.id === state.active))
            state.active = state.groups[Math.min(at, state.groups.length - 1)]?.id ?? null;
          render();
          $('#po-add-group').focus();
          return;
        }
        const remove = t.closest<HTMLElement>('[data-remove]');
        if (remove) {
          const group = remove.closest<HTMLElement>('.po-group')?.dataset.group ?? '';
          place(remove.dataset.remove ?? '', null);
          grid
            .querySelector<HTMLInputElement>(
              `.po-group[data-group="${CSS.escape(group)}"] .po-group-name`,
            )
            ?.focus();
          return;
        }
        const chip = t.closest<HTMLElement>('.po-class-chip');
        if (chip) {
          state.filter = chip.dataset.class || null;
          el.querySelectorAll<HTMLElement>('.po-class-chip').forEach((c) => {
            const on = c === chip;
            c.classList.toggle('filter-btn-active', on);
            c.setAttribute('aria-pressed', String(on));
          });
          renderFree();
          return;
        }
        const card = t.closest<HTMLElement>('.po-group');
        if (card) {
          state.active = card.dataset.group ?? null;
          renderActive();
        }
      });
      // Typing a name or tabbing into a card makes it the active group, without a re-render.
      grid.addEventListener('focusin', (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.po-group');
        if (card && card.dataset.group !== state.active) {
          state.active = card.dataset.group ?? null;
          renderActive();
        }
      });
      grid.addEventListener('input', (e) => {
        const input = e.target as HTMLInputElement;
        const id = input.closest<HTMLElement>('.po-group')?.dataset.group;
        const g = state.groups.find((x) => x.id === id);
        if (g && input.classList.contains('po-group-name')) {
          g.naam = input.value;
          renderActive();
        }
      });

      // Drag a student (left or from a group) onto a group, or back to the left.
      el.addEventListener('dragstart', (e) => {
        const item = (e.target as HTMLElement).closest<HTMLElement>('[data-student]');
        if (!item || !e.dataTransfer) return;
        // Our own type: dropped text (a selected name, say) is never taken for a student (review 22 m1).
        e.dataTransfer.setData(DRAG_TYPE, item.dataset.student ?? '');
        e.dataTransfer.effectAllowed = 'move';
      });
      const dropTarget = (e: DragEvent) =>
        (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
      el.addEventListener('dragover', (e) => {
        const target = dropTarget(e);
        if (!target) return;
        e.preventDefault();
        el.querySelectorAll('.po-drop-over').forEach((x) => x.classList.remove('po-drop-over'));
        target.classList.add('po-drop-over');
      });
      el.addEventListener('dragleave', (e) => {
        const target = dropTarget(e);
        if (target && !target.contains(e.relatedTarget as Node))
          target.classList.remove('po-drop-over');
      });
      el.addEventListener('drop', (e) => {
        const target = dropTarget(e);
        const student = e.dataTransfer?.getData(DRAG_TYPE);
        el.querySelectorAll('.po-drop-over').forEach((x) => x.classList.remove('po-drop-over'));
        if (!target || !student) return;
        e.preventDefault();
        if (target.dataset.drop === 'group') {
          state.active = target.dataset.group ?? null;
          place(student, state.active);
        } else place(student, null);
      });

      $('#po-add-group').addEventListener('click', () => {
        state.active = addGroup();
        render();
        grid.querySelector<HTMLInputElement>(`.po-group:last-child .po-group-name`)?.focus();
      });

      $('#po-random').addEventListener('click', () => {
        const pool = visibleFree();
        if (!pool.length) {
          toast('Er zijn geen niet-ingedeelde leerlingen om te verdelen.', 'info');
          return;
        }
        openRandomDialog(pool.length, (size) => {
          // Empty groups without a name make way for the new ones (review 22 n2).
          state.groups = state.groups.filter((g) => g.student_ids.length || g.naam?.trim());
          for (const members of randomGroups(pool, size)) addGroup(members);
          state.active = state.groups[state.groups.length - 1]?.id ?? null;
          render();
        });
      });

      el.querySelector('#po-back')?.addEventListener('click', () => {
        openNewPoModal(year, { ...po, projectgroepen: state.groups });
      });

      $('#po-groups-save').addEventListener('click', async () => {
        const groups = groupsToSave(state.groups);
        if (mode === 'edit') {
          const moved = movedStudents(before, groups);
          if (moved.length && (await poHasScores(po, year))) {
            const ok = await confirmDialog(
              `${moved.length === 1 ? 'Eén leerling wisselt' : `${moved.length} leerlingen wisselen`} van projectgroep. ${moved.length === 1 ? 'Die krijgt' : 'Zij krijgen'} de scores, observaties en opmerkingen van de nieuwe groep; eigen bonus/malus blijft.`,
              { title: 'Andere projectgroep', okLabel: 'Opslaan' },
            );
            if (!ok) return;
          }
        }
        // A student in no group any more leaves the PO and loses its scores (user 2026-11-10).
        const leaving: string[] = [];
        if (mode === 'edit') {
          for (const s of leftStudents(before, groups))
            if (await Store.studentHasExamData(s, po.id, year)) leaving.push(s);
          if (leaving.length) {
            const one = leaving.length === 1;
            const ok = await confirmDialog(
              `${one ? 'Eén leerling zit' : `${leaving.length} leerlingen zitten`} in geen projectgroep meer. ${one ? 'Diens' : 'Hun'} scores, observaties en opmerkingen voor deze PO worden verwijderd.`,
              {
                title: 'Scores verwijderen',
                okLabel: 'Verwijderen en opslaan',
                danger: true,
                detailsHtml: `<ul>${leaving.map((s) => `<li>${esc(name(s))}</li>`).join('')}</ul>`,
              },
            );
            if (!ok) return;
          }
        }
        const saved: Exam = { ...po, projectgroepen: groups };
        await Store.upsertExam(saved, year);
        for (const s of leaving) await Store.removeStudentExamData(s, po.id, year);
        if (mode === 'edit') await takeNewGroupGrading(saved, year, movedStudents(before, groups));
        closeModal();
        toast(mode === 'resit' ? 'Herkansing toegevoegd.' : 'PO opgeslagen.', 'success');
        void renderToetsen();
      });

      render();
    },
  });
}

/**
 * Decision 19: a student who changed projectgroep takes the new group's grading (scores,
 * observaties, comments, group lines), read from a member who stayed; own lines stay. A new group
 * without a grading clears the student's group fields.
 */
async function takeNewGroupGrading(po: Exam, year: string, moved: string[]): Promise<void> {
  const movedSet = new Set(moved);
  const subject = po.subject ?? Store.getActiveSubject();
  for (const s of moved) {
    const g = (po.projectgroepen ?? []).find((x) => x.student_ids.map(String).includes(s));
    if (!g) continue;
    const stayed = g.student_ids.map(String).filter((m) => !movedSet.has(m));
    const records: ScoreRecord[] = [];
    for (const m of stayed) records.push(await Store.getStudentScores(m, year, subject));
    const source = groupSource(records, po.id, g.id);
    if (!source && !(await Store.studentHasExamData(s, po.id, year, subject))) continue;
    await Store.updateStudentScores(s, year, subject, (r: ScoreRecord) => {
      if (source) writeGrading(r, po.id, g.id, gradingOf(source, po.id));
      else clearGrading(r, po.id, g.id);
    });
  }
}

/** Whether a student has a score for this PO. */
async function poHasScores(po: Exam, year: string): Promise<boolean> {
  return Store.examHasScores(po.id, year) as Promise<boolean>;
}

/** "Willekeurig indelen…": the group size, then `apply(size)`. */
function openRandomDialog(count: number, apply: (size: number) => void): void {
  openDialog({
    title: 'Willekeurig indelen',
    size: 'sm',
    className: 'dlg--po-random',
    body: `
      <p>Verdeel de ${count} ${count === 1 ? 'leerling' : 'leerlingen'} links willekeurig over nieuwe projectgroepen van hoogstens:</p>
      <div class="form-group exam-stepper">
        <label for="po-random-size">Groepsgrootte</label>
        ${stepper('po-random-size', { value: Math.min(RANDOM_SIZE_DEFAULT, Math.max(1, count)), step: 1, min: 1, max: Math.max(1, count), label: 'Groepsgrootte' })}
      </div>
      <p class="muted">De groepen worden zo gelijk mogelijk. Bestaande groepen blijven zoals ze zijn.</p>`,
    footer: [
      { label: 'Annuleren', variant: 'secondary', onClick: 'close' },
      {
        label: 'Indelen',
        variant: 'primary',
        id: 'po-random-ok',
        onClick: (d) => {
          const size = Math.round(spinnerValue(d.el.querySelector<HTMLElement>('#po-random-size')));
          d.close();
          apply(size);
        },
      },
    ],
    onShow: (root) => wireSpinners(root),
  });
}

/** The PO's "Projectgroepen" (⋮ menu; from step 23 also the score table's header). */
export async function openProjectgroepenModal(examId: string, year: string): Promise<void> {
  await Store.loadYear(year);
  const exam = (await Store.getExams(year)).find((e: Exam) => e.id === examId);
  if (!exam) return;
  showProjectgroepen(structuredClone(exam) as PoDraft, { mode: 'edit', year });
}

/**
 * A PO herkansing (decision 22): no inhaal, the same rubric, the original's groups copied (new
 * ids) and editable before it is saved; observaties as for a test's attempt (F-12).
 */
export async function openPoResitModal(parentId: string, year: string): Promise<void> {
  await Store.loadYear(year);
  const all: Exam[] = await Store.getExams(year);
  const parent = all.find((e) => e.id === parentId);
  if (!parent) return;
  const resits: Exam[] = Store.getResitsSync(parentId, year);
  const base = structuredClone(parent);
  delete base._meta; // a new file
  const resit: PoDraft = {
    ...base,
    kind: 'po',
    id: Store.makeExamId(),
    title: `${parent.title} — HERKANSING`,
    description: 'HERKANSING',
    attempt: resits.length + 2, // attempt 1 is the original
    parent_id: parent.id,
    obs_ids: [...(parent.obs_ids ?? [])],
    obs_from_parent: true,
    projectgroepen: copyGroups(parent.projectgroepen),
    questions: [],
  };
  showProjectgroepen(resit, { mode: 'resit', year, parent });
}
