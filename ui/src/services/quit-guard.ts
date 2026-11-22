// SPDX-License-Identifier: AGPL-3.0-or-later

// Saving before the app closes (step 37, review 23 m4): open work registers a task with
// `beforeQuit` (Projectgroep beoordelen's save, the score grid's queued saves); when the teacher
// closes the window, the tasks run behind "Gegevens opslaan, dan afsluiten…" and the window closes
// when they are done, or after `QUIT_WAIT_MS` so a stuck save never keeps the app open.

import type { MaatwerkApi } from '../bridge/api';
import { showBusy } from '../components/busy-overlay';

export const QUIT_WAIT_MS = 8000;
export const QUIT_TEXT = 'Gegevens opslaan, dan afsluiten…';

const tasks = new Set<() => Promise<unknown>>();

/** Runs `task` before the app closes, until the returned function removes it. */
export function beforeQuit(task: () => Promise<unknown>): () => void {
  tasks.add(task);
  return () => {
    tasks.delete(task);
  };
}

/** Runs every task (failures are logged, not thrown) and waits at most `waitMs`. */
export async function runBeforeQuit(waitMs = QUIT_WAIT_MS): Promise<void> {
  if (!tasks.size) return;
  const hide = showBusy(QUIT_TEXT);
  try {
    const all = Promise.allSettled(
      [...tasks].map((t) =>
        Promise.resolve()
          .then(t)
          .catch((e: unknown) => console.warn('[quit] save', e)),
      ),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    });
    await Promise.race([all, late]);
    clearTimeout(timer);
  } finally {
    hide();
  }
}

/** Called once at start-up: the window closes only after the tasks. */
export function installQuitGuard(api: Pick<MaatwerkApi, 'onCloseRequested'>): void {
  api.onCloseRequested(() => runBeforeQuit());
}
