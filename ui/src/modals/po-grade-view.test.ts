// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { tickLeft, ticks } from './po-grade-view';

describe('slider ticks (step 37)', () => {
  it('every point up to 20, then steps, always ending at the maximum', () => {
    expect(ticks(20)).toHaveLength(21);
    expect(ticks(23)).toEqual([0, 5, 10, 15, 20, 23]);
  });

  it('puts each label at the thumb centre of its value', () => {
    expect(tickLeft(0, 20)).toBe('calc(8px + (100% - 16px) * 0)');
    expect(tickLeft(10, 20)).toBe('calc(8px + (100% - 16px) * 0.5)');
    expect(tickLeft(20, 20)).toBe('calc(8px + (100% - 16px) * 1)');
    expect(tickLeft(1, 3)).toBe('calc(8px + (100% - 16px) * 0.3333)');
    expect(tickLeft(0, 0)).toBe('calc(8px + (100% - 16px) * 0)');
  });
});
