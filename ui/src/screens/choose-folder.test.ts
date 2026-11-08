// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { chooseAndRestart } from './choose-folder';
import { canChooseOther } from './startup-error';

/** A stand-in for the status paragraph (the unit tests run without a DOM). */
function statusEl(): HTMLElement {
  const classes = new Set<string>();
  const el = {
    textContent: '',
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
  };
  return el as unknown as HTMLElement;
}

function api(pick: () => Promise<string | null>) {
  return { chooseDataFolder: vi.fn(pick), restartApp: vi.fn(async () => {}) };
}

describe('choose the data folder (step 16a)', () => {
  it('restarts after a choice and shows the folder', async () => {
    const a = api(async () => 'D:/OneDrive/Maatwerk/data');
    const status = statusEl();
    expect(await chooseAndRestart(a, status)).toBe(true);
    expect(status.textContent).toBe(
      'Gegevensmap: D:/OneDrive/Maatwerk/data. Maatwerk start opnieuw…',
    );
    expect(a.restartApp).toHaveBeenCalledOnce();
  });

  it('does nothing when the dialog is cancelled', async () => {
    const a = api(async () => null);
    const status = statusEl();
    expect(await chooseAndRestart(a, status)).toBe(false);
    expect(status.textContent).toBe('');
    expect(a.restartApp).not.toHaveBeenCalled();
  });

  it('shows the Dutch reason of a refused folder, a technical one otherwise', async () => {
    const status = statusEl();
    const refused = api(() =>
      Promise.reject({ code: 'invalid_argument', message: 'Kies een lege map.' }),
    );
    expect(await chooseAndRestart(refused, status)).toBe(false);
    expect(status.textContent).toBe('Kies een lege map.');
    expect(status.classList.contains('is-error')).toBe(true);
    const broken = api(() => Promise.reject({ code: 'io', message: 'denied' }));
    await chooseAndRestart(broken, status);
    expect(status.textContent).toBe('Technische melding: denied');
    expect(refused.restartApp).not.toHaveBeenCalled();
  });

  it('offers another folder only when this PC chose it or it is beside the program', () => {
    expect(canChooseOther('chosen')).toBe(true);
    expect(canChooseOther('besideApp')).toBe(true);
    expect(canChooseOther('env')).toBe(false);
    expect(canChooseOther('dev')).toBe(false);
    expect(canChooseOther(null)).toBe(false);
  });
});
