// SPDX-License-Identifier: AGPL-3.0-or-later

// "Voorstel bekijken" (decision 69, board 61): a dialog with the files and hunks to choose on
// the left, the side-by-side hunks in the middle, and a preview of the chosen proposal or the
// current version on the right. "Toepassen (n)" applies the chosen hunks and images as one undo
// step (the panel's `apply`).

import type { AiProvider, CheckReport, ProposalView } from '../../bridge/ai-api';
import type { EditorAi } from './client';
import { h, icon, monogram } from './dom';
import {
  applyHunks,
  hunkLocation,
  hunkRows,
  hunkTitle,
  plusMinus,
  remainingDiagnostics,
  triState,
} from './model';

export interface ReviewOptions {
  ai: EditorAi;
  provider: AiProvider;
  view: ProposalView;
  check: CheckReport | null;
  /** The editor text now. */
  buffers: Record<string, string>;
  /** Toepassen (n); null after the proposal was applied: the dialog only shows it (user). */
  apply: ((hunks: Record<string, number[]>, images: string[]) => Promise<void>) | null;
}

let openDialog: HTMLElement | null = null;

export async function openReview(o: ReviewOptions): Promise<void> {
  openDialog?.remove();
  const { proposal, statuses } = o.view;
  const apply = o.apply;
  // Applied already: the hunks against today's text say nothing (they are in it).
  const readOnly = apply === null;
  const key = (file: string, id: number) => `${file}#${id}`;
  const chosen = new Set<string>();
  const conflict = (file: string, i: number) =>
    !readOnly && statuses[file]?.[i]?.kind === 'conflict';
  for (const f of proposal.files)
    f.hunks.forEach((hk, i) => {
      if (!conflict(f.path, i)) chosen.add(key(f.path, hk.id));
    });
  const images = new Set(proposal.images.map((i) => i.path));
  const total =
    proposal.files.reduce((n, f) => n + f.hunks.filter((_, i) => !conflict(f.path, i)).length, 0) +
    proposal.images.length;
  const conflicts = proposal.files.reduce(
    (n, f) => n + f.hunks.filter((_, i) => conflict(f.path, i)).length,
    0,
  );
  const edited = proposal.files.some((f) => (o.buffers[f.path] ?? f.base) !== f.base);
  let tab: 'proposal' | 'current' = readOnly ? 'current' : 'proposal';
  let previewSeq = 0;

  const m = monogram(o.provider.key, o.provider.name);
  const avatar = h('span', { class: 'ai-avatar is-large' }, m.text);
  avatar.style.setProperty('--provider', m.colour);
  const countEl = h('span', { class: 'ai-review-count' });
  const applyBtn = h('button', { type: 'button', class: 'ai-btn ai-btn-primary ai-btn-lg' });
  const closeBtn = h(
    'button',
    { type: 'button', class: 'ai-btn ai-btn-lg', onclick: () => close() },
    readOnly ? 'Sluiten' : 'Annuleren',
  );
  const left = h('nav', { class: 'ai-review-left', 'aria-label': 'Bestanden en wijzigingen' });
  const middle = h('div', { class: 'ai-review-hunks' });
  const pages = h('div', { class: 'ai-review-pages' });
  const pageInfo = h('span', { class: 'ai-review-pageinfo' });
  const note = h('p', { class: 'ai-review-note' });
  const tabs = h('div', { class: 'ai-seg', role: 'tablist', 'aria-label': 'Welke versie' });

  const close = () => {
    dialog.remove();
    openDialog = null;
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  const checkbox = (
    state: 'on' | 'off' | 'mixed',
    label: string,
    onclick: () => void,
    disabled = false,
  ) =>
    readOnly
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: `ai-cb is-${state}`,
            role: 'checkbox',
            'aria-checked': state === 'mixed' ? 'mixed' : String(state === 'on'),
            'aria-label': label,
            disabled,
            onclick,
          },
          state === 'on'
            ? icon('check', 12, 3.4)
            : state === 'mixed'
              ? icon('minus', 12, 3.4)
              : null,
        );

  const chosenCount = () => [...chosen].length + images.size;

  function render(): void {
    const n = chosenCount();
    countEl.textContent = readOnly
      ? `${total} ${total === 1 ? 'wijziging' : 'wijzigingen'}`
      : `${n} van ${total} gekozen${conflicts ? ` · ${conflicts} conflict${conflicts === 1 ? '' : 'en'}` : ''}`;
    applyBtn.textContent = n ? `Toepassen (${n})` : 'Toepassen';
    applyBtn.disabled = n === 0;
    renderLeft();
    renderMiddle();
    void renderPreview();
  }

  function renderLeft(): void {
    const items: HTMLElement[] = [
      h('h3', { class: 'ai-review-section' }, readOnly ? 'VOORSTEL' : 'WORDT TOEGEPAST'),
    ];
    for (const f of proposal.files) {
      const fileChoice = f.hunks
        .map((hk, i) => ({ hk, i }))
        .filter(({ i }) => !conflict(f.path, i))
        .map(({ hk }) => chosen.has(key(f.path, hk.id)));
      const state = triState(fileChoice);
      const { plus, minus } = plusMinus(f);
      items.push(
        h(
          'div',
          { class: 'ai-review-file' },
          checkbox(state, `Alle wijzigingen in ${f.path}`, () => {
            f.hunks.forEach((hk, i) => {
              if (conflict(f.path, i)) return;
              if (state === 'on') chosen.delete(key(f.path, hk.id));
              else chosen.add(key(f.path, hk.id));
            });
            render();
          }),
          h('span', { class: 'ai-mono ai-strong' }, f.path),
          h('span', { class: 'ai-plus' }, `+${plus}`),
          h('span', { class: 'ai-minus' }, `−${minus}`),
        ),
      );
      f.hunks.forEach((hk, i) => {
        const c = conflict(f.path, i);
        const on = chosen.has(key(f.path, hk.id));
        items.push(
          h(
            'a',
            {
              class: 'ai-review-link',
              href: `#ai-hunk-${i}`,
              onclick: (e: Event) => {
                e.preventDefault();
                middle.querySelector(`#ai-hunk-${CSS.escape(f.path)}-${hk.id}`)?.scrollIntoView({
                  block: 'start',
                  behavior: 'smooth',
                });
              },
            },
            h('span', { class: `ai-dot is-${c ? 'conflict' : on ? 'chosen' : 'skipped'}` }),
            h('span', { class: 'ai-ellipsis' }, hunkTitle(hk, i)),
            readOnly
              ? null
              : h(
                  'span',
                  { class: 'ai-review-state' },
                  c ? 'conflict' : on ? 'gekozen' : 'overslaan',
                ),
          ),
        );
      });
    }
    for (const img of proposal.images) {
      const on = images.has(img.path);
      items.push(
        h(
          'div',
          { class: 'ai-review-file' },
          checkbox(on ? 'on' : 'off', `Afbeelding ${img.path} toevoegen`, () => {
            if (on) images.delete(img.path);
            else images.add(img.path);
            render();
          }),
          h('span', { class: 'ai-mono ai-ellipsis' }, img.path),
          h(
            'span',
            { class: `ai-pill ${img.new ? 'is-new' : ''}` },
            img.new ? 'nieuw' : 'gewijzigd',
          ),
        ),
      );
    }
    if (proposal.skipped.length)
      items.push(
        h('h3', { class: 'ai-review-section' }, 'NIET TOEGEPAST'),
        h(
          'div',
          { class: 'ai-review-box' },
          ...proposal.skipped.map((s) => h('span', { class: 'ai-mono ai-struck' }, s)),
          h(
            'p',
            {},
            'Alleen opdracht.typ en afbeeldingen worden toegepast. Wijzigingen aan main.typ en lib.typ laat Maatwerk zien, maar voert ze nooit uit.',
          ),
        ),
      );
    const leftOver = remainingDiagnostics(o.check);
    if (o.check)
      items.push(
        h('h3', { class: 'ai-review-section' }, 'NA TOEPASSEN'),
        h(
          'div',
          { class: `ai-review-box${leftOver ? ' is-amber' : ''}` },
          h('span', {}, leftOver ?? 'Geen fouten of waarschuwingen'),
          h(
            'p',
            {},
            'Gecontroleerd door de AI op het volledige voorstel. Maatwerk compileert opnieuw na toepassen.',
          ),
        ),
      );
    left.replaceChildren(...items);
  }

  function renderMiddle(): void {
    const scroll = middle.scrollTop;
    const cards: HTMLElement[] = [];
    for (const f of proposal.files) {
      f.hunks.forEach((hk, i) => {
        const c = conflict(f.path, i);
        const on = chosen.has(key(f.path, hk.id));
        const diff = h('div', { class: 'ai-sbs' });
        for (const row of hunkRows(hk)) {
          const side = (cell: typeof row.left | typeof row.right, which: 'l' | 'r') =>
            h(
              'div',
              { class: `ai-sbs-cell is-${cell ? cell.kind : 'empty'} is-${which}` },
              h('span', { class: 'ai-sbs-n' }, cell ? String(cell.n) : ''),
              h('span', { class: 'ai-sbs-sign' }, cell ? (cell.kind === 'del' ? '−' : '+') : ''),
              h('span', { class: 'ai-sbs-text' }, cell?.text ?? ''),
            );
          diff.append(side(row.left, 'l'), side(row.right, 'r'));
        }
        cards.push(
          h(
            'section',
            {
              class: `ai-hunk${c ? ' is-conflict' : on ? '' : ' is-off'}`,
              id: `ai-hunk-${f.path}-${hk.id}`,
            },
            h(
              'div',
              { class: 'ai-hunk-head' },
              checkbox(
                c ? 'off' : on ? 'on' : 'off',
                `Wijziging ${i + 1} toepassen`,
                () => {
                  if (on) chosen.delete(key(f.path, hk.id));
                  else chosen.add(key(f.path, hk.id));
                  render();
                },
                c,
              ),
              h('strong', {}, `Wijziging ${i + 1}`),
              h('span', { class: 'ai-muted' }, hunkLocation(hk)),
              readOnly
                ? null
                : h(
                    'span',
                    { class: `ai-hunk-state is-${c ? 'conflict' : on ? 'on' : 'off'}` },
                    c
                      ? 'Conflict · wordt overgeslagen'
                      : on
                        ? 'Wordt toegepast'
                        : 'Wordt niet toegepast',
                  ),
            ),
            c
              ? h(
                  'div',
                  { class: 'ai-hunk-conflict' },
                  icon('warn', 15),
                  h(
                    'span',
                    {},
                    'Conflict: je hebt deze regels aangepast terwijl de AI werkte. Deze wijziging wordt overgeslagen; jouw versie blijft staan. Vraag de AI het opnieuw te doen als je zijn versie toch wilt.',
                  ),
                )
              : null,
            diff,
          ),
        );
      });
    }
    for (const img of proposal.images) {
      const thumb = h('img', { class: 'ai-thumb', alt: img.path });
      void o.ai
        .proposalImage(o.provider.key, img.path)
        .then((url) => (thumb.src = url))
        .catch(() => thumb.remove());
      const on = images.has(img.path);
      cards.push(
        h(
          'section',
          { class: `ai-hunk${on ? '' : ' is-off'}` },
          h(
            'div',
            { class: 'ai-hunk-head' },
            h('strong', { class: 'ai-mono' }, img.path),
            h(
              'span',
              { class: 'ai-muted' },
              `${img.new ? 'nieuw bestand' : 'vervangt het bestand'} · ${img.source}`,
            ),
          ),
          h(
            'div',
            { class: 'ai-image-body' },
            thumb,
            h(
              'p',
              { class: 'ai-muted' },
              readOnly
                ? 'Afbeelding uit het voorstel.'
                : on
                  ? 'Wordt toegevoegd aan de afbeeldingen van de opdracht.'
                  : 'Wordt niet toegevoegd; een wijziging die deze afbeelding gebruikt, geeft dan een fout.',
            ),
          ),
        ),
      );
    }
    middle.replaceChildren(...cards);
    middle.scrollTop = scroll;
  }

  /** The opdracht.typ text the preview shows for the tab and the choice. */
  function previewText(): string {
    const f = proposal.files.find((x) => x.path === 'opdracht.typ');
    const current = o.buffers['opdracht.typ'] ?? f?.base ?? '';
    if (tab === 'current' || !f) return current;
    const ids = new Set(f.hunks.filter((hk) => chosen.has(key(f.path, hk.id))).map((hk) => hk.id));
    return applyHunks(current, f.hunks, statuses[f.path] ?? [], ids);
  }

  async function renderPreview(): Promise<void> {
    const seq = ++previewSeq;
    tabs.hidden = readOnly;
    tabs.replaceChildren(
      ...(['proposal', 'current'] as const).map((t) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `ai-seg-btn${tab === t ? ' is-selected' : ''}`,
            'aria-selected': String(tab === t),
            onclick: () => {
              tab = t;
              void renderPreview();
            },
          },
          t === 'proposal' ? 'Voorstel' : 'Huidige versie',
        ),
      ),
    );
    note.textContent = readOnly
      ? 'Zoals de opdracht nu is, met de toegepaste wijzigingen.'
      : tab === 'proposal'
        ? 'Voorbeeld met jouw keuze. Nieuwe afbeeldingen staan er pas na toepassen in.'
        : 'Zoals de opdracht nu is, met jouw eigen aanpassingen.';
    pages.classList.add('is-loading');
    const result = await o.ai
      .preview(previewText())
      .catch((err: Error) => ({ error: err.message }));
    if (seq !== previewSeq) return;
    pages.classList.remove('is-loading');
    for (const img of pages.querySelectorAll('img')) URL.revokeObjectURL(img.src);
    if ('error' in result) {
      pages.replaceChildren(
        h('p', { class: 'ai-review-error' }, `Geen voorbeeld: ${result.error}`),
      );
      pageInfo.textContent = '';
      return;
    }
    pages.replaceChildren(
      ...result.pages.map((svg, i) =>
        h('img', {
          class: 'ai-review-page',
          alt: `Pagina ${i + 1}`,
          src: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })),
        }),
      ),
    );
    pageInfo.textContent = `${result.pages.length} ${result.pages.length === 1 ? 'pagina' : "pagina's"}`;
  }

  applyBtn.addEventListener('click', async () => {
    const hunks: Record<string, number[]> = {};
    for (const f of proposal.files)
      hunks[f.path] = f.hunks.filter((hk) => chosen.has(key(f.path, hk.id))).map((hk) => hk.id);
    if (!apply) return;
    applyBtn.disabled = true;
    await apply(hunks, [...images]);
    close();
  });

  const dialog = h(
    'div',
    { class: 'ai-review-backdrop' },
    h(
      'div',
      {
        class: 'ai-review',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'ai-review-title',
      },
      h(
        'header',
        { class: 'ai-review-head' },
        avatar,
        h(
          'div',
          { class: 'ai-review-titles' },
          h('h2', { id: 'ai-review-title' }, `Voorstel van ${o.provider.name}`),
          h(
            'span',
            {},
            readOnly
              ? 'Toegepast'
              : edited
                ? 'Daarna heb je de opdracht zelf ook aangepast'
                : 'Op de huidige versie van de opdracht',
          ),
        ),
        countEl,
        readOnly
          ? null
          : h(
              'div',
              {
                class: 'ai-seg ai-seg-outline',
                role: 'group',
                'aria-label': 'Alles of niets kiezen',
              },
              h(
                'button',
                {
                  type: 'button',
                  class: 'ai-seg-btn',
                  onclick: () => {
                    for (const f of proposal.files)
                      f.hunks.forEach((hk, i) => {
                        if (!conflict(f.path, i)) chosen.add(key(f.path, hk.id));
                      });
                    proposal.images.forEach((i) => images.add(i.path));
                    render();
                  },
                },
                'Alles',
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'ai-seg-btn',
                  onclick: () => {
                    chosen.clear();
                    images.clear();
                    render();
                  },
                },
                'Niets',
              ),
            ),
        closeBtn,
        readOnly ? null : applyBtn,
      ),
      h(
        'div',
        { class: 'ai-review-body' },
        left,
        h(
          'div',
          { class: 'ai-review-middle' },
          h(
            'div',
            { class: 'ai-review-cols' },
            h('span', {}, 'HUIDIGE VERSIE (NU IN DE EDITOR)'),
            h('span', {}, 'VOORSTEL'),
          ),
          middle,
        ),
        h(
          'aside',
          { class: 'ai-review-preview', 'aria-label': 'PDF-voorbeeld' },
          h('div', { class: 'ai-review-bar' }, tabs, pageInfo),
          pages,
          note,
        ),
      ),
    ),
  );
  document.body.append(dialog);
  document.addEventListener('keydown', onKey, true);
  openDialog = dialog;
  render();
  (readOnly ? closeBtn : applyBtn).focus();
}
