// SPDX-License-Identifier: AGPL-3.0-or-later

// Work spread over idle time (Step 7c): long lists show their first rows at
// once and add the rest when the browser has nothing better to do, so a tab or
// modal paints within budget and input stays responsive.

export interface IdleJob {
  /** Stops the job; slices not yet run are dropped. */
  cancel(): void;
  /** Resolves true when every item ran, false when cancelled. */
  readonly done: Promise<boolean>;
}

type IdleDeadlineLike = { timeRemaining(): number };

function requestIdle(cb: (deadline: IdleDeadlineLike) => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    // The timeout keeps a busy page from postponing the rest indefinitely.
    const id = requestIdleCallback(cb, { timeout: 200 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(() => cb({ timeRemaining: () => 8 }), 1);
  return () => clearTimeout(id);
}

/**
 * Runs `run` on consecutive slices of `items` in idle callbacks, taking
 * `batch` items at a time while the idle period lasts (at least one batch per
 * callback).
 */
export function inIdleSlices<T>(items: T[], run: (slice: T[]) => void, batch = 25): IdleJob {
  let next = 0;
  let cancelIdle: (() => void) | null = null;
  let finish!: (complete: boolean) => void;
  const done = new Promise<boolean>((resolve) => (finish = resolve));

  const step = (deadline: IdleDeadlineLike) => {
    cancelIdle = null;
    do {
      run(items.slice(next, next + batch));
      next += batch;
    } while (next < items.length && deadline.timeRemaining() > 4);
    if (next < items.length) cancelIdle = requestIdle(step);
    else finish(true);
  };

  if (items.length === 0) finish(true);
  else cancelIdle = requestIdle(step);

  return {
    cancel() {
      if (next >= items.length && !cancelIdle) return;
      cancelIdle?.();
      cancelIdle = null;
      next = items.length;
      finish(false);
    },
    done,
  };
}

/** How long background fills may hold the main thread before the browser gets a turn (ms). */
export const SLICE_MS = 8;
let sliceStart = 0;

/**
 * For async loops over cached data (perf hotfix 0.24.1): resolves at once while the current
 * slice lasts, else after a task, so input and paint get a turn. Cached reads resolve as
 * microtasks, so without this a fill over hundreds of students runs as one long task. One budget
 * for every loop running at the same time.
 */
export async function yieldSlice(now: () => number = () => performance.now()): Promise<void> {
  if (now() - sliceStart < SLICE_MS) return;
  await nextTask();
  sliceStart = now();
}

/** Starts a fresh slice (tests: the budget is module state shared by every loop). */
export function resetSlice(): void {
  sliceStart = 0;
}

/**
 * Resolves in a new task, as soon as the browser has had its turn (review 33b m3). Not
 * `setTimeout(0)`: nested timeouts are clamped to >= 4 ms, and timers of a hidden window are
 * throttled. `scheduler.yield()` where it exists (Chromium/WebView2), else a message on a
 * MessageChannel (WebKit), else a timeout.
 */
function nextTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => {
        port1.close();
        resolve();
      };
      port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resolves in the next idle period (for async loops that yield between steps). */
export function nextIdle(): Promise<void> {
  return new Promise((resolve) => requestIdle(() => resolve()));
}
