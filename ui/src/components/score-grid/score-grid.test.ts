// SPDX-License-Identifier: AGPL-3.0-or-later

// Clipboard helpers of the score grid (spec G33, G54). The grid's DOM
// behaviour is tested with Playwright (ui/e2e/score-grid.spec.ts).

import { describe, expect, it } from 'vitest';
import { parseCheckboxText, parseClipboardText, toClipboardText } from './score-grid';

describe('clipboard text', () => {
  it('writes tab-separated lines', () => {
    expect(
      toClipboardText([
        ['1', '2,5'],
        ['N', ''],
      ]),
    ).toBe('1\t2,5\nN\t');
  });

  it('reads spreadsheet text; a trailing line break adds no row', () => {
    expect(parseClipboardText('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseClipboardText('7')).toEqual([['7']]);
    expect(parseClipboardText('')).toEqual([['']]);
  });

  it('round-trips', () => {
    const block = [
      ['1', '', 'N'],
      ['abc', '0', '4'],
    ];
    expect(parseClipboardText(toClipboardText(block))).toEqual(block);
  });
});

describe('checkbox text', () => {
  it.each([
    ['1', true],
    ['TRUE', true],
    [' x ', true],
    ['0', false],
    ['false', false],
    ['', false],
    ['2', null],
    ['abc', null],
  ])('%j -> %j', (text, expected) => {
    expect(parseCheckboxText(text)).toBe(expected);
  });
});
