// SPDX-License-Identifier: AGPL-3.0-or-later

// Theme tokens (design spec 2.1-2.2): the accent list in theme.ts and the
// rules in styles/tokens.css stay in sync, and the spec's contrast promises
// hold for every accent.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENTS, ACCENT_FILL, normaliseLook } from '../src/domain/look';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function accentRule(name: string): Record<string, string> {
  const m = new RegExp(`html\\[data-accent='${name}'\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${name}`);
  return Object.fromEntries(
    [...(m[1] ?? '').matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((x) => [x[1], (x[2] ?? '').trim()]),
  );
}

function luminance(hex: string): number {
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const DARK_SURFACE = '#1d2128';

describe('accent tokens', () => {
  it('has 21 accents, blauw included', () => {
    expect(ACCENTS).toHaveLength(21);
    expect(ACCENTS).toContain('blauw');
  });

  it.each(ACCENTS)('%s: tokens.css matches theme.ts and passes the contrast rules', (name) => {
    const rule = accentRule(name);
    const get = (k: string) => rule[k] ?? '#ffffff';
    expect(rule['--accent']).toBe(ACCENT_FILL[name]);
    const onAccent = rule['--on-accent'] ?? '#ffffff';
    expect(contrast(get('--accent'), onAccent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(get('--accent-text-dark'), DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    const onAnti = rule['--on-anti'] ?? '#ffffff';
    expect(contrast(get('--anti'), onAnti)).toBeGreaterThanOrEqual(4.5);
  });

  it('the default accent in :root is blauw', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(css)![1];
    expect(root).toContain(`--accent: ${ACCENT_FILL.blauw};`);
  });
});

describe('normaliseLook', () => {
  it('keeps valid values', () => {
    expect(normaliseLook({ theme: 'dark', accent: 'geel' })).toEqual({
      theme: 'dark',
      accent: 'geel',
    });
  });

  it('falls back to light and blauw', () => {
    expect(normaliseLook(null)).toEqual({ theme: 'light', accent: 'blauw' });
    expect(normaliseLook({ theme: 'sepia', accent: 'toString' })).toEqual({
      theme: 'light',
      accent: 'blauw',
    });
  });
});
