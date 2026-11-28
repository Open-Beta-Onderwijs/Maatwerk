// SPDX-License-Identifier: AGPL-3.0-or-later

// Backlog 7c: a score file read in flight when the watcher reports a colleague's change to that
// file. The change is skipped (nothing cached yet), so without a re-read the read's older
// content stayed until the next login. A fake bridge lets the test hold a read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Held {
  release: (data: unknown) => void;
}

function fakeBridge() {
  const held: Held[] = [];
  const disk = new Map<string, unknown>();
  let hold = false;
  const bridge = {
    readJson: vi.fn((rel: string) => {
      const now = disk.get(rel) ?? null;
      if (!hold) return Promise.resolve(now);
      return new Promise((resolve) => held.push({ release: resolve }));
    }),
    readJsonDir: vi.fn((dir: string) => {
      const files = [...disk]
        .filter(([rel]) => rel.startsWith(`${dir}/`))
        .map(([rel, data]) => ({ name: rel.slice(dir.length + 1), data }));
      if (!hold) return Promise.resolve(files);
      return new Promise((resolve) => held.push({ release: () => resolve(files) }));
    }),
  };
  return {
    bridge,
    disk,
    held,
    holdReads: (on: boolean) => {
      hold = on;
    },
  };
}

let fake: ReturnType<typeof fakeBridge>;

beforeEach(() => {
  vi.resetModules();
  fake = fakeBridge();
  vi.stubGlobal('window', { maatwerk: fake.bridge });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FILE = '2025-2026/scores/nat/101.json';
const v1 = { student_id: '101', scores: { e1: { q1: 1 } } };
const v2 = { student_id: '101', scores: { e1: { q1: 2 } } };

describe('Store: a colleague change during a read (backlog 7c)', () => {
  it('reads a single file again when it changed while the read was in flight', async () => {
    const { Store } = await import('./store.js');
    fake.disk.set(FILE, v1);
    fake.holdReads(true);
    const pending = Store.getStudentScores('101', '2025-2026', 'nat');
    await Promise.resolve();
    // The colleague's version lands and the watcher reports it before the read returns.
    fake.disk.set(FILE, v2);
    await Store.applyExternalChange({ relPath: FILE, kind: 'changed', meta: null });
    fake.holdReads(false);
    fake.held.shift()!.release(v1);
    const got = await pending;
    expect(got.scores.e1.q1).toBe(2);
    expect(fake.bridge.readJson).toHaveBeenCalledTimes(2);
  });

  it('does not cache a folder read entry that changed during the read', async () => {
    const { Store } = await import('./store.js');
    fake.disk.set(FILE, v1);
    fake.holdReads(true);
    const preload = Store.preloadScores('2025-2026', 'nat', ['101']);
    await Promise.resolve();
    await Store.applyExternalChange({ relPath: FILE, kind: 'changed', meta: null });
    fake.disk.set(FILE, v2);
    fake.holdReads(false);
    fake.held.shift()!.release(null);
    await preload;
    const got = await Store.getStudentScores('101', '2025-2026', 'nat');
    expect(got.scores.e1.q1).toBe(2);
  });

  it('a read with no change meanwhile is cached as before (one read)', async () => {
    const { Store } = await import('./store.js');
    fake.disk.set(FILE, v1);
    await Store.getStudentScores('101', '2025-2026', 'nat');
    await Store.getStudentScores('101', '2025-2026', 'nat');
    expect(fake.bridge.readJson).toHaveBeenCalledTimes(1);
  });
});
