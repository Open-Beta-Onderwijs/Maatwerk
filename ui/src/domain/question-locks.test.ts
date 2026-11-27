// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { highestEntered, maxRefusal } from './question-locks';

describe('highestEntered', () => {
  it('takes the highest number per question of this exam; N, blanks and other exams skip', () => {
    const recs = [
      { scores: { e1: { q1: 2, q2: null, q3: 0 }, e2: { q1: 9 } } },
      { scores: { e1: { q1: 3.5, q2: 1 } } },
      null,
      {},
      { scores: { e1: { q1: 'x' } } },
    ];
    expect(highestEntered(recs, 'e1')).toEqual({ q1: 3.5, q2: 1, q3: 0 });
    expect(highestEntered(recs, 'e3')).toEqual({});
  });
});

describe('maxRefusal', () => {
  const highest = { q1: 3.5, q2: 0 };
  it('refuses a max below an entered score, with a decimal comma', () => {
    expect(maxRefusal(highest, 'q1', 3)).toBe(
      'Er is al een score van 3,5 ingevoerd voor deze vraag: het maximum kan niet lager.',
    );
  });
  it('allows the same, a higher max, and questions without scores', () => {
    expect(maxRefusal(highest, 'q1', 4)).toBeNull();
    expect(maxRefusal(highest, 'q2', 0)).toBeNull();
    expect(maxRefusal(highest, 'q9', 0)).toBeNull();
  });
});
