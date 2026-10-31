// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { groupOverwrites, withImportIds } from '../../src/domain/groups';
import type { Group } from '../../src/domain/types';

const group = (over: Partial<Group> = {}): Group => ({
  id: '3a-nat-2025-2026',
  name: '3a nat',
  jaarlaag: '3',
  subject: 'nat',
  schoolsoort: ['Havo'],
  docenten: ['gebr-1'],
  student_ids: ['900001', '900002'],
  ...over,
});

describe('groupOverwrites (D34)', () => {
  it('reports removed students and changed fields of an existing group', () => {
    const next = group({ docenten: [], student_ids: [] });
    expect(groupOverwrites([group()], [next])).toEqual([
      {
        id: '3a-nat-2025-2026',
        name: '3a nat',
        fields: [{ field: 'docenten', before: ['gebr-1'], after: [] }],
        removedStudentIds: ['900001', '900002'],
        addedStudentIds: [],
      },
    ]);
  });

  it('reports added students', () => {
    const next = group({ student_ids: ['900002', '900003'] });
    const [o] = groupOverwrites([group()], [next]);
    expect(o?.removedStudentIds).toEqual(['900001']);
    expect(o?.addedStudentIds).toEqual(['900003']);
  });

  it('leaves out new groups and groups that do not change', () => {
    const fresh = group({ id: 'nieuw-2025-2026', name: 'nieuw' });
    // Number vs string jaarlaag, missing vs empty subcategory: no change.
    const same = group({ jaarlaag: 3, subcategory: undefined });
    expect(groupOverwrites([group({ subcategory: '' })], [fresh, same])).toEqual([]);
  });
});

describe('withImportIds (C10)', () => {
  it('keeps the id of an existing group with the same name, new names get an opaque id', () => {
    const existing = [group(), group({ id: 'groep-x-aaaaaa', name: '4b wisb' })];
    const out = withImportIds(existing, [
      { name: ' 3A-Nat ' },
      { name: '5c bio' },
      { name: '5C bio' },
      { name: '4b wisb' },
    ]);
    expect(out[0]!.id).toBe('3a-nat-2025-2026');
    expect(out[1]!.id).toMatch(/^groep-/);
    expect(out[2]!.id).toBe(out[1]!.id);
    expect(out[3]!.id).toBe('groep-x-aaaaaa');
  });
});
