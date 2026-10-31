// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { perfSpan, timed } from './perf';

const spans = (name: string) => performance.getEntriesByName(`mw:${name}`, 'measure');

describe('perf spans', () => {
  afterEach(() => performance.clearMeasures());

  it('records one measure per span, however often it is ended', () => {
    const end = perfSpan('t:once');
    end();
    end();
    expect(spans('t:once')).toHaveLength(1);
  });

  it('times sync and async work, also when it fails', async () => {
    expect(timed('t:sync', () => 42)).toBe(42);
    await expect(timed('t:async', async () => 'ok')).resolves.toBe('ok');
    expect(() =>
      timed('t:throw', () => {
        throw new Error('x');
      }),
    ).toThrow('x');
    await expect(timed('t:reject', () => Promise.reject(new Error('y')))).rejects.toThrow('y');
    for (const n of ['t:sync', 't:async', 't:throw', 't:reject']) expect(spans(n)).toHaveLength(1);
  });
});

describe('afterPaint', () => {
  it('resolves (with or without requestAnimationFrame)', async () => {
    const { afterPaint } = await import('./perf');
    await expect(afterPaint()).resolves.toBeUndefined();
  });
});
