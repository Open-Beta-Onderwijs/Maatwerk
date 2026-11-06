// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 16 (Platforms): the first-run data folder choice and "Andere map kiezen…" on the
// startup error screen. Every page load starts a fresh MockApi.

import { expect, test, type Page } from '@playwright/test';
import { withMock } from './helpers';

async function startWith(page: Page, status: Record<string, unknown>) {
  await page.addInitScript((s) => {
    (window as unknown as { __maatwerkMockFolderStatus: unknown }).__maatwerkMockFolderStatus = s;
  }, status);
  await page.goto('/');
}

const FIRST_RUN = {
  dataDir: '',
  source: null,
  appVersion: '0.7.0',
  readOnly: null,
  error: { code: 'no_data_folder', message: 'no data folder chosen yet', details: {} },
};

function pick(page: Page, picked: string | null | { refused: string }) {
  return withMock(page, (m, p) => void (m.pickedFolder = p), picked);
}

test.describe('first run: choose the data folder', () => {
  test('asks for the folder and restarts after a choice', async ({ page }) => {
    await startWith(page, FIRST_RUN);
    const region = page.getByRole('region', { name: 'Kies de gegevensmap' });
    await expect(region).toContainText('Deze keuze geldt alleen voor deze computer.');
    await expect(page.locator('.subject-card')).toHaveCount(0);
    const button = region.getByRole('button', { name: 'Map kiezen…' });
    await expect(button).toBeFocused();

    // Cancelled: nothing happens, the button can be used again.
    await button.click();
    await expect(button).toBeEnabled();

    await pick(page, { refused: 'In deze map staan andere bestanden.' });
    await button.click();
    await expect(region.getByRole('status')).toHaveText('In deze map staan andere bestanden.');

    await pick(page, '/Users/docent/OneDrive/Maatwerk/data');
    await button.click();
    await expect(region.getByRole('status')).toHaveText(
      'Gegevensmap: /Users/docent/OneDrive/Maatwerk/data. Maatwerk start opnieuw…',
    );
    await expect(button).toBeDisabled();
    const calls = await withMock(page, (m) => m.calls.map((c) => c[0]));
    expect(calls.filter((c) => c === 'chooseDataFolder')).toHaveLength(3);
    expect(calls).toContain('restartApp');
    expect(calls).not.toContain('listYears');
  });

  test('a folder that cannot be opened offers another one when this PC chose it', async ({
    page,
  }) => {
    await startWith(page, {
      ...FIRST_RUN,
      dataDir: '/Users/docent/OneDrive-Oud/data',
      source: 'chosen',
      error: { code: 'io', message: 'not found', details: {} },
    });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Maatwerk kan de gegevensmap niet openen');
    await pick(page, '/Users/docent/OneDrive/data');
    await alert.getByRole('button', { name: 'Andere map kiezen…' }).click();
    await expect(alert.getByRole('status')).toContainText(
      'Gegevensmap: /Users/docent/OneDrive/data.',
    );
    const calls = await withMock(page, (m) => m.calls.map((c) => c[0]));
    expect(calls).toEqual(expect.arrayContaining(['chooseDataFolder', 'restartApp']));
  });

  test('a folder fixed by MAATWERK_DATA_DIR offers only a retry', async ({ page }) => {
    await startWith(page, {
      ...FIRST_RUN,
      dataDir: 'D:/test/data',
      source: 'env',
      error: { code: 'io', message: 'not found', details: {} },
    });
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('button', { name: 'Opnieuw proberen' })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Andere map kiezen…' })).toHaveCount(0);
  });
});
