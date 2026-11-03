// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  fullUserName,
  newPinProblem,
  pinCheckMessage,
  recoveryCodesText,
  type PinOutcomeLike,
} from './accounts';

const check = (outcome: PinOutcomeLike['outcome'], retryAfterMs = 0): PinOutcomeLike => ({
  outcome,
  retryAfterMs,
});

describe('PIN dialogs (Step 7b)', () => {
  it('accepts 4 to 8 digits that match their repetition', () => {
    expect(newPinProblem('1234', '1234')).toBeNull();
    expect(newPinProblem('12345', '12345')).toBeNull();
    expect(newPinProblem('12345678', '12345678')).toBeNull();
    for (const bad of ['123', '123456789', '12a45', '']) {
      expect(newPinProblem(bad, bad)).toBe('Een pincode heeft 4 tot 8 cijfers.');
    }
    expect(newPinProblem('12345', '12346')).toBe('De twee pincodes zijn niet gelijk.');
  });

  it('says how long to wait after wrong attempts', () => {
    expect(pinCheckMessage(check('ok'))).toBe('');
    expect(pinCheckMessage(check('wrong'))).toBe('Onjuiste pincode.');
    expect(pinCheckMessage(check('wrong', 2000))).toBe(
      'Onjuiste pincode. Probeer het over 2 seconden opnieuw.',
    );
    expect(pinCheckMessage(check('wait', 400))).toBe(
      'Te veel pogingen. Probeer het over 1 seconde opnieuw.',
    );
    expect(pinCheckMessage(check('wrong'), 'herstelcode')).toBe('Onjuiste herstelcode.');
    expect(pinCheckMessage(check('noPin'))).toBe('Er is nog geen pincode ingesteld.');
  });

  it('writes the recovery codes as a numbered text with the name and date', () => {
    const user = { id: 'admin', voornaam: 'Anne', tussenvoegsel: 'de', achternaam: 'Beheer' };
    expect(fullUserName(user)).toBe('Anne de Beheer');
    const text = recoveryCodesText(user, ['ABCD-EFGH', 'JKMN-PQRS'], new Date(2026, 9, 31));
    expect(text).toContain('Anne de Beheer, gemaakt op 31 oktober 2026');
    expect(text).toContain(' 1. ABCD-EFGH\r\n 2. JKMN-PQRS');
  });
});
