// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { inIdleSlices } from './idle';

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
