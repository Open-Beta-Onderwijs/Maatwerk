// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { diffLines, textsDiffer } from './textdiff';

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
    expect(textsDiffer('\uFEFFa\r\nb\r\n', 'a\nb\n')).toBe(false);
    expect(textsDiffer('a\n', 'a\nb\n')).toBe(true);
  });

  it('handles empty texts', () => {
    expect(diffLines('', 'x')).toEqual([
      { kind: 'removed', text: '' },
      { kind: 'added', text: 'x' },
    ]);
    expect(diffLines('', '')).toEqual([{ kind: 'same', text: '' }]);
  });
});
