// SPDX-License-Identifier: AGPL-3.0-or-later

// Opening and closing a stack (design spec 4.7, PLAN-2 decisions 43-44): the attempts slide down
// from under the Verzamelkaart while the tray grows (400 ms), 200 ms later they spread (380 ms);
// closing gathers them first and slides them up after 220 ms. Cards left, right and above never
// move. One stack per row is open at a time (opening another closes it). Open or closed is
// remembered for the session; with prefers-reduced-motion the states switch at once.

import {
  cardPlace,
  outline,
  titleX,
  trayHeight,
  type GridGeometry,
  type StackPhase,
} from './stack-layout';

/** Stacks the teacher opened; for this session only (closed by default, decision 43). */
const openStacks = new Set<string>();

const OPEN_SPREAD_MS = 200;
const CLOSE_SLIDE_MS = 220;

const phases = new Map<string, StackPhase>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function phaseOf(id: string): StackPhase {
  return phases.get(id) ?? 0;
}

function geometry(grid: HTMLElement, cell: HTMLElement): GridGeometry | null {
  const card = cell.querySelector<HTMLElement>('.tcard');
  const width = cell.getBoundingClientRect().width;
  if (!card || width === 0) return null; // not laid out (screen hidden)
  const cs = getComputedStyle(grid);
  return {
    cols: Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length),
    cardW: width,
    cardH: card.offsetHeight,
    colGap: parseFloat(cs.columnGap) || 0,
    rowGap: parseFloat(cs.rowGap) || 0,
  };
}

/** Puts the tray of a row and its cards where the phases of its stacks say. */
function layoutTray(tray: HTMLElement): void {
  const grid = tray.parentElement;
  if (!grid) return;
  const ids = (tray.dataset.stacks ?? '').split(' ').filter(Boolean);
  const cellOf = (id: string) =>
    grid.querySelector<HTMLElement>(`.tgrid-cell--stack[data-stack="${CSS.escape(id)}"]`);
  const firstCell = cellOf(ids[0] ?? '');
  const g = firstCell && geometry(grid, firstCell);
  if (!g) return;
  const openId = ids.find((id) => phaseOf(id) > 0) ?? null;
  const trayOpen = openId !== null;

  for (const id of ids) {
    const cell = cellOf(id);
    if (!cell) continue;
    const col = Number(cell.dataset.col ?? 0);
    const n = Number(cell.dataset.n ?? 2);
    const phase = phaseOf(id);
    cell.classList.toggle('tgrid-cell--open', phase > 0);
    const toggle = cell.querySelector<HTMLElement>('.tstack-toggle');
    if (toggle) {
      const open = openStacks.has(id);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Inklappen ▴' : `${n} pogingen ▾`;
    }
    tray
      .querySelectorAll<HTMLElement>(`.ttray-card[data-stack-of="${CSS.escape(id)}"]`)
      .forEach((el) => {
        const k = Number(el.dataset.k ?? 0);
        const p = cardPlace(g, col, n, k, phase, trayOpen);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        el.style.width = `${g.cardW}px`;
        el.style.opacity = String(p.opacity);
        el.style.zIndex = String(10 - k);
        const usable = phase === 2;
        el.toggleAttribute('inert', !usable);
        el.classList.toggle('ttray-card--usable', usable);
      });
  }

  const svg = tray.querySelector<SVGSVGElement>('.ttray-outline');
  const title = tray.querySelector<HTMLElement>('.ttray-title');
  if (openId) {
    const cell = cellOf(openId)!;
    const col = Number(cell.dataset.col ?? 0);
    const n = Number(cell.dataset.n ?? 2);
    const h = trayHeight(g, n);
    tray.style.height = `${h}px`;
    tray.style.marginTop = '0px';
    tray.classList.add('ttray--open');
    const o = outline(g, col, n);
    if (svg) {
      svg.querySelector('path')?.setAttribute('d', o.d);
      svg.style.top = `${-o.top}px`;
      svg.setAttribute('height', String(o.height));
      svg.setAttribute('width', String(Math.ceil(grid.getBoundingClientRect().width + 16)));
      svg.style.clipPath = 'inset(0 0 0 0)';
    }
    if (title) {
      const code =
        cell.querySelector('.tcard .test-badge:not(.test-badge--sub)')?.textContent ?? '';
      title.textContent = `Pogingen van ${code} · de beste poging per leerling telt`;
      title.style.left = `${titleX(g, col, n)}px`;
    }
    tray.dataset.lastHeight = String(h);
  } else {
    tray.style.height = '0px';
    tray.style.marginTop = `${-g.rowGap}px`;
    tray.classList.remove('ttray--open');
    // The outline keeps its last shape and is wiped away from the bottom while it fades.
    const last = Number(tray.dataset.lastHeight ?? 0);
    if (svg) svg.style.clipPath = `inset(0 0 ${last + g.rowGap}px 0)`;
  }
}

function trayOf(container: HTMLElement, id: string): HTMLElement | null {
  for (const tray of container.querySelectorAll<HTMLElement>('.ttray')) {
    if ((tray.dataset.stacks ?? '').split(' ').includes(id)) return tray;
  }
  return null;
}

function setPhase(container: HTMLElement, id: string, phase: StackPhase): void {
  phases.set(id, phase);
  const tray = trayOf(container, id);
  if (tray) layoutTray(tray);
}

function later(id: string, ms: number, run: () => void): void {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      run();
    }, ms),
  );
}

/** Opens or closes the stack of `id` (the toggle pill). */
export function toggleStack(container: HTMLElement, id: string): void {
  const tray = trayOf(container, id);
  if (!tray) return;
  const instant = reducedMotion();
  if (openStacks.has(id)) {
    openStacks.delete(id);
    if (instant) return setPhase(container, id, 0);
    setPhase(container, id, 1);
    later(id, CLOSE_SLIDE_MS, () => setPhase(container, id, 0));
    return;
  }
  // One open stack per row: another one in this row closes at once.
  for (const other of (tray.dataset.stacks ?? '').split(' ')) {
    if (other && other !== id && openStacks.has(other)) {
      openStacks.delete(other);
      clearTimeout(timers.get(other));
      phases.set(other, 0);
    }
  }
  openStacks.add(id);
  if (instant) return setPhase(container, id, 2);
  setPhase(container, id, 1);
  later(id, OPEN_SPREAD_MS, () => setPhase(container, id, 2));
}

let observer: ResizeObserver | null = null;

/**
 * Lays out the trays of a freshly drawn list, without animation: open stacks are spread, the
 * rest closed. Follows the grid's width from then on (the outline is recomputed on resize).
 */
export function initStacks(container: HTMLElement): void {
  for (const id of [...timers.keys()]) clearTimeout(timers.get(id));
  timers.clear();
  phases.clear();
  for (const id of openStacks) phases.set(id, 2);
  const relayout = () => {
    container.classList.add('tgrid-static');
    container.querySelectorAll<HTMLElement>('.ttray').forEach(layoutTray);
    void container.offsetHeight; // apply the static positions before transitions return
    requestAnimationFrame(() => container.classList.remove('tgrid-static'));
  };
  relayout();
  observer?.disconnect();
  if (typeof ResizeObserver === 'undefined') return;
  let lastWidth = container.getBoundingClientRect().width;
  observer = new ResizeObserver(() => {
    const w = container.getBoundingClientRect().width;
    if (w === lastWidth) return;
    lastWidth = w;
    relayout();
  });
  observer.observe(container);
}
