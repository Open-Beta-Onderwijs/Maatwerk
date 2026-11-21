// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { Observatie } from '../../domain/types';
import { compareOpdrachten, opdCardHtml, opdMetaLine, type OpdFields } from './card';

describe('opdMetaLine', () => {
  it('joins schoolsoort and vakken, leaving out what is missing', () => {
    expect(opdMetaLine({ id: 'a', schoolsoort: ['Havo', 'Vwo'], vakken: ['nat'] })).toMatch(
      /^Havo, Vwo · \S/,
    );
    expect(opdMetaLine({ id: 'a', schoolsoort: ['Havo'] })).toBe('Havo');
    expect(opdMetaLine({ id: 'a' })).toBe('');
  });
});

describe('compareOpdrachten', () => {
  it('lowest jaarlaag first, none last, then the name', () => {
    const list: OpdFields[] = [
      { id: '1', naam: 'Zon', jaarlagen: [3] },
      { id: '2', naam: 'Geen' },
      { id: '3', naam: 'Maan', jaarlagen: [5, 2] },
      { id: '4', naam: 'Aarde', jaarlagen: [3, 4] },
      { id: '5', naam: 'Ander' },
    ];
    expect([...list].sort(compareOpdrachten).map((o) => o.id)).toEqual(['3', '4', '1', '5', '2']);
  });
});

describe('opdCardHtml', () => {
  it('shows name, description, meta, jaarlagen and the linked observatie icons', () => {
    const obs = new Map<string, Observatie>([
      ['a', { id: 'a', naam: 'Rekenfout', icon: '🧮' }],
      ['b', { id: 'b', naam: 'Eenheid', icon: '📏' }],
    ]);
    const html = opdCardHtml(
      {
        id: 'op-1',
        naam: 'Machten',
        beschrijving: 'Oefenen.',
        schoolsoort: ['Havo'],
        jaarlagen: ['2'],
        observaties: ['b', 'gone', 'a'],
      },
      obs,
    );
    expect(html).toMatch(/data-action="preview" data-id="op-1" title="Machten"[^>]*>Machten</);
    expect(html).toContain('<div class="icard-desc">Oefenen.</div>');
    expect(html).toContain('<div class="icard-meta">Havo</div>');
    expect([...html.matchAll(/icard-jl--on">(\d)/g)].map((m) => m[1])).toEqual(['2']);
    expect([...html.matchAll(/<span title="([^"]*)">/g)].map((m) => m[1])).toEqual([
      'Eenheid',
      'Rekenfout',
    ]);
  });
});
