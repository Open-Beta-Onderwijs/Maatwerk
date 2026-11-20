// SPDX-License-Identifier: AGPL-3.0-or-later

// The "laatste / SE" swap of the student cards (spec 4.3) runs on one clock for every card: an
// attribute on <html> flips every 4,5 s and CSS cross-fades (perf hotfix 0.24.1: syncing a CSS
// animation per card took seconds on a full Leerlingen list).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWAP_HALF_MS, startSwapClock, stopSwapClock } from './swap-clock';

const root = { dataset: {} as Record<string, string> };

beforeEach(() => {
  vi.useFakeTimers();
  root.dataset = {};
  vi.stubGlobal('document', { documentElement: root, hidden: false });
});
afterEach(() => {
  stopSwapClock();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the swap clock', () => {
  it('shows "laatste" first, then flips every half cycle', () => {
    startSwapClock();
    expect(root.dataset.cardSwap).toBe('a');
    vi.advanceTimersByTime(SWAP_HALF_MS);
    expect(root.dataset.cardSwap).toBe('b');
    vi.advanceTimersByTime(SWAP_HALF_MS);
    expect(root.dataset.cardSwap).toBe('a');
  });

  it('is one clock, however often it is started', () => {
    startSwapClock();
    startSwapClock();
    vi.advanceTimersByTime(SWAP_HALF_MS);
    expect(root.dataset.cardSwap).toBe('b');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('rests while the window is hidden', () => {
    startSwapClock();
    (document as unknown as { hidden: boolean }).hidden = true;
    vi.advanceTimersByTime(SWAP_HALF_MS);
    expect(root.dataset.cardSwap).toBe('a');
  });

  it('is half of the 9 s cycle', () => {
    expect(SWAP_HALF_MS).toBe(4500);
  });
});
