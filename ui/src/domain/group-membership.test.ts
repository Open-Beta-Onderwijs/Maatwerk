// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { removeWithDataText, removedWithData } from './group-membership';

describe('removedWithData', () => {
  it('lists the students with data that leave a group, once', () => {
    const changes = [
      { before: ['1', '2', '3'], after: ['1'] },
      { before: ['3', '4'], after: [] },
    ];
    expect(removedWithData(changes, new Set(['2', '3', '9']))).toEqual(['2', '3']);
  });
  it('a student who stays, or has no data, is not listed', () => {
    expect(removedWithData([{ before: ['1'], after: ['1', '2'] }], new Set(['1', '2']))).toEqual(
      [],
    );
    expect(removedWithData([{ before: ['1'], after: [] }], new Set())).toEqual([]);
  });
});

describe('removeWithDataText', () => {
  it('names one, several, and caps at five', () => {
    expect(removeWithDataText(['Ada'])).toMatch(/^Deze leerling heeft scores .*: Ada\. /);
    expect(removeWithDataText(['A', 'B'])).toMatch(/^Deze 2 leerlingen hebben .*: A, B\. /);
    expect(removeWithDataText(['A', 'B', 'C', 'D', 'E', 'F'])).toContain(
      'A, B, C, D, E en 1 ander.',
    );
    expect(removeWithDataText(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toContain('en 2 anderen.');
  });
});
