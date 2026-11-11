// SPDX-License-Identifier: AGPL-3.0-or-later

// Projectgroep beoordelen (step 23b; design spec 4.13, board 18; PLAN-2 decisions 17, 19, 24;
// grade rules decision 28). Per category the level cards (every level whose interval holds the
// score is highlighted), a slider, the category observaties and a comment; then the overall
// comment and the bonus/malus lines of the group and of each member; the footer has the general
// observaties, the live grades, Vorige/Volgende and Klaar.
//
// Saving: every 10 s while something changed, on Vorige/Volgende/Klaar and on closing. Each member
// file is written through the Store's CAS update; a member file that changed since this dialog
// read it is a conflict: nothing more is saved and the dialog offers to reload.

import {
  modalRefresher,
  onModalCleanup,
  onModalSync,
  openModal,
  showReloadNotice,
} from '../app.js';
import { esc } from '../components/dialog';
import { formatGrade } from '../domain/format';
import { gradeCellColor } from '../domain/grade-colors';
import { calcResults, poLineValid, poLinesSum, poWithLines } from '../domain/grades';
import { groupName } from '../domain/po';
import {
  gradingKey,
  gradingOf,
  groupSource,
  ownLinesOf,
  parseLineValue,
  signedPoints,
  writeGrading,
  type GroupGrading,
} from '../domain/po-grading';
import type { RubricCategory } from '../domain/rubric';
import type { PoLine, ScoreRecord } from '../domain/types';
import { Store } from '../store.js';
import { loadPoContext, sortedIds, type PoContext } from './po-scores';

/** How often a changed grading is saved (decision 24). */
export const AUTOSAVE_MS = 10_000;

interface LineDraft {
  label: string;
  /** As typed; saved only when it is a valid line value. */
  text: string;
}

interface Obs {
  id: string;
  naam: string;
  icon?: string;
}

const draftOf = (l: PoLine): LineDraft => ({
  label: l.label,
  text: l.value === null ? '' : signedPoints(l.value),
});

/** The lines of `drafts` that count (decision 28); the rest stays in the dialog only. */
function validLines(drafts: LineDraft[]): PoLine[] {
  return drafts
    .map((d) => ({ label: d.label.trim(), value: parseLineValue(d.text) }))
    .filter((l): l is PoLine & { value: number } => l.value !== null && poLineValid(l.value));
}

const lineInvalid = (d: LineDraft) => {
  const v = parseLineValue(d.text);
  return d.text.trim() !== '' && (v === null || !poLineValid(v));
};

/** What one member file holds for this PO, to notice a colleague's change. */
const memberKey = (rec: ScoreRecord | undefined, examId: string) =>
  JSON.stringify([gradingKey(gradingOf(rec, examId)), ownLinesOf(rec, examId)]);

/** Score ticks under a slider: every point up to 20, then every 5th or 10th. */
function ticks(max: number): number[] {
  const step = max <= 20 ? 1 : max <= 50 ? 5 : 10;
  const out: number[] = [];
  for (let i = 0; i <= max; i += step) out.push(i);
  if (out[out.length - 1] !== max) out.push(max);
  return out;
}

function levelRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`;
}

const time = () =>
  new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Opens the grading of one projectgroep (from the PO score table). */
export function openPoGrading(ctx: PoContext, groupId: string, onChanged?: () => void): void {
  const { exam, year, subject, rubric } = ctx;
  const groups = exam.projectgroepen ?? [];
  const index = groups.findIndex((g) => g.id === groupId);
  const group = groups[index];
  if (!group || !rubric) return;
  const members = sortedIds(ctx, group.student_ids);
  const source = groupSource(
    members.map((m) => ctx.records.get(m)),
    exam.id,
    groupId,
  );
  const grading: GroupGrading = structuredClone(gradingOf(source, exam.id));
  const groupDrafts: LineDraft[] = grading.groupLines.map(draftOf);
  const ownDrafts = new Map(
    members.map((m) => [m, ownLinesOf(ctx.records.get(m), exam.id).map(draftOf)]),
  );
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
  const snapshot = () =>
    JSON.stringify([gradingKey(toSave()), members.map((m) => validLines(ownDrafts.get(m) ?? []))]);
  let saved = snapshot();
  let saving: Promise<boolean> | null = null;
  let conflict = false;
  // Set by onShow (it runs inside openModal); save() reports through it.
  let statusRef: ((text: string, kind: 'ok' | 'busy' | 'error') => void) | null = null;

  const chip = (o: Obs, on: boolean, attrs: string) =>
    `<button type="button" class="po-gr-chip${on ? ' po-gr-chip--on' : ''}" aria-pressed="${on}" ${attrs}><span aria-hidden="true">${esc(o.icon ?? '')}</span>${esc(o.naam)}</button>`;

  const levelsHtml = (c: RubricCategory, v: number | undefined) =>
    c.niveaus
      .map((n) => {
        const [min, max] = [n.min ?? 0, n.max ?? 0];
        const on = v !== undefined && min <= v && v <= max;
        return `<div class="po-gr-level${on ? ' po-gr-level--on' : ''}" data-min="${min}" data-max="${max}"${on ? ' aria-current="true"' : ''}>
          <span class="po-gr-level-range">${levelRange(min, max)}</span>
          ${n.titel ? `<b class="po-gr-level-title">${esc(n.titel)}</b>` : ''}
          <span class="po-gr-level-text">${esc(n.uitleg)}</span>
        </div>`;
      })
      .join('');

  const catHtml = (c: RubricCategory) => {
    const v = grading.scores[c.id];
    const max = c.max ?? 0;
    const catObs = obsList([...(c.obs_ids ?? []), ...(grading.categoryObs[c.id] ?? [])]);
    const soort =
      c.soort === 'bonus'
        ? '<span class="po-gr-pill">BONUS</span>'
        : c.soort === 'diagnostisch'
          ? '<span class="po-gr-pill po-gr-pill--diag">DIAGNOSTISCH</span>'
          : '';
    return `<section class="po-gr-cat${v === undefined ? ' po-gr-cat--empty' : ''}" data-cat="${esc(c.id)}" aria-label="${esc(c.naam)}">
      <div class="po-gr-cat-main">
        <div class="po-gr-cat-head">
          <b class="po-gr-cat-name">${esc(c.naam)}</b>${soort}
          <span class="po-gr-cat-spacer"></span>
          <button type="button" class="btn btn--text btn--sm po-gr-clear"${v === undefined ? ' hidden' : ''}>Wissen</button>
          <span class="po-gr-cat-score"><span class="po-gr-v">${v ?? '—'}</span><span class="po-gr-max"> / ${max}</span></span>
        </div>
        <div class="po-gr-levels" data-n="${c.niveaus.length}">${levelsHtml(c, v)}</div>
        <div class="po-gr-slider">
          <input type="range" min="0" max="${max}" step="1" value="${v ?? 0}" aria-label="${esc(c.naam)}: score" aria-valuetext="${v === undefined ? 'nog geen score' : `${v} van ${max}`}" />
          <div class="po-gr-ticks" aria-hidden="true">${ticks(max)
            .map((t) => `<span>${t}</span>`)
            .join('')}</div>
        </div>
      </div>
      <div class="po-gr-cat-side">
        <span class="po-gr-label">Observaties</span>
        <div class="po-gr-chips">${
          catObs.length
            ? catObs
                .map((o) =>
                  chip(
                    o,
                    (grading.categoryObs[c.id] ?? []).includes(o.id),
                    `data-cat-obs="${esc(o.id)}"`,
                  ),
                )
                .join('')
            : '<span class="po-gr-none">Geen observaties bij deze categorie</span>'
        }</div>
        <textarea class="po-gr-comment" rows="3" data-cat-comment="${esc(c.id)}" placeholder="Opmerking bij ${esc(c.naam)}" aria-label="Opmerking bij ${esc(c.naam)}">${esc(grading.categoryComments[c.id] ?? '')}</textarea>
      </div>
    </section>`;
  };

  const lineRow = (d: LineDraft, attrs: string) => `
    <div class="po-gr-line" ${attrs}>
      <input type="text" class="po-gr-line-label" value="${esc(d.label)}" placeholder="Omschrijving" aria-label="Omschrijving" />
      <input type="text" class="po-gr-line-value" inputmode="decimal" value="${esc(d.text)}" placeholder="±0,5" aria-label="Cijferpunten" title="Cijferpunten: één decimaal, van −9,0 tot +9,0"${lineInvalid(d) ? ' aria-invalid="true"' : ''} />
      <button type="button" class="btn btn--icon po-gr-line-remove" aria-label="Regel verwijderen" title="Regel verwijderen">×</button>
    </div>`;

  const linesHtml = () => `
    <div class="po-gr-adj-col">
      <span class="po-gr-label">Bonus / malus voor de hele projectgroep</span>
      ${groupDrafts.map((d, i) => lineRow(d, `data-line="group" data-i="${i}"`)).join('')}
      <button type="button" class="btn po-gr-add-line" data-add-line="group">+ Regel</button>
    </div>
    <div class="po-gr-adj-col">
      <span class="po-gr-label">Bonus / malus per leerling</span>
      ${members
        .map(
          (m) => `<div class="po-gr-member-lines" data-member="${esc(m)}">
            <span class="po-gr-member-name">${esc(ctx.name(m))}</span>
            <div class="po-gr-member-list">
              ${(ownDrafts.get(m) ?? []).map((d, i) => lineRow(d, `data-line="own" data-member="${esc(m)}" data-i="${i}"`)).join('')}
              <button type="button" class="btn po-gr-add-line" data-add-line="own" data-member="${esc(m)}">+ Regel</button>
            </div>
          </div>`,
        )
        .join('')}
    </div>
    <p class="po-gr-line-hint">Cijferpunten met hoogstens één decimaal, van −9,0 tot +9,0. Een regel zonder geldige waarde wordt niet bewaard.</p>`;

  const memberLine = members.map((m) => `${esc(ctx.name(m))} (${esc(ctx.classTag(m))})`).join(', ');
  const name = groupName(group, index);

  openModal({
    title: `${name} beoordelen`,
    key: 'po-grade',
    subtitleHtml: `${esc(exam.title)} · ${memberLine}`,
    className: 'dlg--po-grade',
    fixedHeight: true,
    bodyClass: 'po-gr-body',
    headerActionsHtml: '<span class="po-gr-status" id="po-gr-status" role="status"></span>',
    body: `${cats.map(catHtml).join('')}
      <section class="po-gr-card">
        <label class="po-gr-label" for="po-gr-overall">Commentaar op het werk als geheel</label>
        <textarea id="po-gr-overall" class="po-gr-overall" rows="4">${esc(grading.comment)}</textarea>
      </section>
      <section class="po-gr-card po-gr-adj" id="po-gr-adj">${linesHtml()}</section>`,
    footerHtml: `<div class="po-gr-foot">
        <div class="po-gr-general" role="group" aria-label="Algemene observaties">
          <span class="po-gr-label">Algemene observaties</span>
          ${
            generalObs.length
              ? generalObs
                  .map((o) =>
                    chip(o, grading.observations.includes(o.id), `data-gen-obs="${esc(o.id)}"`),
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
      void save().finally(() => onChanged?.());
    },
    onShow: (el: HTMLElement) => {
      const $ = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
      const status = $('#po-gr-status');
      const setStatus = (text: string, kind: 'ok' | 'busy' | 'error') => {
        status.textContent = text;
        status.dataset.kind = kind;
      };
      setStatus('● Alles opgeslagen', 'ok');

      const renderTotals = () => {
        const s = toSave();
        const groupSum = poLinesSum(s.groupLines);
        const scored = Object.keys(s.scores).length > 0;
        const base = calcResults(exam, s.scores, null, { groupLines: s.groupLines });
        const r = base.rubricGrade;
        $('#po-gr-points').innerHTML =
          `Punten <b>${base.scored}</b> / ${maxNormal} → projectgroep <b>${scored && r !== undefined ? formatGrade(poWithLines(r, groupSum)) : '—'}</b>`;
        $('#po-gr-grades').innerHTML = members
          .map((m) => {
            const res = calcResults(exam, s.scores, null, {
              groupLines: s.groupLines,
              ownLines: validLines(ownDrafts.get(m) ?? []),
            });
            const g = scored ? res.grade : null;
            const fill = gradeCellColor(g);
            const first = (ctx.students.get(m)?.voornaam ?? ctx.name(m)).trim();
            return `<span class="po-gr-grade"${fill ? ` data-bg="${fill}"` : ''} title="${esc(ctx.name(m))}">${esc(first)} <b>${formatGrade(g)}</b></span>`;
          })
          .join('');
      };

      const changed = () => {
        renderTotals();
        if (!conflict && snapshot() !== saved)
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
        if (line) {
          const list =
            line.dataset.line === 'group'
              ? groupDrafts
              : (ownDrafts.get(line.dataset.member ?? '') ?? []);
          const d = list[Number(line.dataset.i)];
          if (!d) return;
          if (t.classList.contains('po-gr-line-label')) d.label = t.value;
          else {
            d.text = t.value;
            if (lineInvalid(d)) t.setAttribute('aria-invalid', 'true');
            else t.removeAttribute('aria-invalid');
          }
          changed();
        }
      });

      const toggle = (list: string[], id: string): string[] =>
        list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      const press = (btn: HTMLElement, on: boolean) => {
        btn.classList.toggle('po-gr-chip--on', on);
        btn.setAttribute('aria-pressed', String(on));
      };

      const rerenderLines = (focus?: string) => {
        $('#po-gr-adj').innerHTML = linesHtml();
        if (focus) el.querySelector<HTMLElement>(focus)?.focus();
        changed();
      };

      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const catObs = t.closest<HTMLElement>('[data-cat-obs]');
        if (catObs) {
          const cat = catObs.closest<HTMLElement>('.po-gr-cat')?.dataset.cat ?? '';
          const now = toggle(grading.categoryObs[cat] ?? [], catObs.dataset.catObs ?? '');
          grading.categoryObs[cat] = now;
          press(catObs, now.includes(catObs.dataset.catObs ?? ''));
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
          const list = add.dataset.addLine === 'group' ? groupDrafts : ownDrafts.get(member);
          list?.push({ label: '', text: '' });
          const sel =
            add.dataset.addLine === 'group'
              ? `[data-line="group"][data-i="${groupDrafts.length - 1}"] .po-gr-line-label`
              : `[data-line="own"][data-member="${CSS.escape(member)}"][data-i="${(list?.length ?? 1) - 1}"] .po-gr-line-label`;
          rerenderLines(sel);
          return;
        }
        const remove = t.closest<HTMLElement>('.po-gr-line-remove');
        if (remove) {
          const line = remove.closest<HTMLElement>('.po-gr-line')!;
          const member = line.dataset.member ?? '';
          const list = line.dataset.line === 'group' ? groupDrafts : ownDrafts.get(member);
          list?.splice(Number(line.dataset.i), 1);
          rerenderLines(
            line.dataset.line === 'group'
              ? '[data-add-line="group"]'
              : `[data-add-line="own"][data-member="${CSS.escape(member)}"]`,
          );
        }
      });

      const go = async (to: number) => {
        if (!(await save())) return;
        const next = groups[to];
        if (next) openPoGrading(ctx, next.id, onChanged);
      };
      $('#po-gr-prev').addEventListener('click', () => void go(index - 1));
      $('#po-gr-next').addEventListener('click', () => void go(index + 1));
      $('#po-gr-done').addEventListener('click', () => {
        const dlg = el.closest('.dlg') ?? el;
        dlg.querySelector<HTMLElement>('.dlg-close')?.click();
      });

      const timer = setInterval(() => {
        if (!conflict && snapshot() !== saved) void save();
      }, AUTOSAVE_MS);
      onModalCleanup(() => clearInterval(timer));

      // A colleague's change to a member file: reload if nothing is pending here; otherwise the
      // next save reports the conflict.
      const reload = modalRefresher(async () => {
        const fresh = await loadPoContext(exam.id, year);
        if (fresh) openPoGrading(fresh, groupId, onChanged);
      });
      onModalSync('scores', (ev: { year: string; subject: string; id: string }) => {
        if (ev.year !== year || ev.subject !== subject || !members.includes(ev.id)) return;
        if (snapshot() === saved && !saving) {
          saved = '\u0000'; // the reload replaces this dialog; do not save on its close
          reload();
        }
      });

      statusRef = setStatus;
      renderTotals();
    },
  });

  /** Saves the grading into every member file; false on a conflict or an error. */
  async function save(): Promise<boolean> {
    if (saving) await saving;
    if (conflict) return false;
    const want = snapshot();
    if (want === saved || saved === '\u0000') return true;
    saving = (async () => {
      statusRef?.('Opslaan…', 'busy');
      const g = toSave();
      const own = (m: string) => validLines(ownDrafts.get(m) ?? []);
      // A member file that is neither as read nor already as wanted: a colleague's change.
      const check = (m: string, r: ScoreRecord | null) => {
        const now = memberKey(r ?? undefined, exam.id);
        if (now === base.get(m)) return;
        const mine = structuredClone(r ?? {});
        writeGrading(mine, exam.id, groupId, g, own(m));
        if (now !== memberKey(mine, exam.id)) throw new ConflictError(m);
      };
      try {
        // Every file first, so a conflict leaves the whole group as it was.
        for (const m of members) {
          const { data } = await Store.loadVersioned(`${year}/scores/${subject}/${m}.json`);
          check(m, data as ScoreRecord | null);
        }
        for (const m of members) {
          const rec = (await Store.updateStudentScores(m, year, subject, (r: ScoreRecord) => {
            check(m, r);
            writeGrading(r, exam.id, groupId, g, own(m));
          })) as ScoreRecord;
          base.set(m, memberKey(rec, exam.id));
          ctx.records.set(m, rec);
        }
        saved = want;
        statusRef?.(`● Automatisch opgeslagen · ${time()}`, 'ok');
        return true;
      } catch (err) {
        if (err instanceof ConflictError) {
          conflict = true;
          statusRef?.('Niet opgeslagen: gewijzigd door een collega', 'error');
          showReloadNotice(
            `${ctx.name(err.member)} is intussen door een collega beoordeeld. Jouw laatste wijzigingen zijn niet opgeslagen; de beoordeling wordt opnieuw geladen.`,
            async () => {
              const fresh = await loadPoContext(exam.id, year);
              if (fresh) openPoGrading(fresh, groupId, onChanged);
            },
          );
        } else {
          const msg = (err as { message?: string })?.message ?? String(err);
          statusRef?.(`Niet opgeslagen: ${msg}`, 'error');
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

class ConflictError extends Error {
  constructor(readonly member: string) {
    super('conflict');
  }
}
