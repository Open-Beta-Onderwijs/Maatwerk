// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Review 38 M1: card HTML built from an older generation's numbers must not be cached as valid
// for a newer generation.
const state = vi.hoisted(() => ({ generation: 1, calls: 0, release: [] as (() => void)[] }));

vi.mock('../../store.js', () => ({
  Store: {
    generation: () => state.generation,
    getActiveSubject: () => 'nat',
    loadYear: async () => {},
    getExamsSync: () => [],
  },
}));
vi.mock('../../services/vak-numbers', () => ({
  vakNumbers: () => {
    state.calls++;
    return new Promise((resolve) =>
      state.release.push(() => resolve({ students: {}, formats: {} })),
    );
  },
}));
vi.mock('../../domain/cards', () => ({ studentCard: () => ({}) }));
vi.mock('./card-html', () => ({ studentGradesHtml: () => `<b>gen ${state.generation}</b>` }));
vi.mock('./swap-clock', () => ({ startSwapClock: () => {} }));
vi.mock('../../utils/idle', () => ({ yieldSlice: async () => {} }));
vi.mock('../../legacy/style-data', () => ({ applyStyleData: () => {} }));
vi.stubGlobal('CSS', { escape: (s: string) => s });

const { fillStudentGrades } = await import('./student-grades');

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A container with one card slot; `text` is what the fill wrote. */
function box() {
  const slot = { innerHTML: '' };
  const container = { querySelector: () => slot } as unknown as HTMLElement;
  return { container, text: () => slot.innerHTML };
}

describe('fillStudentGrades cache', () => {
  beforeEach(() => {
    state.calls = 0;
    state.release = [];
  });

  it('asks again when the generation moved during the fill', async () => {
    state.generation = 10;
    const b = box();
    fillStudentGrades(b.container, [{ id: 's1' }], '2025-2026');
    await flush();
    expect(state.calls).toBe(1);
    state.generation = 11; // a colleague's change lands while the numbers are on their way
    state.release.shift()!();
    await flush();

    fillStudentGrades(b.container, [{ id: 's1' }], '2025-2026');
    await flush();
    expect(state.calls).toBe(2);
  });

  it('reuses the numbers while the generation stays', async () => {
    state.generation = 20;
    const b = box();
    fillStudentGrades(b.container, [{ id: 's1' }], '2025-2026');
    await flush();
    state.release.shift()!();
    await flush();
    expect(b.text()).toBe('<b>gen 20</b>');

    fillStudentGrades(b.container, [{ id: 's1' }], '2025-2026');
    await flush();
    expect(state.calls).toBe(1);
  });
});
