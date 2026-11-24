// SPDX-License-Identifier: AGPL-3.0-or-later

// Saving before the app closes (step 37, review 23 m4): open work registers a task with
// `beforeQuit` (Projectgroep beoordelen's save, the score grid's queued saves); when the teacher
// closes the window, the tasks run behind "Gegevens opslaan, dan afsluiten…" and the window closes
// when they are done, or after `QUIT_WAIT_MS` so a stuck save never keeps the app open unasked.
// A task that fails (throws, resolves `false`, or is still running at the wait) keeps the window
// open until the teacher confirms closing without it (review 37 M1).

import type { MaatwerkApi } from '../bridge/api';
import { showBusy } from '../components/busy-overlay';
import { confirmDialog } from '../components/dialog';

export const QUIT_WAIT_MS = 8000;
export const QUIT_TEXT = 'Gegevens opslaan, dan afsluiten…';
export const QUIT_UNSAVED_TEXT =
  'Niet alles is opgeslagen. Sluit je de app nu, dan gaan de laatste wijzigingen verloren.';

/** A task resolves `false` (or throws) when its save did not succeed. */
export type QuitTask = () => Promise<unknown>;

const tasks = new Set<QuitTask>();

/** Runs `task` before the app closes, until the returned function removes it. */
export function beforeQuit(task: QuitTask): () => void {
  tasks.add(task);
  return () => {
    tasks.delete(task);
  };
}

/**
 * Runs every task and waits at most `waitMs`. Resolves true when every task succeeded in time,
 * false when one failed (logged, not thrown) or was still running.
 */
export async function runBeforeQuit(waitMs = QUIT_WAIT_MS): Promise<boolean> {
  if (!tasks.size) return true;
  const hide = showBusy(QUIT_TEXT);
  try {
    const all = Promise.all(
      [...tasks].map((t) =>
        Promise.resolve()
          .then(t)
          .then((r) => r !== false)
          .catch((e: unknown) => {
            console.warn('[quit] save', e);
            return false;
          }),
      ),
    ).then((oks) => oks.every(Boolean));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), waitMs);
    });
    const ok = await Promise.race([all, late]);
    clearTimeout(timer);
    return ok;
  } finally {
    hide();
  }
}

/** Asks the teacher whether to close although not everything was saved. */
export type AskQuit = () => Promise<boolean>;

const askQuit: AskQuit = () =>
  confirmDialog(QUIT_UNSAVED_TEXT, {
    title: 'Toch afsluiten?',
    okLabel: 'Toch afsluiten',
    cancelLabel: 'Terug naar de app',
    danger: true,
  });

/**
 * Called once at start-up: the window closes only after the tasks; when one failed, only after
 * the teacher confirms (resolving false keeps the window open).
 */
export function installQuitGuard(
  api: Pick<MaatwerkApi, 'onCloseRequested'>,
  ask: AskQuit = askQuit,
  waitMs = QUIT_WAIT_MS,
): void {
  api.onCloseRequested(async () => (await runBeforeQuit(waitMs)) || ask());
}
