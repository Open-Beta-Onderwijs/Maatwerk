// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { editorSubtitle } from './editor-header';

describe('editor header subtitle (V-07)', () => {
  it('vak, schoolsoort and jaarlagen as on board 10', () => {
    expect(
      editorSubtitle({ vakken: ['nat'], schoolsoort: ['Gymnasium'], jaarlagen: [6, '4', 5] }),
    ).toBe('Opdracht · Natuurkunde · gymnasium 4, 5, 6');
    expect(
      editorSubtitle({ vakken: ['nat', 'schk'], schoolsoort: ['Havo', 'Vwo'], jaarlagen: [] }),
    ).toBe('Opdracht · Natuurkunde, Scheikunde · havo, vwo');
    expect(editorSubtitle({})).toBe('Opdracht');
  });
});
