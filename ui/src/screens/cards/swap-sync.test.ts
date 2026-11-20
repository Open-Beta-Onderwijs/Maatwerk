// SPDX-License-Identifier: AGPL-3.0-or-later

// The "laatste / SE" swap stays in step on every card, with the requests of a frame merged and
// every span synced once (perf hotfix 0.24.1: a sync per card took seconds on a full list).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSwaps } from './swap-sync';

const frames: (() => void)[] = [];
const runFrame = () => frames.splice(0).forEach((f) => f());

/** A swap span with one animation, counting the getAnimations calls. */
function span() {
  const animation = { startTime: 1234 as number | null };
  const el = { getAnimations: vi.fn(() => [animation]) };
  return { el, animation };
}

function root(spans: ReturnType<typeof span>[]) {
  return {
    querySelectorAll: vi.fn((sel: string) => {
      expect(sel).toBe('.s-card__swap > span');
      return spans.map((s) => s.el);
    }),
  } as unknown as ParentNode & { querySelectorAll: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  frames.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
});

describe('syncSwaps', () => {
  it('starts every swap animation at time 0, in the next frame', () => {
    const spans = [span(), span()];
    syncSwaps(root(spans));
    expect(spans[0]!.animation.startTime).toBe(1234);
    runFrame();
    expect(spans.map((s) => s.animation.startTime)).toEqual([0, 0]);
  });

  it('merges the requests of one frame', () => {
    const spans = [span(), span()];
    const r = root(spans);
    for (let i = 0; i < 500; i++) syncSwaps(r);
    expect(frames).toHaveLength(1);
    runFrame();
    expect(r.querySelectorAll).toHaveBeenCalledTimes(1);
    expect(spans[0]!.el.getAnimations).toHaveBeenCalledTimes(1);
  });

  it('syncs a span once; a new card is synced in its own frame', () => {
    const old = span();
    syncSwaps(root([old]));
    runFrame();
    const added = span();
    syncSwaps(root([old, added]));
    runFrame();
    expect(old.el.getAnimations).toHaveBeenCalledTimes(1);
    expect(added.animation.startTime).toBe(0);
  });
});
