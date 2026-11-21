// SPDX-License-Identifier: AGPL-3.0-or-later

// The Opdracht preview (design spec 4.17, board 58, PLAN-2 decision 47): a click on a card moves
// the cards into two columns on the left half (left, top and width animate, 350 ms ease-out) and
// slides a panel in on the right half with the rendered pages. The panel stays in view while the
// list scrolls; another card switches it in place; the same card, ✕ or Escape closes it.
//
// Closed, the cards are an ordinary CSS grid. Opening pins every card at its current place
// (absolute), then moves it to its slot; closing moves them back and returns to the grid.
// Rendering is on demand, cached per opdracht until it changes (its `_meta.rev`, or the editor
// closing), with a page-sized placeholder meanwhile.

import { modalOpen } from '../../app.js';
import { Store } from '../../store.js';
import { esc } from '../../components/dialog';
import { skelRegion } from '../../components/skeleton';
import { cardSlots, gridHeight, pageInView } from './preview-layout';
import { opdMetaLine, type OpdFields } from './card';

/** What the panel needs from the screen. */
export interface PreviewHost {
  opdracht(id: string): OpdFields | undefined;
  copy(id: string): void;
  openInEditor(id: string): void;
}

interface Rendered {
  rev: unknown;
  urls?: string[];
  error?: string;
}

const MOVE_MS = 350;
/** Rendered opdrachten kept (their pages as blob URLs), the least recently shown dropped first. */
const CACHE_MAX = 8;
const cache = new Map<string, Rendered>();
const pending = new Map<string, Promise<Rendered>>();
/** Bumped when an opdracht's pages are forgotten: a render started before must not be cached. */
const generation = new Map<string, number>();

let selected: string | null = null;
let host: PreviewHost | null = null;
let resizeObs: ResizeObserver | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function revOf(o: OpdFields | undefined): unknown {
  return (o?._meta as { rev?: unknown } | undefined)?.rev ?? null;
}

function drop(id: string): void {
  cache.get(id)?.urls?.forEach((u) => URL.revokeObjectURL(u));
  cache.delete(id);
}

function forget(id: string): void {
  drop(id);
  pending.delete(id);
  generation.set(id, (generation.get(id) ?? 0) + 1);
}

/**
 * Forget rendered pages (one opdracht, or all). The editor calls it when it closes: it saves
 * `opdracht.typ` without changing the opdracht's `_meta.rev` (review 34 M1).
 */
export function forgetPreviews(id?: string): void {
  if (id) forget(id);
  else new Set([...cache.keys(), ...pending.keys()]).forEach(forget);
  // A preview left open behind the editor shows the new pages.
  if (selected && (!id || id === selected) && panel()) {
    const o = host?.opdracht(selected);
    if (o) show(o);
  }
}

async function render(o: OpdFields): Promise<Rendered> {
  const rev = revOf(o);
  const hit = cache.get(o.id);
  if (hit && hit.rev === rev) {
    cache.delete(o.id); // most recently shown last
    cache.set(o.id, hit);
    return hit;
  }
  const running = pending.get(o.id);
  if (running) return running;
  const gen = generation.get(o.id) ?? 0;
  const job = (async (): Promise<Rendered> => {
    let out: Rendered;
    try {
      const r = await window.maatwerk.renderAssignmentSvg(o.id, o.naam ?? '');
      out = r.success
        ? {
            rev,
            urls: r.pages.map((svg) =>
              URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })),
            ),
          }
        : { rev, error: r.error };
    } catch (e) {
      out = { rev, error: (e as Error).message ?? String(e) };
    }
    // Forgotten while rendering (the editor saved): show it this once, keep nothing.
    if ((generation.get(o.id) ?? 0) !== gen) return out;
    drop(o.id);
    cache.set(o.id, out);
    while (cache.size > CACHE_MAX) drop(cache.keys().next().value!);
    return out;
  })();
  pending.set(o.id, job);
  try {
    return await job;
  } finally {
    if (pending.get(o.id) === job) pending.delete(o.id);
  }
}

function view(): HTMLElement | null {
  return document.getElementById('opdracht-list');
}

function grid(): HTMLElement | null {
  return view()?.querySelector<HTMLElement>('.igrid') ?? null;
}

function cards(): HTMLElement[] {
  return [...(grid()?.querySelectorAll<HTMLElement>('[data-opd-card]') ?? [])];
}

/** The panel sits under the sticky screen head and fills the window below it. */
function fitPanel(): void {
  const v = view();
  const head = document.querySelector<HTMLElement>('#screen-opdrachten .screen-head');
  if (!v) return;
  const top = (head?.getBoundingClientRect().bottom ?? 120) + 16;
  v.style.setProperty('--opd-sticky-top', `${Math.round(top)}px`);
  v.style.setProperty(
    '--opd-preview-h',
    `${Math.max(360, Math.round(window.innerHeight - top - 16))}px`,
  );
}

/** Puts every card in its slot (open: two columns; closed: three, as the grid). */
function place(open: boolean): void {
  const g = grid();
  if (!g) return;
  const list = cards();
  const slots = cardSlots(list.length, g.clientWidth, open);
  if (open) fitPanel();
  g.style.height = `${gridHeight(list.length, open)}px`;
  list.forEach((c, i) => {
    const s = slots[i]!;
    c.style.left = `${s.x}px`;
    c.style.top = `${s.y}px`;
    c.style.width = `${s.w}px`;
  });
}

/** Pins the cards where the grid has them now, so the move to the slots can animate. */
function pin(): void {
  const g = grid();
  if (!g || g.classList.contains('igrid--placed')) return;
  const base = g.getBoundingClientRect();
  const rects = cards().map((c) => c.getBoundingClientRect());
  g.style.height = `${base.height}px`;
  g.classList.add('igrid--placed');
  cards().forEach((c, i) => {
    const r = rects[i]!;
    c.style.left = `${r.left - base.left}px`;
    c.style.top = `${r.top - base.top}px`;
    c.style.width = `${r.width}px`;
  });
  void g.offsetHeight; // the start positions must be laid out before the move
}

function unpin(): void {
  const g = grid();
  if (!g) return;
  g.classList.remove('igrid--placed');
  g.style.height = '';
  cards().forEach((c) => {
    c.style.left = '';
    c.style.top = '';
    c.style.width = '';
  });
}

function panel(): HTMLElement | null {
  return view()?.querySelector<HTMLElement>('.opd-preview') ?? null;
}

function pagesLabel(n: number | null): string {
  if (n === null) return '';
  return ` · ${n} ${n === 1 ? 'pagina' : "pagina's"}`;
}

function headMeta(o: OpdFields, n: number | null): string {
  const jls = (o.jaarlagen ?? []).map(Number).sort((a, b) => a - b);
  return [opdMetaLine(o), jls.length ? `jaarlagen ${jls.join(', ')}` : '']
    .filter(Boolean)
    .join(' · ')
    .concat(pagesLabel(n));
}

function panelHtml(o: OpdFields): string {
  return `
    <div class="opd-preview-panel" role="region" aria-label="Voorbeeld van de opdracht">
      <div class="opd-preview-head">
        <div class="opd-preview-titles">
          <span class="opd-preview-name">${esc(o.naam ?? '')}</span>
          <span class="opd-preview-meta">${esc(headMeta(o, null))}</span>
        </div>
        <button type="button" class="btn btn--secondary" data-preview="copy">${Store.isGast() ? 'Kopieer naar…' : 'Kopiëren'}</button>
        <button type="button" class="btn btn--primary" data-preview="editor" data-write>Openen in editor</button>
        <button type="button" class="btn btn--icon opd-preview-close" data-preview="close" title="Voorbeeld sluiten" aria-label="Voorbeeld sluiten"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="opd-preview-body">${skelRegion('<span class="skel opd-page opd-page--skel"></span>', 'Voorbeeld laden…')}</div>
      <div class="opd-preview-foot"><span class="opd-preview-page"></span><span class="icard-spacer"></span><span>PDF · gegenereerd uit de opdracht (Typst)</span></div>
    </div>`;
}

function updatePageLabel(p: HTMLElement): void {
  const body = p.querySelector<HTMLElement>('.opd-preview-body')!;
  const pages = [...body.querySelectorAll<HTMLElement>('.opd-page')];
  const label = p.querySelector<HTMLElement>('.opd-preview-page')!;
  if (!pages.length || pages[0]!.classList.contains('opd-page--skel')) {
    label.textContent = '';
    return;
  }
  const i = pageInView(
    pages.map((pg) => pg.offsetTop - body.offsetTop),
    body.scrollTop,
    body.clientHeight,
  );
  label.textContent = `Pagina ${i + 1} van ${pages.length}`;
}

async function fill(o: OpdFields): Promise<void> {
  const out = await render(o);
  const p = panel();
  if (!p || selected !== o.id || p.dataset.for !== o.id) return; // switched or closed meanwhile
  const body = p.querySelector<HTMLElement>('.opd-preview-body')!;
  if (out.error) {
    body.innerHTML = `<div class="opd-preview-error" role="alert"><strong>Het voorbeeld kon niet worden gemaakt.</strong><pre>${esc(out.error)}</pre></div>`;
    return;
  }
  const urls = out.urls ?? [];
  body.innerHTML = urls
    .map(
      (u, i) =>
        `<img class="opd-page" src="${esc(u)}" alt="${esc(`Pagina ${i + 1} van ${urls.length}`)}">`,
    )
    .join('');
  p.querySelector('.opd-preview-meta')!.textContent = headMeta(o, urls.length);
  body.scrollTop = 0;
  updatePageLabel(p);
}

/** Shows the opdracht in the panel (a new panel, or switched in place). */
function show(o: OpdFields): void {
  const v = view()!;
  let p = panel();
  if (!p) {
    p = document.createElement('aside');
    p.className = 'opd-preview';
    p.id = 'opd-preview';
    v.append(p);
    wirePanel(p);
  }
  p.dataset.for = o.id;
  p.innerHTML = panelHtml(o);
  p.querySelector('.opd-preview-body')!.addEventListener('scroll', () => updatePageLabel(p), {
    passive: true,
  });
  void fill(o);
}

function wirePanel(p: HTMLElement): void {
  p.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLElement>('[data-preview]');
    const id = p.dataset.for;
    if (!btn || !id) return;
    if (btn.dataset.preview === 'close') {
      closePreview();
      focusTitle(id);
    } else if (btn.dataset.preview === 'copy') host?.copy(id);
    else if (btn.dataset.preview === 'editor') host?.openInEditor(id);
  });
}

function markSelected(): void {
  cards().forEach((c) => {
    const on = c.dataset.opdCard === selected;
    c.classList.toggle('icard--selected', on);
    c.querySelector('.icard-title')?.setAttribute('aria-expanded', String(on));
  });
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !selected || e.defaultPrevented) return;
  // A dialog or a menu on top handles its own Escape (the ⋮ menu closes in the capture phase and
  // marks the event); another screen does not see the preview.
  if (modalOpen() || document.querySelector('.exam-menu')) return;
  if (!document.getElementById('screen-opdrachten')?.classList.contains('active')) return;
  e.preventDefault();
  const id = selected;
  closePreview();
  focusTitle(id);
}

/** Gives the card's title the focus back (after ✕ or Escape). */
function focusTitle(id: string): void {
  cards()
    .find((c) => c.dataset.opdCard === id)
    ?.querySelector<HTMLElement>('.icard-title')
    ?.focus({ preventScroll: true });
}

/** Stops following keys and size while the preview is closed. */
function detach(): void {
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', fitPanel);
  resizeObs?.disconnect();
}

/** Opens the preview of `id`, switches to it, or (the same card again) closes it. */
export function togglePreview(id: string, h: PreviewHost): void {
  host = h;
  if (selected === id) {
    closePreview();
    return;
  }
  const o = h.opdracht(id);
  const v = view();
  if (!o || !v) return;
  clearTimeout(closeTimer);
  const wasOpen = selected !== null;
  selected = id;
  if (!wasOpen) {
    pin();
    show(o); // the panel is in place, hidden, before the class slides it in
    void v.offsetHeight;
    v.classList.add('opd-view--open');
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fitPanel);
    resizeObs ??= new ResizeObserver(() => {
      if (selected) place(true);
    });
    resizeObs.observe(v);
  }
  place(true);
  markSelected();
  if (wasOpen) show(o);
}

export function closePreview(): void {
  if (!selected) return;
  selected = null;
  detach();
  const v = view();
  if (!v) return;
  markSelected();
  v.classList.remove('opd-view--open');
  place(false);
  const done = () => {
    if (selected) return; // reopened meanwhile
    panel()?.remove();
    unpin();
  };
  clearTimeout(closeTimer);
  if (reducedMotion()) done();
  else closeTimer = setTimeout(done, MOVE_MS);
}

/**
 * After the list was drawn again (a filter, a save, a copy): keep the preview on its opdracht if
 * it is still listed, without animating; otherwise close it.
 */
export function restorePreview(h: PreviewHost): void {
  host = h;
  if (!selected) return;
  const v = view();
  const still = cards().some((c) => c.dataset.opdCard === selected);
  const o = h.opdracht(selected);
  if (!v || !still || !o) {
    const p = panel();
    selected = null;
    detach();
    v?.classList.remove('opd-view--open');
    p?.remove();
    return;
  }
  const g = grid()!;
  g.classList.add('igrid--placed', 'igrid--instant');
  place(true);
  void g.offsetHeight;
  g.classList.remove('igrid--instant');
  markSelected();
  if (!panel()) show(o);
  else if (cache.get(o.id)?.rev !== revOf(o)) show(o);
}

/** The id whose preview is open, or null. */
export function previewOpen(): string | null {
  return selected;
}
