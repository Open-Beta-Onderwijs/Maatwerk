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
