// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SLICE_MS, inIdleSlices, resetSlice, yieldSlice } from './idle';

describe('inIdleSlices', () => {
  it('runs every item once, in order, in slices', async () => {
    const seen: number[] = [];
    const slices: number[] = [];
    const job = inIdleSlices(
      Array.from({ length: 23 }, (_, i) => i),
      (s) => {
        slices.push(s.length);
        seen.push(...s);
      },
      5,
    );
    expect(seen).toEqual([]); // nothing runs synchronously
    await expect(job.done).resolves.toBe(true);
    expect(seen).toEqual(Array.from({ length: 23 }, (_, i) => i));
    expect(slices.every((n) => n <= 5)).toBe(true);
  });

  it('stops when cancelled', async () => {
    const seen: number[] = [];
    const job = inIdleSlices([1, 2, 3], (s) => seen.push(...s), 1);
    job.cancel();
    await expect(job.done).resolves.toBe(false);
    expect(seen).toEqual([]);
  });

  it('is done at once for no items', async () => {
    await expect(inIdleSlices([], () => {}).done).resolves.toBe(true);
  });
});

describe('yieldSlice', () => {
  beforeEach(() => resetSlice());

  /** Whether `p` settles within a run of microtasks (no task boundary). */
  async function settlesInMicrotasks(p: Promise<void>): Promise<boolean> {
    let done = false;
    void p.then(() => (done = true));
    for (let i = 0; i < 50; i++) await Promise.resolve();
    return done;
  }

  it('goes on at once within the slice', async () => {
    let t = 1_000;
    const now = () => t;
    await yieldSlice(now); // opens a slice
    t += SLICE_MS - 1;
    expect(await settlesInMicrotasks(yieldSlice(now))).toBe(true);
  });

  it('gives the browser a task turn once the slice is used up', async () => {
    let t = 1_000;
    const now = () => t;
    await yieldSlice(now);
    t += SLICE_MS + 1;
    const turn = yieldSlice(now);
    expect(await settlesInMicrotasks(turn)).toBe(false);
    await turn; // a task later
  });

  it('does not wait for a timer (no 4 ms clamp of nested timeouts, review 33b m3)', async () => {
    let t = 1_000;
    const now = () => t;
    await yieldSlice(now);
    // No ordering race against a real setTimeout(0): Node does not order a MessagePort task
    // against a due 1 ms timer, so that version failed on a loaded Linux runner (CI run
    // 45007769015). Instead: the yield must not schedule a timer at all.
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      t += SLICE_MS + 1;
      await yieldSlice(now);
      expect(timers).not.toHaveBeenCalled();
    } finally {
      timers.mockRestore();
    }
  });
});
