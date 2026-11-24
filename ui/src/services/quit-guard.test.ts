// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { beforeQuit, installQuitGuard, runBeforeQuit } from './quit-guard';

/** Installs the guard with a fixed answer; returns the close handler and the asked count. */
function install(answer: boolean, waitMs = 1000) {
  let close: (() => Promise<boolean>) | null = null;
  const asked = { n: 0 };
  installQuitGuard(
    {
      onCloseRequested: (cb) => {
        close = cb;
        return () => {};
      },
    },
    async () => {
      asked.n++;
      return answer;
    },
    waitMs,
  );
  return { close: () => close!(), asked };
}

describe('quit guard (step 37, review 23 m4)', () => {
  it('runs every registered task before the window closes, a failing one included', async () => {
    const ran: string[] = [];
    const offA = beforeQuit(async () => void ran.push('a'));
    const offB = beforeQuit(async () => {
      ran.push('b');
      throw new Error('disk full');
    });
    const { close } = install(true);
    expect(await close()).toBe(true);
    expect(ran.sort()).toEqual(['a', 'b']);
    offA();
    offB();
  });

  it('closes without asking when every task succeeds', async () => {
    const off = beforeQuit(async () => true);
    const { close, asked } = install(false);
    expect(await close()).toBe(true);
    expect(asked.n).toBe(0);
    off();
  });

  it('a task that resolves false asks; "Terug" keeps the window open (review 37 M1)', async () => {
    const off = beforeQuit(async () => false);
    const { close, asked } = install(false);
    expect(await close()).toBe(false);
    expect(asked.n).toBe(1);
    off();
  });

  it('a task that throws asks too; "Toch afsluiten" closes', async () => {
    const off = beforeQuit(async () => {
      throw new Error('conflict');
    });
    const { close, asked } = install(true);
    expect(await close()).toBe(true);
    expect(asked.n).toBe(1);
    off();
  });

  it('never keeps the window open longer than the wait; a late task counts as failed', async () => {
    const off = beforeQuit(() => new Promise(() => {}));
    const t = Date.now();
    expect(await runBeforeQuit(30)).toBe(false);
    expect(Date.now() - t).toBeLessThan(1000);
    off();
  });

  it('a removed task does not run', async () => {
    let ran = false;
    beforeQuit(async () => {
      ran = true;
    })();
    expect(await runBeforeQuit(30)).toBe(true);
    expect(ran).toBe(false);
  });
});
