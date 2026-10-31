// SPDX-License-Identifier: AGPL-3.0-or-later

// Timing marks for perceived speed (Step 7c, docs/perf.md). Every span becomes a
// `performance.measure` named `mw:<name>`, so the DevTools Performance panel and
// tools/perf read them without extra plumbing. Cheap enough to stay on in release
// builds: one mark per span, no logging.

const PREFIX = 'mw:';

/** Starts a span; the returned function ends it (later calls do nothing). */
export function perfSpan(name: string): () => void {
  const start = performance.now();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    performance.measure(PREFIX + name, { start, end: performance.now() });
  };
}

/** Times `fn` (sync or async) as one span. */
export function timed<T>(name: string, fn: () => T): T {
  const end = perfSpan(name);
  let result: T;
  try {
    result = fn();
  } catch (e) {
    end();
    throw e;
  }
  if (result instanceof Promise) {
    return result.finally(end) as T;
  }
  end();
  return result;
}

// Typed here: the Store (and so this file) is also checked without the DOM lib.
const host = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
const nextFrame = (cb: () => void) =>
  host.requestAnimationFrame ? host.requestAnimationFrame(cb) : setTimeout(cb, 16);

/** Resolves after the browser has painted the current DOM (next frame, then a task). */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => nextFrame(() => setTimeout(resolve, 0)));
}
