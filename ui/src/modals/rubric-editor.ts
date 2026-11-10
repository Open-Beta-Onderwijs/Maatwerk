// SPDX-License-Identifier: AGPL-3.0-or-later

// The rubric editor (step 21, design spec 4.13, board 16): a fixed-height dialog with the
// rubric's fields on top, one card per category (name, max, soort, the level display, the level
// rows, the category's PO observaties) and the general PO observaties at the bottom. The rules
// are checked live with the core's code (WebAssembly); Opslaan stays disabled while anything is
// invalid. While a PO uses the rubric, categories, maxima and soort are locked (decision 20).

import { closeModal, guardModalClose, openModal, toast } from '../app.js';
import { setBusy } from '../components/button';
import { esc } from '../components/dialog';
import {
  checkRubric,
  defaultLevels,
  lockedChanges,
  MAX_LEVELS,
  newCategory,
  newRubric,
  obsHasToetstype,
  totalsText,
  usageText,
  type Rubric,
  type RubricCategory,
  type RubricCheck,
  type RubricUse,
  type Soort,
} from '../domain/rubric';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import {
  applyLevelDisplay,
  levelDisplay,
  levelRows,
  obsChip,
  soortSegmented,
} from './rubric-levels';

const SCHOOLSOORTEN = ['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium'];
const JAARLAGEN = ['1', '2', '3', '4', '5', '6'];

const LOCK_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

interface Obs {
  id: string;
  naam?: string;
  icon?: string;
  toetstypes?: unknown;
}

export interface RubricEditorOptions {
  /** The PO's that use the rubric; any locks it (decision 20). */
  usage: RubricUse[];
  /** A copy ("Dupliceren"): saved as a new file, never locked. */
  isNew?: boolean;
  onSaved?: () => unknown;
}

/** Whole numbers and decimal commas as typed; empty or not a number is null. */
function parseNum(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A file read from disk with every list present, so the editor can rely on them. */
function normalise(r: Rubric): Rubric {
  return {
    ...r,
    naam: r.naam ?? '',
    schoolsoort: [...(r.schoolsoort ?? [])],
    jaarlagen: (r.jaarlagen ?? []).map(String),
    obs_ids: [...(r.obs_ids ?? [])],
    categories: (r.categories ?? []).map((c) => ({
      ...c,
      naam: c.naam ?? '',
      soort: c.soort ?? 'normaal',
      obs_ids: [...(c.obs_ids ?? [])],
      niveaus: (c.niveaus ?? []).map((l) => ({
        ...l,
        titel: l.titel ?? '',
        uitleg: l.uitleg ?? '',
      })),
    })),
  };
}

/** What is saved: trimmed names, no empty titles. */
function cleaned(r: Rubric): Rubric {
  return {
    ...r,
    naam: r.naam.trim(),
    categories: r.categories.map((c) => ({
      ...c,
      naam: c.naam.trim(),
      niveaus: c.niveaus.map((l) => {
        const lv = { ...l, uitleg: l.uitleg.trim() };
        if (lv.titel?.trim()) lv.titel = lv.titel.trim();
        else delete lv.titel;
        return lv;
      }),
    })),
  };
}

function toggles(cls: string, data: string, values: string[], on: string[], allowed?: string[]) {
  return values
    .map((v) => {
      const dis = allowed && allowed.length > 0 && !allowed.includes(v);
      return `<button type="button" class="tog-btn ${cls}${on.includes(v) ? ' selected' : ''}${dis ? ' tog-btn-disabled' : ''}" data-${data}="${esc(v)}" aria-pressed="${on.includes(v)}"${dis ? ' disabled' : ''}>${esc(v)}</button>`;
    })
    .join('');
}

export function openRubricEditor(existing: Rubric | null, opts: RubricEditorOptions): void {
  const subject: string = Store.getActiveSubject();
  const isNew = !!opts.isNew || !existing;
  const draft = normalise(existing ? structuredClone(existing) : newRubric(subject));
  const original = isNew ? null : structuredClone(draft);
  const uses = isNew ? 0 : opts.usage.length;
  const locked = uses > 0;
  const poObs: Obs[] = (Store.getObservatiesSync() as Obs[])
    .filter((o) => obsHasToetstype(o, 'po'))
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }));
  const obsById = new Map((Store.getObservatiesSync() as Obs[]).map((o) => [o.id, o]));
  // The school's own schoolsoorten (board 16 shows three), plus any the rubric already has.
  const schoolSS: string[] = Store.getSchoolSync().schoolsoort ?? [];
  const ssOptions = schoolSS.length
    ? SCHOOLSOORTEN.filter((s) => schoolSS.includes(s) || draft.schoolsoort.includes(s))
    : SCHOOLSOORTEN;
  const vak = (Store.SUBJECT_DISPLAY as Record<string, string>)[draft.subject] ?? draft.subject;
  const initial = JSON.stringify(draft);
  let check: RubricCheck = checkRubric(draft);

  const lockPill = locked
    ? `<span class="rubric-lock-banner">${LOCK_ICON}${esc(usageText(uses))}: categorieën, maxima en soort liggen vast</span>`
    : '';

  const body = `
    <div class="rubric-head">
      ${lockPill}
      <div class="rubric-head-row">
        <div class="form-group rubric-f-naam">
          <label for="rubric-naam">Naam</label>
          <input id="rubric-naam" type="text" value="${esc(draft.naam)}" placeholder="bijv. Onderzoeksverslag" />
        </div>
        <div class="form-group">
          <label>Schoolsoort</label>
          <div class="exam-chips" id="rubric-ss">${toggles('ss-btn exam-chip', 'ss', ssOptions, draft.schoolsoort)}</div>
        </div>
        <div class="form-group">
          <label>Vak</label>
          <div class="form-value">${esc(vak)}</div>
        </div>
        <div class="form-group">
          <label>Jaarlagen</label>
          <div class="btn-toggle-group" id="rubric-jl">${toggles('jl-btn', 'jl', JAARLAGEN, draft.jaarlagen)}</div>
        </div>
        <div class="form-group rubric-f-total">
          <label>Totaal</label>
          <div class="form-value" id="rubric-total"></div>
        </div>
      </div>
    </div>
    <div class="rubric-scroll">
      <div class="rubric-cats" id="rubric-cats"></div>
      <button type="button" class="btn btn--secondary rubric-dashed" id="rubric-add-cat"${locked ? ' disabled title="In gebruik: geen categorieën toevoegen"' : ''}>+ Categorie toevoegen</button>
    </div>
    <div class="rubric-gen-obs">
      <span class="rubric-label">Algemene observaties</span>
      <div class="rubric-obs-list" id="rubric-gen-obs"></div>
    </div>`;

  openModal({
    title: isNew ? 'Nieuwe rubric' : 'Rubric bewerken',
    key: 'rubric-edit',
    size: 'xl',
    className: 'dlg--rubric',
    fixedHeight: true,
    bodyClass: 'rubric-body',
    footerHtml: `
      <span class="rubric-save-note" id="rubric-note" aria-live="polite"></span>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
      <button class="btn btn--primary" id="rubric-save">Opslaan</button>`,
    body,
    onShow: (el: HTMLElement) => {
      const cats = el.querySelector<HTMLElement>('#rubric-cats')!;
      const saveBtn = el.querySelector<HTMLButtonElement>('#rubric-save')!;
      const note = el.querySelector<HTMLElement>('#rubric-note')!;

      const catHtml = (cat: RubricCategory, i: number): string => {
        const c = check.categories[i];
        const err = c?.errors.length ? c.errors.join(' · ') : '';
        const chips = cat.obs_ids.map((id) => obsChip(obsById.get(id) ?? { id }, true)).join('');
        return `<section class="rubric-cat${err ? ' is-invalid' : ''}" data-cat="${i}">
          <div class="rubric-cat-head">
            <span class="rubric-handle" draggable="true" tabindex="0" role="button" aria-label="Categorie verplaatsen (Alt+pijl omhoog of omlaag)" title="Slepen om te ordenen">⋮⋮</span>
            <input class="rubric-cat-name" data-field="naam" value="${esc(cat.naam)}" placeholder="Naam categorie" aria-label="Naam categorie" />
            <span class="rubric-max">max <input class="rubric-num" data-field="cat-max" inputmode="numeric" value="${esc(cat.max ?? '')}" aria-label="Maximumscore"${locked ? ' disabled' : ''} /></span>
            ${soortSegmented(cat, locked)}
            <span class="rubric-cat-error" role="status">${esc(err)}</span>
            <button type="button" class="btn btn--icon btn--icon-danger" data-action="del-cat" aria-label="Categorie verwijderen" title="${locked ? 'In gebruik: niet te verwijderen' : 'Categorie verwijderen'}"${locked ? ' disabled' : ''}>${ICONS.trash}</button>
          </div>
          <div class="rubric-display-host">${levelDisplay(cat, c)}</div>
          <div class="rubric-levels">${levelRows(cat, c)}</div>
          <div class="rubric-cat-obs">
            <span class="rubric-label">Observaties</span>
            ${chips}
            <span class="rubric-obs-add">
              <button type="button" class="btn btn--secondary btn--sm rubric-dashed" data-action="add-obs" aria-haspopup="true">+ Observatie</button>
            </span>
          </div>
        </section>`;
      };

      const renderGenObs = (): void => {
        const host = el.querySelector<HTMLElement>('#rubric-gen-obs')!;
        host.innerHTML = poObs.length
          ? poObs
              .map((o) => {
                const on = draft.obs_ids.includes(o.id);
                return `<button type="button" class="rubric-obs-toggle${on ? ' selected' : ''}" data-action="gen-obs" data-obs-id="${esc(o.id)}" aria-pressed="${on}"><span aria-hidden="true">${esc(o.icon ?? '')}</span>${esc(o.naam ?? o.id)}</button>`;
              })
              .join('')
          : '<span class="muted small">Nog geen observaties met toetstype PO voor dit vak.</span>';
      };

      /** The live check: totals, every category's error line and borders, the save state. */
      const validate = (): void => {
        check = checkRubric(draft);
        el.querySelector<HTMLElement>('#rubric-total')!.textContent = totalsText(check.totals);
        cats.querySelectorAll<HTMLElement>('.rubric-cat').forEach((sec) => {
          const i = Number(sec.dataset.cat);
          const c = check.categories[i];
          const err = c?.errors.join(' · ') ?? '';
          sec.classList.toggle('is-invalid', !!err);
          sec.querySelector<HTMLElement>('.rubric-cat-error')!.textContent = err;
          sec.querySelectorAll<HTMLElement>('.rubric-level').forEach((row) => {
            const missing = c?.missingUitleg.includes(Number(row.dataset.level)) ?? false;
            row.querySelector('[data-field="uitleg"]')?.classList.toggle('is-invalid', missing);
          });
        });
        const locks = original && locked ? lockedChanges(original, draft) : [];
        const ok = check.valid && locks.length === 0;
        saveBtn.disabled = !ok;
        note.textContent = check.errors.length
          ? check.errors.join(' · ')
          : !check.valid
            ? 'Los eerst de fouten op die rood zijn; daarna kun je opslaan.'
            : locks.join(' · ');
      };

      /** After a number changed: the display and the red fields of one category. */
      const refreshNumbers = (i: number): void => {
        validate();
        const sec = cats.querySelector<HTMLElement>(`.rubric-cat[data-cat="${i}"]`);
        const cat = draft.categories[i];
        if (!sec || !cat) return;
        const c = check.categories[i];
        const host = sec.querySelector<HTMLElement>('.rubric-display-host')!;
        host.innerHTML = levelDisplay(cat, c);
        applyLevelDisplay(host);
        const bad = new Set(c?.badLevels ?? []);
        sec.querySelectorAll<HTMLElement>('.rubric-level').forEach((row) => {
          const li = Number(row.dataset.level);
          const lv = cat.niveaus[li];
          if (!lv) return;
          const shared = (key: 'min' | 'max') =>
            lv[key] !== null && cat.niveaus.filter((l) => l[key] === lv[key]).length > 1;
          row
            .querySelector('[data-field="min"]')
            ?.classList.toggle('is-invalid', bad.has(li) || shared('min'));
          row
            .querySelector('[data-field="max"]')
            ?.classList.toggle('is-invalid', bad.has(li) || shared('max'));
        });
      };

      const renderCats = (focus?: string): void => {
        const scroller = cats.closest('.rubric-scroll');
        const y = scroller?.scrollTop ?? 0;
        check = checkRubric(draft);
        cats.innerHTML = draft.categories.map(catHtml).join('');
        applyLevelDisplay(cats);
        validate();
        if (scroller) scroller.scrollTop = y;
        if (focus) cats.querySelector<HTMLElement>(focus)?.focus();
      };

      const catIndex = (t: HTMLElement): number =>
        Number(t.closest<HTMLElement>('.rubric-cat')?.dataset.cat ?? -1);
      const levelIndex = (t: HTMLElement): number =>
        Number(t.closest<HTMLElement>('.rubric-level')?.dataset.level ?? -1);

      // ── Typing ──────────────────────────────────────────────────────────────
      el.querySelector<HTMLInputElement>('#rubric-naam')!.addEventListener('input', (e) => {
        draft.naam = (e.target as HTMLInputElement).value;
        validate();
      });
      cats.addEventListener('input', (e) => {
        const t = e.target as HTMLInputElement;
        const i = catIndex(t);
        const cat = draft.categories[i];
        if (!cat) return;
        const field = t.dataset.field;
        if (field === 'naam') {
          cat.naam = t.value;
          validate();
        } else if (field === 'cat-max') {
          cat.max = parseNum(t.value);
          refreshNumbers(i);
          const hint = t.closest('.rubric-cat')?.querySelector('.rubric-level-add .muted');
          if (hint && cat.max !== null && Number.isInteger(cat.max)) {
            hint.textContent = `Intervallen mogen overlappen, maar delen geen begin of eind en dekken samen 0 tot en met ${cat.max}.`;
          }
        } else {
          const lv = cat.niveaus[levelIndex(t)];
          if (!lv) return;
          if (field === 'min' || field === 'max') {
            lv[field] = parseNum(t.value);
            refreshNumbers(i);
          } else if (field === 'titel') {
            lv.titel = t.value;
            refreshNumbers(i);
          } else if (field === 'uitleg') {
            lv.uitleg = t.value;
            validate();
          }
        }
      });

      // ── Buttons ─────────────────────────────────────────────────────────────
      const closeObsPop = (): void =>
        el.querySelectorAll('.rubric-obs-pop').forEach((p) => p.remove());

      const openObsPop = (btn: HTMLElement, cat: RubricCategory, i: number): void => {
        closeObsPop();
        const free = poObs.filter((o) => !cat.obs_ids.includes(o.id));
        const pop = document.createElement('div');
        pop.className = 'filter-popover rubric-obs-pop';
        pop.setAttribute('role', 'menu');
        pop.innerHTML = free.length
          ? free
              .map(
                (o) =>
                  `<button type="button" class="filter-pop-toggle" role="menuitem" data-action="pick-obs" data-obs-id="${esc(o.id)}"><span aria-hidden="true">${esc(o.icon ?? '')}</span> ${esc(o.naam ?? o.id)}</button>`,
              )
              .join('')
          : '<div class="filter-pop-empty">Geen (andere) observaties met toetstype PO.</div>';
        btn.parentElement!.append(pop);
        pop.dataset.cat = String(i);
        pop.querySelector<HTMLElement>('button')?.focus();
      };

      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (!t.closest('.rubric-obs-add')) closeObsPop();
        const btn = t.closest<HTMLElement>('[data-action]');
        if (!btn || (btn as HTMLButtonElement).disabled) return;
        const action = btn.dataset.action;
        if (action === 'gen-obs') {
          const id = btn.dataset.obsId ?? '';
          draft.obs_ids = draft.obs_ids.includes(id)
            ? draft.obs_ids.filter((x) => x !== id)
            : [...draft.obs_ids, id];
          renderGenObs();
          return;
        }
        const i = catIndex(btn);
        const cat = draft.categories[i];
        if (!cat) return;
        switch (action) {
          case 'soort':
            if (locked) return;
            cat.soort = btn.dataset.soort as Soort;
            renderCats();
            break;
          case 'add-level': {
            if (cat.niveaus.length >= MAX_LEVELS) return;
            const top = cat.niveaus.reduce((m, l) => Math.max(m, l.max ?? 0), -1);
            const max = cat.max ?? top + 1;
            const from = Math.min(top + 1, max);
            cat.niveaus.push({ min: from, max, titel: '', uitleg: '' });
            renderCats(
              `.rubric-cat[data-cat="${i}"] .rubric-level:last-of-type [data-field="uitleg"]`,
            );
            break;
          }
          case 'del-level':
            cat.niveaus.splice(levelIndex(btn), 1);
            renderCats();
            break;
          case 'del-cat':
            if (locked) return;
            draft.categories.splice(i, 1);
            renderCats();
            break;
          case 'add-obs':
            openObsPop(btn, cat, i);
            break;
          case 'pick-obs':
            cat.obs_ids.push(btn.dataset.obsId ?? '');
            renderCats(`.rubric-cat[data-cat="${i}"] [data-action="add-obs"]`);
            break;
          case 'del-obs': {
            const id = btn.closest<HTMLElement>('[data-obs-id]')?.dataset.obsId;
            cat.obs_ids = cat.obs_ids.filter((x) => x !== id);
            renderCats(`.rubric-cat[data-cat="${i}"] [data-action="add-obs"]`);
            break;
          }
        }
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && el.querySelector('.rubric-obs-pop')) {
          e.preventDefault();
          closeObsPop();
        }
      });

      el.querySelector('#rubric-add-cat')!.addEventListener('click', () => {
        if (locked) return;
        const cat = newCategory();
        cat.niveaus = defaultLevels(cat.max ?? 4);
        draft.categories.push(cat);
        renderCats(`.rubric-cat[data-cat="${draft.categories.length - 1}"] .rubric-cat-name`);
      });

      const wireToggles = (sel: string, key: 'schoolsoort' | 'jaarlagen', data: string): void => {
        el.querySelector(sel)!.addEventListener('click', (e) => {
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.tog-btn');
          if (!b || b.disabled) return;
          const v = b.dataset[data] ?? '';
          const on = !draft[key].includes(v);
          draft[key] = on ? [...draft[key], v] : draft[key].filter((x) => x !== v);
          b.classList.toggle('selected', on);
          b.setAttribute('aria-pressed', String(on));
          validate();
        });
      };
      wireToggles('#rubric-ss', 'schoolsoort', 'ss');
      wireToggles('#rubric-jl', 'jaarlagen', 'jl');

      // ── Ordering: drag the handle, or Alt+arrow on it ──────────────────────
      let dragFrom = -1;
      const move = (from: number, to: number): void => {
        if (from === to || to < 0 || to >= draft.categories.length) return;
        const [cat] = draft.categories.splice(from, 1);
        if (cat) draft.categories.splice(to, 0, cat);
        renderCats(`.rubric-cat[data-cat="${to}"] .rubric-handle`);
      };
      cats.addEventListener('dragstart', (e) => {
        const handle = (e.target as HTMLElement).closest('.rubric-handle');
        const sec = handle?.closest<HTMLElement>('.rubric-cat');
        if (!sec) return;
        dragFrom = Number(sec.dataset.cat);
        e.dataTransfer?.setDragImage(sec, 20, 20);
        e.dataTransfer?.setData('text/plain', String(dragFrom));
      });
      cats.addEventListener('dragover', (e) => {
        if (dragFrom >= 0 && (e.target as HTMLElement).closest('.rubric-cat')) e.preventDefault();
      });
      cats.addEventListener('drop', (e) => {
        const sec = (e.target as HTMLElement).closest<HTMLElement>('.rubric-cat');
        if (!sec || dragFrom < 0) return;
        e.preventDefault();
        move(dragFrom, Number(sec.dataset.cat));
        dragFrom = -1;
      });
      cats.addEventListener('dragend', () => {
        dragFrom = -1;
      });
      cats.addEventListener('keydown', (e) => {
        const handle = (e.target as HTMLElement).closest('.rubric-handle');
        if (!handle || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const i = catIndex(handle as HTMLElement);
        move(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
      });

      // ── Save ───────────────────────────────────────────────────────────────
      let saved = false;
      saveBtn.addEventListener('click', async () => {
        validate();
        if (saveBtn.disabled) return;
        setBusy(saveBtn, true);
        try {
          await Store.upsertRubric(cleaned(draft));
        } catch (err) {
          if ((err as { code?: string }).code !== 'refused') throw err;
          note.textContent = (err as Error).message;
          toast((err as Error).message, 'error');
          return;
        } finally {
          setBusy(saveBtn, false);
        }
        saved = true;
        closeModal();
        toast('Rubric opgeslagen.', 'success');
        await opts.onSaved?.();
      });

      renderGenObs();
      renderCats();
      guardModalClose(() => !saved && JSON.stringify(draft) !== initial);
      if (isNew && !draft.naam) el.querySelector<HTMLInputElement>('#rubric-naam')?.focus();
    },
  });
}
