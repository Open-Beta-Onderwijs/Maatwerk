// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { hasData } from './has-data';

// The cases of maatwerk-core `locks::tests::has_data_counts_scores_n_overrides_observaties_and_po`.
describe('hasData (maatwerk-core::locks::has_data)', () => {
  it('counts scores, N, overrides, observaties and PO grading', () => {
    const e = 'e1';
    expect(hasData({}, e)).toBe(false);
    expect(hasData({ scores: { e1: {} } }, e)).toBe(false);
    expect(hasData({ scores: { e2: { q1: 1 } } }, e)).toBe(false);
    expect(hasData({ scores: { e1: { q1: 0 } } }, e)).toBe(true);
    expect(hasData({ scores: { e1: { q1: 'N' } } }, e)).toBe(true);
    expect(hasData({ scores: { e1: { q1: null } } }, e)).toBe(true); // "N" in memory (C9)
    expect(hasData({ overrides: { e1: null } }, e)).toBe(false);
    expect(hasData({ overrides: { e1: { cijfer: 6 } } }, e)).toBe(true);
    expect(hasData({ observations: { e1: [] } }, e)).toBe(false);
    expect(hasData({ observations: { e1: ['o1'] } }, e)).toBe(true);
    expect(hasData({ po: { e1: {} } }, e)).toBe(false);
    expect(hasData({ po: { e1: { ownLines: [] } } }, e)).toBe(true);
    expect(hasData(null, e)).toBe(false);
  });
});
