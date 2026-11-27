// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { cleanupChoices, filesText, sizeText, toRemove } from './instellingen-rapporten';
import { formatSize } from '../domain/format';

const years = [
  { schooljaar: '2023-2024', files: 1, kb: 100 },
  { schooljaar: '2024-2025', files: 2, kb: 200 },
  { schooljaar: '2025-2026', files: 3, kb: 300 },
];

describe('Afgedrukte rapporten (step 41, decision 85)', () => {
  it('offers every year but the oldest, newest first', () => {
    expect(cleanupChoices(years)).toEqual(['2025-2026', '2024-2025']);
    expect(cleanupChoices(years.slice(0, 1))).toEqual([]);
    expect(cleanupChoices([])).toEqual([]);
  });

  it('counts what goes: the years before the chosen one, never the chosen one', () => {
    expect(toRemove(years, '2025-2026')).toEqual({ files: 3, kb: 300 });
    expect(toRemove(years, '2024-2025')).toEqual({ files: 1, kb: 100 });
    expect(toRemove(years, '2023-2024')).toEqual({ files: 0, kb: 0 });
  });

  it('says bestand or bestanden, sizes with a decimal comma', () => {
    expect(filesText(1)).toBe('1 bestand');
    expect(filesText(0)).toBe('0 bestanden');
    expect(formatSize(1536 * 1024)).toBe('1,5 MB');
    expect(formatSize(2.25 * 1024 ** 3)).toBe('2,3 GB');
    expect(sizeText(3)).toBe('3 kB');
    expect(sizeText(1536)).toBe('1,5 MB');
  });
});
