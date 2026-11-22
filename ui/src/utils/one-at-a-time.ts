// SPDX-License-Identifier: AGPL-3.0-or-later

// One run of an async task at a time (step 37, review 23 n1). A call while a run is busy waits
// for it and then runs the task itself; it waits in a loop, so two calls that both waited never
// start side by side. The task decides whether there is still work (a save that finds nothing
// changed returns at once).

export interface OneAtATime<T> {
  (): Promise<T>;
  /** True while a run is busy. */
  busy(): boolean;
}

export function oneAtATime<T>(task: () => Promise<T>): OneAtATime<T> {
  let running: Promise<T> | null = null;
  const call = async (): Promise<T> => {
    while (running) await running.catch(() => undefined);
    const run = task();
    running = run;
    try {
      return await run;
    } finally {
      if (running === run) running = null;
    }
  };
  return Object.assign(call, { busy: () => running !== null });
}
