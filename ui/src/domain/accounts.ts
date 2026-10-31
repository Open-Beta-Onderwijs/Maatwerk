// SPDX-License-Identifier: AGPL-3.0-or-later

// Accounts (Step 7b): the Dutch texts and checks of the PIN dialogs
// (screens/pin.ts), without DOM. PINs themselves are checked in Rust.

/** What the messages need of a PIN check (bridge `PinCheck`). */
export interface PinOutcomeLike {
  outcome: 'ok' | 'wrong' | 'wait' | 'noPin';
  retryAfterMs: number;
}

/** The fields of a user record the dialogs need. */
export interface PinUser {
  id: string;
  voornaam: string;
  tussenvoegsel?: string;
  achternaam?: string;
  isAdmin?: boolean;
  pinHash?: string | null;
}

export function fullUserName(u: PinUser): string {
  return [u.voornaam, u.tussenvoegsel, u.achternaam].filter(Boolean).join(' ');
}

/** Dutch problem with a new PIN and its repetition, or null when fine. */
export function newPinProblem(pin: string, repeat: string): string | null {
  if (!/^\d{5,8}$/.test(pin)) return 'Een pincode heeft 5 tot 8 cijfers.';
  if (pin !== repeat) return 'De twee pincodes zijn niet gelijk.';
  return null;
}

/** "3 seconden" / "1 seconde". */
function seconds(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return `${s} ${s === 1 ? 'seconde' : 'seconden'}`;
}

/** The Dutch message for a check that did not succeed. */
export function pinCheckMessage(check: PinOutcomeLike, what = 'pincode'): string {
  switch (check.outcome) {
    case 'ok':
      return '';
    case 'noPin':
      return 'Er is nog geen pincode ingesteld.';
    case 'wait':
      return `Te veel pogingen. Probeer het over ${seconds(check.retryAfterMs)} opnieuw.`;
    case 'wrong':
      return check.retryAfterMs > 0
        ? `Onjuiste ${what}. Probeer het over ${seconds(check.retryAfterMs)} opnieuw.`
        : `Onjuiste ${what}.`;
  }
}

/** The text file "Opslaan als" writes, and what "Afdrukken" prints. */
export function recoveryCodesText(user: PinUser, codes: string[], date: Date): string {
  const day = date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  return [
    'Maatwerk - herstelcodes van de beheerder',
    `${fullUserName(user)}, gemaakt op ${day}`,
    '',
    'Elke code werkt één keer, als je je pincode vergeten bent',
    '("Pincode vergeten?" op het inlogscherm). Bewaar dit op een veilige plek.',
    '',
    ...codes.map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`),
    '',
  ].join('\r\n');
}
