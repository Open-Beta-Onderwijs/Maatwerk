// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { printGroupPart, printName } from '../../src/domain/print';

describe('print name (ADR-0002 section 9)', () => {
  it('lists up to three distinct groups in order', () => {
    expect(printGroupPart(['3a', '3a', '3b', null, '—', ''])).toBe('3a 3b');
    expect(printGroupPart([])).toBe('');
    expect(printGroupPart(['3a', '3b', '3c', '3d'])).toBe('');
  });

  it('takes vak, toets and schooljaar from the exam and year', () => {
    expect(
      printName('Rapport', '2025-2026', { subject: 'nat', title: 'Voorbeeldtoets 1' }, ['3a']),
    ).toEqual({
      schooljaar: '2025-2026',
      soort: 'Rapport',
      vak: 'nat',
      groep: '3a',
      toets: 'Voorbeeldtoets 1',
    });
    expect(printName('Antwoordsleutel', '2025-2026', {}, [])).toMatchObject({
      vak: '',
      toets: '',
    });
  });
});
