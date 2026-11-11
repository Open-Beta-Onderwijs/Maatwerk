// SPDX-License-Identifier: AGPL-3.0-or-later

// Projectgroep beoordelen (step 23b; design spec 4.13, board 18; PLAN-2 decisions 17, 19, 24;
// grade rules decision 28). Per category the level cards (every level whose interval holds the
// score is highlighted), a slider, the category observaties and a comment; then the overall
// comment and the bonus/malus lines of the group and of each member; the footer has the general
// observaties, the live grades, Vorige/Volgende and Klaar. Markup: po-grade-view.ts.
//
// Saving: every 10 s while something changed, on Vorige/Volgende/Klaar and on closing. First the
// PO and every member file are read from disk: a deleted PO, a changed member list of this group
// or a member file that is neither as this dialog read it nor already as wanted is a conflict,
// and nothing is written. Then each member file goes through the Store's CAS update, which checks
// that member again; a colleague who writes in between can still leave the group partly written,
// so the reload then starts from that colleague's version (review 23 m1). A member's own lines
// are rewritten only when they were edited here (review 23 M2).

import {
  closeModal,
  modalRefresher,
  onModalCleanup,
  onModalSync,
  openModal,
  persistentError,
  showReloadNotice,
} from '../app.js';
import { esc } from '../components/dialog';
import { formatGrade } from '../domain/format';
import { gradeCellColor } from '../domain/grade-colors';
import { calcResults, poLinesSum, poWithLines } from '../domain/grades';
import { groupName } from '../domain/po';
import {
  gradedGroupOf,
  gradingKey,
  gradingOf,
  groupSource,
  ownLinesOf,
  writeGrading,
  type GroupGrading,
} from '../domain/po-grading';
import type { Exam, PoLine, ScoreRecord } from '../domain/types';
import { Store } from '../store.js';
import {
  categoryHtml,
  chipHtml,
  draftOf,
  lineInvalid,
  linesHtml,
  validLines,
  type LineDraft,
  type Obs,
} from './po-grade-view';
import { loadPoContext, sortedIds, type PoContext } from './po-scores';

/** How often a changed grading is saved (decision 24). */
export const AUTOSAVE_MS = 10_000;

/** What one member file holds for this PO, to notice a colleague's change. */
const memberKey = (rec: ScoreRecord | null | undefined, examId: string) =>
  JSON.stringify([gradingKey(gradingOf(rec, examId)), ownLinesOf(rec, examId)]);

const time = () =>
  new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Why a save wrote nothing: a colleague changed a member file, the group or the PO. */
class ConflictError extends Error {
  constructor(readonly text: string) {
    super('conflict');
  }
}

const sameMembers = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

export interface GradingOptions {
  /** After a conflict: start from this member's file when it is graded in the group (m1). */
  prefer?: string;
}

/** Opens the grading of one projectgroep (from the PO score table). */
export function openPoGrading(
  ctx: PoContext,
  groupId: string,
  onChanged?: () => void,
  opts: GradingOptions = {},
): void {
  const { exam, year, subject, rubric } = ctx;
  const groups = exam.projectgroepen ?? [];
  const index = groups.findIndex((g) => g.id === groupId);
  const group = groups[index];
  if (!group || !rubric) return;
  const members = sortedIds(ctx, group.student_ids);
  const preferred = opts.prefer ? ctx.records.get(opts.prefer) : undefined;
  const source =
    preferred && gradedGroupOf(preferred, exam.id) === groupId
      ? preferred
      : groupSource(
          members.map((m) => ctx.records.get(m)),
          exam.id,
          groupId,
        );
  const grading: GroupGrading = structuredClone(gradingOf(source, exam.id));
  const groupDrafts: LineDraft[] = grading.groupLines.map(draftOf);
  const ownDrafts = new Map(
    members.map((m) => [m, ownLinesOf(ctx.records.get(m), exam.id).map(draftOf)]),
  );
  // Members whose own lines were edited here: only theirs are rewritten (review 23 M2).
  const ownTouched = new Set<string>();
  // Each member file as read: a different one at save time is a colleague's change.
  const base = new Map(members.map((m) => [m, memberKey(ctx.records.get(m), exam.id)]));

  const obsById = new Map(
    (Store.getObservatiesSync(subject) as Obs[]).map((o) => [o.id, o] as const),
  );
  const obsList = (ids: readonly string[]) =>
    [...new Set(ids)].map((id) => obsById.get(id)).filter((o): o is Obs => !!o);
  const generalObs = obsList([
    ...(rubric.obs_ids ?? []),
    ...(exam.obs_ids ?? []),
    ...grading.observations,
  ]);
  const cats = rubric.categories;
  const maxNormal = cats.filter((c) => c.soort === 'normaal').reduce((s, c) => s + (c.max ?? 0), 0);

  const toSave = (): GroupGrading => ({ ...grading, groupLines: validLines(groupDrafts) });
  const ownToSave = (m: string): PoLine[] | undefined =>
    ownTouched.has(m) ? validLines(ownDrafts.get(m) ?? []) : undefined;
  const snapshot = () =>
    JSON.stringify([gradingKey(toSave()), members.map((m) => ownToSave(m) ?? null)]);
  let saved = snapshot();
  let saving: Promise<boolean> | null = null;
  /** Set after a conflict, a deleted PO or a reload: nothing is saved any more. */
  let stopped = false;
  let closed = false;
  // Set by onShow (it runs inside openModal); save() reports through it.
  let setStatus: (text: string, kind: 'ok' | 'busy' | 'error') => void = () => {};

  const reopenFresh = async (prefer?: string) => {
    const fresh = await loadPoContext(exam.id, year);
    if (fresh) openPoGrading(fresh, groupId, onChanged, { prefer });
    else closeModal();
  };

  /** Stops saving and tells the teacher why; OK reloads (or closes when the PO is gone). */
  const conflict = (text: string, reload: () => unknown) => {
    stopped = true;
    if (closed) {
      persistentError(`Niet opgeslagen: ${text}`);
      return;
    }
    setStatus('Niet opgeslagen: gewijzigd door een collega', 'error');
    showReloadNotice(text, reload);
  };

  const name = groupName(group, index);
  const memberLine = members.map((m) => `${esc(ctx.name(m))} (${esc(ctx.classTag(m))})`).join(', ');

  openModal({
    title: `${name} beoordelen`,
    key: 'po-grade',
    subtitleHtml: `${esc(exam.title)} · ${memberLine}`,
    className: 'dlg--po-grade',
    fixedHeight: true,
    bodyClass: 'po-gr-body',
    headerActionsHtml: '<span class="po-gr-status" id="po-gr-status" role="status"></span>',
    body: `${cats.map((c) => categoryHtml(c, grading, obsList)).join('')}
      <section class="po-gr-card">
        <label class="po-gr-label" for="po-gr-overall">Commentaar op het werk als geheel</label>
        <textarea id="po-gr-overall" class="po-gr-overall" rows="4">${esc(grading.comment)}</textarea>
      </section>
      <section class="po-gr-card po-gr-adj" id="po-gr-adj">${linesHtml(groupDrafts, members, ownDrafts, ctx.name)}</section>`,
    footerHtml: `<div class="po-gr-foot">
        <div class="po-gr-general" role="group" aria-label="Algemene observaties">
          <span class="po-gr-label">Algemene observaties</span>
          ${
            generalObs.length
              ? generalObs
                  .map((o) =>
                    chipHtml(o, grading.observations.includes(o.id), `data-gen-obs="${esc(o.id)}"`),
                  )
                  .join('')
              : '<span class="po-gr-none">Geen algemene observaties bij deze rubric</span>'
          }
        </div>
        <div class="po-gr-foot-row">
          <span class="po-gr-points" id="po-gr-points"></span>
          <span class="po-gr-grades" id="po-gr-grades"></span>
          <span class="po-gr-foot-spacer"></span>
          <button type="button" class="btn btn--secondary" id="po-gr-prev"${index > 0 ? '' : ' disabled'}>← Vorige</button>
          <button type="button" class="btn btn--secondary" id="po-gr-next"${index < groups.length - 1 ? '' : ' disabled'}>Volgende →</button>
          <button type="button" class="btn btn--primary" id="po-gr-done">Klaar</button>
        </div>
      </div>`,
    onClose: () => {
      // Closing (✕, Escape, Klaar) saves what is left, then the table refreshes.
      closed = true;
      void save().finally(() => onChanged?.());
    },
    onShow: (el: HTMLElement) => {
      const $ = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
      const status = $('#po-gr-status');
      setStatus = (text, kind) => {
        if (closed) return;
        status.textContent = text;
        status.dataset.kind = kind;
      };
      setStatus('● Alles opgeslagen', 'ok');

      const renderTotals = () => {
        const s = toSave();
        const groupSum = poLinesSum(s.groupLines);
        const scored = Object.keys(s.scores).length > 0;
        const res = calcResults(exam, s.scores, null, { groupLines: s.groupLines });
        const r = res.rubricGrade;
        $('#po-gr-points').innerHTML =
          `Punten <b>${res.scored}</b> / ${maxNormal} → projectgroep <b>${scored && r !== undefined ? formatGrade(poWithLines(r, groupSum)) : '—'}</b>`;
        $('#po-gr-grades').innerHTML = members
          .map((m) => {
            const own = ownToSave(m) ?? ownLinesOf(ctx.records.get(m), exam.id);
            const g = scored
              ? calcResults(exam, s.scores, null, { groupLines: s.groupLines, ownLines: own }).grade
              : null;
            const fill = gradeCellColor(g);
            const first = (ctx.students.get(m)?.voornaam ?? ctx.name(m)).trim();
            return `<span class="po-gr-grade"${fill ? ` data-bg="${fill}"` : ''} title="${esc(ctx.name(m))}">${esc(first)} <b>${formatGrade(g)}</b></span>`;
          })
          .join('');
      };

      const changed = () => {
        renderTotals();
        if (!stopped && snapshot() !== saved)
          setStatus('● Wijzigingen worden automatisch opgeslagen', 'busy');
      };

      const setScore = (card: HTMLElement, v: number | undefined) => {
        const id = card.dataset.cat ?? '';
        const c = cats.find((x) => x.id === id);
        if (!c) return;
        if (v === undefined) delete grading.scores[id];
        else grading.scores[id] = v;
        card.classList.toggle('po-gr-cat--empty', v === undefined);
        card.querySelector('.po-gr-v')!.textContent = v === undefined ? '—' : String(v);
        card.querySelector<HTMLElement>('.po-gr-clear')!.hidden = v === undefined;
        const range = card.querySelector<HTMLInputElement>('input[type=range]')!;
        if (v === undefined) range.value = '0';
        range.setAttribute(
          'aria-valuetext',
          v === undefined ? 'nog geen score' : `${v} van ${c.max ?? 0}`,
        );
        card.querySelectorAll<HTMLElement>('.po-gr-level').forEach((lv) => {
          const on = v !== undefined && Number(lv.dataset.min) <= v && v <= Number(lv.dataset.max);
          lv.classList.toggle('po-gr-level--on', on);
          if (on) lv.setAttribute('aria-current', 'true');
          else lv.removeAttribute('aria-current');
        });
        changed();
      };

      // An unscored slider sits at 0, so a click or key there fires no input: score it as it
      // stands (0 included; review 23 m2).
      const scoreEmpty = (t: EventTarget | null) => {
        const range = t as HTMLInputElement;
        const card = range?.closest?.<HTMLElement>('.po-gr-cat--empty');
        if (card && range.type === 'range') setScore(card, Number(range.value));
      };
      el.addEventListener('click', (e) => scoreEmpty(e.target));
      el.addEventListener('keydown', (e) => {
        if (['ArrowLeft', 'ArrowDown', 'Home', 'PageDown', '0'].includes(e.key))
          scoreEmpty(e.target);
      });

      el.addEventListener('input', (e) => {
        const t = e.target as HTMLInputElement | HTMLTextAreaElement;
        const card = t.closest<HTMLElement>('.po-gr-cat');
        if (t instanceof HTMLInputElement && t.type === 'range' && card) {
          setScore(card, Number(t.value));
          return;
        }
        if (t.dataset.catComment) {
          grading.categoryComments[t.dataset.catComment] = t.value;
          changed();
          return;
        }
        if (t.id === 'po-gr-overall') {
          grading.comment = t.value;
          changed();
          return;
        }
        const line = t.closest<HTMLElement>('.po-gr-line');
        if (!line) return;
        const own = line.dataset.line === 'own';
        if (own) ownTouched.add(line.dataset.member ?? '');
        const list = own ? (ownDrafts.get(line.dataset.member ?? '') ?? []) : groupDrafts;
        const d = list[Number(line.dataset.i)];
        if (!d) return;
        if (t.classList.contains('po-gr-line-label')) d.label = t.value;
        else {
          d.text = t.value;
          if (lineInvalid(d)) t.setAttribute('aria-invalid', 'true');
          else t.removeAttribute('aria-invalid');
        }
        changed();
      });

      const toggle = (list: string[], id: string): string[] =>
        list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      const press = (btn: HTMLElement, on: boolean) => {
        btn.classList.toggle('po-gr-chip--on', on);
        btn.setAttribute('aria-pressed', String(on));
      };
      const rerenderLines = (focus: string) => {
        $('#po-gr-adj').innerHTML = linesHtml(groupDrafts, members, ownDrafts, ctx.name);
        el.querySelector<HTMLElement>(focus)?.focus();
        changed();
      };

      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const catObs = t.closest<HTMLElement>('[data-cat-obs]');
        if (catObs) {
          const cat = catObs.closest<HTMLElement>('.po-gr-cat')?.dataset.cat ?? '';
          const id = catObs.dataset.catObs ?? '';
          grading.categoryObs[cat] = toggle(grading.categoryObs[cat] ?? [], id);
          press(catObs, grading.categoryObs[cat].includes(id));
          changed();
          return;
        }
        const gen = t.closest<HTMLElement>('[data-gen-obs]');
        if (gen) {
          grading.observations = toggle(grading.observations, gen.dataset.genObs ?? '');
          press(gen, grading.observations.includes(gen.dataset.genObs ?? ''));
          changed();
          return;
        }
        const clear = t.closest<HTMLElement>('.po-gr-clear');
        if (clear) {
          const card = clear.closest<HTMLElement>('.po-gr-cat')!;
          setScore(card, undefined);
          card.querySelector<HTMLElement>('input[type=range]')?.focus();
          return;
        }
        const add = t.closest<HTMLElement>('[data-add-line]');
        if (add) {
          const member = add.dataset.member ?? '';
          const isGroup = add.dataset.addLine === 'group';
          if (!isGroup) ownTouched.add(member);
          const list = isGroup ? groupDrafts : ownDrafts.get(member);
          list?.push({ label: '', text: '' });
          const at = (list?.length ?? 1) - 1;
          rerenderLines(
            isGroup
              ? `[data-line="group"][data-i="${at}"] .po-gr-line-label`
              : `[data-line="own"][data-member="${CSS.escape(member)}"][data-i="${at}"] .po-gr-line-label`,
          );
          return;
        }
        const remove = t.closest<HTMLElement>('.po-gr-line-remove');
        if (remove) {
          const line = remove.closest<HTMLElement>('.po-gr-line')!;
          const member = line.dataset.member ?? '';
          const isGroup = line.dataset.line === 'group';
          if (!isGroup) ownTouched.add(member);
          (isGroup ? groupDrafts : ownDrafts.get(member))?.splice(Number(line.dataset.i), 1);
          rerenderLines(
            isGroup
              ? '[data-add-line="group"]'
              : `[data-add-line="own"][data-member="${CSS.escape(member)}"]`,
          );
        }
      });

      // Vorige/Volgende: save, then the next group from fresh files (review 23 m5).
      const go = async (to: number) => {
        if (!(await save())) return;
        const next = groups[to];
        if (!next) return;
        const fresh = await loadPoContext(exam.id, year);
        if (fresh) openPoGrading(fresh, next.id, onChanged);
      };
      $('#po-gr-prev').addEventListener('click', () => void go(index - 1));
      $('#po-gr-next').addEventListener('click', () => void go(index + 1));
      $('#po-gr-done').addEventListener('click', () => {
        el.querySelector<HTMLElement>('.dlg-close')?.click();
      });

      const timer = setInterval(() => {
        if (!stopped && snapshot() !== saved) void save();
      }, AUTOSAVE_MS);
      onModalCleanup(() => clearInterval(timer));

      // A colleague's change to a member file: reload if nothing is pending here; otherwise the
      // next save reports the conflict.
      const reload = modalRefresher(() => reopenFresh());
      onModalSync('scores', (ev: { year: string; subject: string; id: string }) => {
        if (ev.year !== year || ev.subject !== subject || !members.includes(ev.id)) return;
        if (snapshot() === saved && !saving && !stopped) {
          stopped = true; // the reload replaces this dialog; do not save on its close
          setStatus('Gewijzigd door een collega: opnieuw laden…', 'busy');
          reload();
        }
      });
      // The PO itself (review 23 M1): deleted, or this group's members changed.
      onModalSync('exam', (ev: { id: string; year: string; after: Exam | null }) => {
        if (ev.id !== exam.id || ev.year !== year || stopped) return;
        if (!ev.after) {
          conflict('Deze PO is verwijderd door een collega.', closeModal);
          return;
        }
        const now = ev.after.projectgroepen?.find((g) => g.id === groupId);
        if (!now || !sameMembers(now.student_ids.map(String), members))
          conflict(
            'De leerlingen van deze projectgroep zijn intussen gewijzigd door een collega. Wat je nog niet had opgeslagen, is niet bewaard; de beoordeling wordt opnieuw geladen.',
            () => (now ? reopenFresh() : closeModal()),
          );
      });

      renderTotals();
    },
  });

  /** Saves the grading into every member file; false on a conflict or an error. */
  async function save(): Promise<boolean> {
    if (saving) await saving;
    if (stopped) return false;
    const want = snapshot();
    if (want === saved) return true;
    saving = (async () => {
      setStatus('Opslaan…', 'busy');
      const g = toSave();
      // A member file that is neither as read nor already as wanted: a colleague's change.
      const check = (m: string, r: ScoreRecord | null) => {
        const now = memberKey(r, exam.id);
        if (now === base.get(m)) return;
        const mine = structuredClone(r ?? {});
        writeGrading(mine, exam.id, groupId, g, ownToSave(m));
        if (now !== memberKey(mine, exam.id))
          throw new ConflictError(
            `${ctx.name(m)} is intussen door een collega beoordeeld. Jouw laatste wijzigingen zijn niet opgeslagen; de beoordeling wordt opnieuw geladen.`,
          );
      };
      try {
        const onDisk = (await Store.loadVersioned(`${year}/exams/${exam.id}.json`))
          .data as Exam | null;
        if (!onDisk) throw new ConflictError('Deze PO is verwijderd door een collega.');
        const now = onDisk.projectgroepen?.find((x) => x.id === groupId);
        if (!now || !sameMembers(now.student_ids.map(String), members))
          throw new ConflictError(
            'De leerlingen van deze projectgroep zijn intussen gewijzigd door een collega. Jouw laatste wijzigingen zijn niet opgeslagen; de beoordeling wordt opnieuw geladen.',
          );
        for (const m of members) {
          const { data } = await Store.loadVersioned(`${year}/scores/${subject}/${m}.json`);
          check(m, data as ScoreRecord | null);
        }
        for (const m of members) {
          let conflicted = false;
          const rec = (await Store.updateStudentScores(m, year, subject, (r: ScoreRecord) => {
            try {
              check(m, r);
            } catch (e) {
              conflicted = true;
              throw e;
            }
            writeGrading(r, exam.id, groupId, g, ownToSave(m));
          }).catch((e: unknown) => {
            if (conflicted) (e as ConflictError & { member?: string }).member = m;
            throw e;
          })) as ScoreRecord;
          base.set(m, memberKey(rec, exam.id));
          ctx.records.set(m, rec);
        }
        saved = want;
        setStatus(`● Automatisch opgeslagen · ${time()}`, 'ok');
        return true;
      } catch (err) {
        if (err instanceof ConflictError) {
          const member = (err as ConflictError & { member?: string }).member;
          const gone = err.text.startsWith('Deze PO is verwijderd');
          conflict(err.text, () => (gone ? closeModal() : reopenFresh(member)));
        } else {
          const msg = (err as { message?: string })?.message ?? String(err);
          setStatus(`Niet opgeslagen: ${msg}`, 'error');
          if (closed) persistentError(`Beoordeling niet opgeslagen: ${msg}`);
        }
        return false;
      }
    })();
    try {
      return await saving;
    } finally {
      saving = null;
    }
  }
}
