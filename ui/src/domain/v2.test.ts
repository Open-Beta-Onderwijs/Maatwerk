// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { decode, encode } from './v2';

const FILE = '2025-2026/students-2025-2026.json';

describe('students file (C8)', () => {
  it('keeps top-level keys other than students when saving (review 7a n8)', () => {
    const raw = { students: [{ id: '101', voornaam: 'An' }], notitie: 'van een nieuwere app' };
    const list = decode(FILE, raw) as { id: string; voornaam: string }[];
    list.push({ id: '102', voornaam: 'Bo' });
    expect(encode(FILE, list, raw)).toEqual({
      students: [
        { id: '101', voornaam: 'An' },
        { id: '102', voornaam: 'Bo' },
      ],
      notitie: 'van een nieuwere app',
    });
  });

  it('writes { students } for a new file or one in the old array shape', () => {
    const list = [{ id: '101' }];
    expect(encode(FILE, list)).toEqual({ students: [{ id: '101' }] });
    expect(encode(FILE, list, [{ id: '9' }])).toEqual({ students: [{ id: '101' }] });
  });
});
