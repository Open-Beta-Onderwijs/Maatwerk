// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { oneAtATime } from './one-at-a-time';

describe('oneAtATime (review 23 n1)', () => {
  it('two calls that wait on a busy run start one after the other, never side by side', async () => {
    let active = 0;
    let most = 0;
    let dirty = true;
    let writes = 0;
    const save = oneAtATime(async () => {
      active++;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 5));
      if (dirty) {
        writes++;
        dirty = false;
      }
      active--;
      return true;
    });
    const first = save();
    expect(save.busy()).toBe(true);
    // Both wait on the first run; the old code let them both start right after it.
    dirty = true;
    await Promise.all([first, save(), save()]);
    expect(most).toBe(1);
    expect(writes).toBe(1);
    expect(save.busy()).toBe(false);
  });

  it('a failed run lets the next one go', async () => {
    let n = 0;
    const run = oneAtATime(async () => {
      n++;
      if (n === 1) throw new Error('nope');
      return n;
    });
    await expect(run()).rejects.toThrow('nope');
    await expect(run()).resolves.toBe(2);
  });
});
