// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { groupOverwrites } from '../../src/domain/groups';
import type { Group } from '../../src/domain/types';

const group = (over: Partial<Group> = {}): Group => ({
  id: '3a-nat-2025-2026',
  name: '3a nat',
  jaarlaag: '3',
  subject: 'nat',
  schoolsoort: ['Havo'],
  docenten: ['gebr-1'],
  student_ids: [900001, 900002],
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
        removedStudentIds: [900001, 900002],
        addedStudentIds: [],
      },
    ]);
  });

  it('reports added students; ids compare as strings', () => {
    const next = group({ student_ids: ['900002', 900003] });
    const [o] = groupOverwrites([group()], [next]);
    expect(o?.removedStudentIds).toEqual([900001]);
    expect(o?.addedStudentIds).toEqual([900003]);
  });

  it('leaves out new groups and groups that do not change', () => {
    const fresh = group({ id: 'nieuw-2025-2026', name: 'nieuw' });
    // Number vs string jaarlaag, missing vs empty subcategory: no change.
    const same = group({ jaarlaag: 3, subcategory: undefined });
    expect(groupOverwrites([group({ subcategory: '' })], [fresh, same])).toEqual([]);
  });
});
