// SPDX-License-Identifier: AGPL-3.0-or-later

// Decision 25: one student has one year average, whichever screen asks.

import { describe, expect, it } from 'vitest';
import { openStore } from '../store-session';

const YEAR = '2025-2026';
const exam = (id: string, jaarlaag: string, volgnummer?: number) =>
  JSON.stringify({
    id,
    subject: 'nat',
    jaarlaag,
    n_term: 1,
    weging: 1,
    volgnummer,
    questions: [{ id: 'q1', max_points: 10, rtti: 'R' }],
  });

describe('the year average', () => {
  it('counts every test of the year, also outside the group and without a volgnummer', async () => {
    const { Store } = await openStore({
      subject: 'nat',
      files: {
        [`${YEAR}/exams/a.json`]: exam('a', '3', 301),
        [`${YEAR}/exams/b.json`]: exam('b', '4', 401),
        [`${YEAR}/exams/c.json`]: exam('c', '4'),
      },
    });
    await Store.loadYear!(YEAR, 'nat');
    const rec = {
      overrides: { a: { cijfer: 6 }, b: { cijfer: 8 }, c: { cijfer: 10 } },
    };
    expect(Store.studentYearAverage!(rec, YEAR)).toBe(8);
  });
});
