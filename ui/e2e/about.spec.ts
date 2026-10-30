// SPDX-License-Identifier: AGPL-3.0-or-later

// "Over Maatwerk": the AGPL notice, source location and licence texts, reachable
// before login (startup screen) and after it (title in the top bar).

import { expect, test } from '@playwright/test';
import { login, watchErrors } from './helpers';

test('Over Maatwerk from the startup screen shows the notice and licence texts', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Over Maatwerk' }).click();
  const modal = page.locator('.about-modal');
  await expect(modal).toContainText('Copyright © 2026 Open Beta Onderwijs - Matthias Kortleven');
  await expect(modal).toContainText('GNU Affero General Public License, versie 3');
  await expect(modal).toContainText('https://github.com/Open-Beta-Onderwijs/Maatwerk');
  await expect(modal.locator('.about-version')).toContainText(/versie \d+\.\d+\.\d+ \(build .+\)/);

  const text = modal.locator('.about-text');
  await modal.getByRole('button', { name: 'Licentietekst (AGPL-3.0)' }).click();
  await expect(text).toContainText('GNU AFFERO GENERAL PUBLIC LICENSE');
  await modal.getByRole('button', { name: 'Licenties van derden' }).click();
  await expect(text).toContainText('1. RUST CRATES');
  await expect(text).toContainText('@codemirror/view');
  expect(errors).toEqual([]);
});

test('Over Maatwerk opens from the title in the top bar', async ({ page }) => {
  await login(page);
  await page.locator('#btn-about').click();
  await expect(page.locator('.about-modal h2')).toHaveText('Over Maatwerk');
});
