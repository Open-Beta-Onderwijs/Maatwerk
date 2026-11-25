// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { VakNumbers } from '../domain/numbers';
import { vakNumbers } from './vak-numbers';

const result = (year: string) => ({ year }) as unknown as VakNumbers;

describe('vakNumbers cache', () => {
  it('asks once per year and vak while the generation stays', async () => {
    const api = { vakNumbers: vi.fn(async (y: string) => result(y)) };
    await vakNumbers('2025-2026', 'nat', 100, api);
    await vakNumbers('2025-2026', 'nat', 100, api);
    await vakNumbers('2025-2026', 'bio', 100, api);
    expect(api.vakNumbers).toHaveBeenCalledTimes(2);
    await vakNumbers('2025-2026', 'nat', 101, api);
    expect(api.vakNumbers).toHaveBeenCalledTimes(3);
  });

  it('does not keep a failed call', async () => {
    let fail = true;
    const api = {
      vakNumbers: vi.fn(async (y: string) => {
        if (fail) throw new Error('nee');
        return result(y);
      }),
    };
    await expect(vakNumbers('2024-2025', 'nat', 200, api)).rejects.toThrow('nee');
    fail = false;
    await expect(vakNumbers('2024-2025', 'nat', 200, api)).resolves.toEqual(result('2024-2025'));
  });
});
