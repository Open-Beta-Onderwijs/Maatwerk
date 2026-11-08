// SPDX-License-Identifier: AGPL-3.0-or-later

// Format v3 (step 18): exam defaults and what the Store writes.

import { describe, expect, it } from 'vitest';
import { withExamDefaults, type Exam } from '../../src/domain/types';
import { openStore } from '../store-session';

const YEAR = '2025-2026';

describe('format v3 exam fields (decision 14)', () => {
  it('absent kind and diagnostic get the defaults; set ones stay', () => {
    expect(withExamDefaults({ id: 'a' })).toEqual({ id: 'a', kind: 'toets', diagnostic: false });
    expect(withExamDefaults({ id: 'b', kind: 'po', diagnostic: true })).toEqual({
      id: 'b',
      kind: 'po',
      diagnostic: true,
    });
  });

  it('upsertExam writes them on a new exam and keeps them on an edit', async () => {
    const { Store, api } = await openStore({ files: {}, subject: 'nat' });
    const exam: Exam = { id: 'toets-x', subject: 'nat', title: 'X', jaarlaag: '3', questions: [] };
    await Store.upsertExam!(exam, YEAR);
    const saved = JSON.parse(api.peek(`${YEAR}/exams/toets-x.json`)!);
    expect([saved.kind, saved.diagnostic]).toEqual(['toets', false]);
    await Store.upsertExam!({ ...saved, kind: 'po' }, YEAR);
    expect(JSON.parse(api.peek(`${YEAR}/exams/toets-x.json`)!).kind).toBe('po');
  });
});
