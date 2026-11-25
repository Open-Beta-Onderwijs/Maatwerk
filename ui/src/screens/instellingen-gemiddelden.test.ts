// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { exampleRows } from './instellingen-gemiddelden';

const texts = (methode: 'afronden' | 'afkappen', decimalen: 0 | 1 | 2) =>
  exampleRows({ methode, decimalen }).map((r) => r.text);

// The rows of "Shown averages" in docs/phase-2/step-19-grade-rules.md (decision 93's examples).
describe('Cijfergemiddelden examples (board 64)', () => {
  it('follow the spec table for all six formats', () => {
    expect(texts('afronden', 0)).toEqual(['5', '6', '6', '7']);
    expect(texts('afronden', 1)).toEqual(['5,5', '5,5', '5,9', '7,0']);
    expect(texts('afronden', 2)).toEqual(['5,45', '5,50', '5,90', '6,95']);
    expect(texts('afkappen', 0)).toEqual(['5', '5', '5', '6']);
    expect(texts('afkappen', 1)).toEqual(['5,4', '5,5', '5,9', '6,9']);
    expect(texts('afkappen', 2)).toEqual(['5,45', '5,50', '5,90', '6,95']);
  });

  it('mark a shown value below 5,5 as a fail', () => {
    expect(exampleRows({ methode: 'afkappen', decimalen: 0 }).map((r) => r.fails)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(exampleRows({ methode: 'afronden', decimalen: 2 })[0]!.fails).toBe(true);
    expect(exampleRows({ methode: 'afronden', decimalen: 1 })[0]!.fails).toBe(false);
  });
});
