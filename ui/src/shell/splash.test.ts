// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideSplash, setSplashStatus } from './splash';

// Vitest runs without a DOM here: a minimal stand-in for the two elements.
function fakeDocument(reduced = false) {
  const classes = new Set<string>(['splash']);
  const status = { textContent: 'Gegevens laden…' };
  const splash = {
    dataset: {} as Record<string, string>,
    classList: { add: (c: string) => classes.add(c) },
    removed: false,
    remove() {
      this.removed = true;
      doc.els.delete('splash');
    },
    addEventListener: vi.fn(),
  };
  const doc = {
    els: new Map<string, unknown>([
      ['splash', splash],
      ['splash-status', status],
    ]),
    getElementById(id: string) {
      return this.els.get(id) ?? null;
    },
    defaultView: { matchMedia: () => ({ matches: reduced }) },
  };
  return { doc: doc as unknown as Document, splash, status, classes };
}

describe('splash (F-06)', () => {
  afterEach(() => vi.useRealTimers());

  it('updates the status line', () => {
    const { doc, status } = fakeDocument();
    setSplashStatus('Bijna klaar…', doc);
    expect(status.textContent).toBe('Bijna klaar…');
  });

  it('fades out and is removed, also without a transition event', () => {
    vi.useFakeTimers();
    const { doc, splash, classes } = fakeDocument();
    hideSplash(doc);
    expect(classes.has('splash--leaving')).toBe(true);
    hideSplash(doc); // a second call is harmless
    expect(splash.addEventListener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(splash.removed).toBe(true);
  });

  it('is removed at once under reduced motion', () => {
    const { doc, splash } = fakeDocument(true);
    hideSplash(doc);
    expect(splash.removed).toBe(true);
  });

  it('does nothing once the splash is gone', () => {
    const { doc } = fakeDocument();
    doc.getElementById('splash')!.remove();
    expect(() => {
      hideSplash(doc);
      setSplashStatus('x', doc);
    }).not.toThrow();
  });
});
