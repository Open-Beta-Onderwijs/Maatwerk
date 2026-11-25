// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { MAX_CELLS, diffLines } from './textdiff';

describe('diffLines', () => {
  it('marks removed, added and unchanged lines in order', () => {
    expect(diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('ignores CRLF and a BOM', () => {
    expect(diffLines('\uFEFFa\r\nb\r\n', 'a\nb\n').every((l) => l.kind === 'same')).toBe(true);
    expect(diffLines('a\n', 'a\nb\n').some((l) => l.kind === 'added')).toBe(true);
  });

  it('handles empty texts', () => {
    expect(diffLines('', 'x')).toEqual([
      { kind: 'removed', text: '' },
      { kind: 'added', text: 'x' },
    ]);
    expect(diffLines('', '')).toEqual([{ kind: 'same', text: '' }]);
  });
});

describe('diffLines on large copies (review 8b n8)', () => {
  const many = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => `${tag} ${i}`).join('\n');

  it('diffs only between the shared start and end', () => {
    const before = `${many(5000, 'x')}\nOUD\n${many(5000, 'y')}`;
    const after = `${many(5000, 'x')}\nNIEUW\n${many(5000, 'y')}`;
    const out = diffLines(before, after);
    expect(out.filter((l) => l.kind !== 'same')).toEqual([
      { kind: 'removed', text: 'OUD' },
      { kind: 'added', text: 'NIEUW' },
    ]);
    expect(out).toHaveLength(10_002);
  });

  it('shows a middle part above the cap as removed, then added', () => {
    const out = diffLines(many(2000, 'a'), many(2000, 'b'));
    expect(2001 * 2001).toBeGreaterThan(MAX_CELLS);
    expect(out.slice(0, 2000).every((l) => l.kind === 'removed')).toBe(true);
    expect(out.slice(2000).every((l) => l.kind === 'added')).toBe(true);
  });
});
