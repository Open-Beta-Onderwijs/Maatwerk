// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { NAME_COL_MAX, nameColumnWidth } from './fit-name';

describe('nameColumnWidth', () => {
  it('is the max when there is room', () => {
    expect(nameColumnWidth(1064, 365, 170)).toBe(NAME_COL_MAX);
  });
  it('takes the room left beside the other columns in a narrow pane', () => {
    expect(nameColumnWidth(712, 365, 170)).toBe(347);
  });
  it('never goes below the names themselves', () => {
    expect(nameColumnWidth(552, 496, 164)).toBe(164);
  });
});
