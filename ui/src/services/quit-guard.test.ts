// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { beforeQuit, installQuitGuard, runBeforeQuit } from './quit-guard';

describe('quit guard (step 37, review 23 m4)', () => {
  it('runs every registered task before the window closes, a failing one included', async () => {
    const ran: string[] = [];
    const offA = beforeQuit(async () => void ran.push('a'));
    const offB = beforeQuit(async () => {
      ran.push('b');
      throw new Error('disk full');
    });
    let close: (() => Promise<void>) | null = null;
    installQuitGuard({
      onCloseRequested: (cb) => {
        close = cb;
        return () => {};
      },
    });
    await close!();
    expect(ran.sort()).toEqual(['a', 'b']);
    offA();
    offB();
  });

  it('never keeps the window open longer than the wait', async () => {
    const off = beforeQuit(() => new Promise(() => {}));
    const t = Date.now();
    await runBeforeQuit(30);
    expect(Date.now() - t).toBeLessThan(1000);
    off();
  });

  it('a removed task does not run', async () => {
    let ran = false;
    beforeQuit(async () => {
      ran = true;
    })();
    await runBeforeQuit(30);
    expect(ran).toBe(false);
  });
});
