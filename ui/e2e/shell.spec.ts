// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 15 (Shell): minimum app version (PLAN-2 decision 5), tab bar, user menu,
// look per user. Every page load starts a fresh MockApi.

import { expect, test } from '@playwright/test';
import { YEAR, examMenuItem, login, readMockJson, seedFiles, withMock } from './helpers';

const SCHOOL = 'school.json';

async function schoolWith(page: import('@playwright/test').Page, minAppVersion: string) {
  await page.goto('/');
  const school = await readMockJson<Record<string, unknown>>(page, SCHOOL);
  return { ...school, minAppVersion };
}

test.describe('minimum app version', () => {
  test('a newer minAppVersion opens the app read-only with a banner', async ({ page }) => {
    await seedFiles(page, { [SCHOOL]: await schoolWith(page, '99.0.0') });
    await page.goto('/');
    const banner = page.locator('#read-only-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Maatwerk 99.0.0 of nieuwer');
    await expect(banner).toContainText('deze versie: 0.6.0');
    await expect(page.locator('html')).toHaveAttribute('data-read-only', 'true');
  });

  test('the same or an older minAppVersion: no banner', async ({ page }) => {
    await seedFiles(page, { [SCHOOL]: await schoolWith(page, '0.6.0') });
    await page.goto('/');
    await expect(page.locator('.subject-card').first()).toBeVisible();
    await expect(page.locator('#read-only-banner')).toHaveCount(0);
  });

  test('a save after a colleague raised the minimum is refused with a clear message', async ({
    page,
  }) => {
    const examId = `nat-lege-toets-${YEAR}`;
    const file = `${YEAR}/exams/${examId}.json`;
    await login(page);
    // A newer app on another PC migrates the folder and raises the minimum.
    await withMock(page, (m) => {
      const school = JSON.parse(m.peek('school.json') ?? '{}');
      m.externalWrite('school.json', { ...school, minAppVersion: '99.0.0' });
    });
    const before = await withMock(page, (m, f) => m.peek(f), file);
    await page.locator('.nav-btn[data-screen="toetsen"]').click();
    await examMenuItem(page, examId, 'Toets bewerken');
    await page.locator('#f-addq').click();
    await page.locator('#f-esave').click();
    await expect(page.locator('.toast-persistent')).toContainText(
      'Niet opgeslagen: deze versie van Maatwerk is te oud',
    );
    expect(await withMock(page, (m, f) => m.peek(f), file)).toBe(before);
  });
});
