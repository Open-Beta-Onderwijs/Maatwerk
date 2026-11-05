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

test.describe('tab bar (spec 3.5, V-05, V-12)', () => {
  const visibleTabs = (page: import('@playwright/test').Page) =>
    page.locator('#main-nav .nav-btn:not(.hidden)');

  test('a teacher sees five tabs with icons; the active one is marked', async ({ page }) => {
    await login(page);
    await expect(visibleTabs(page)).toHaveText([
      'Leerlingen',
      'Groepen',
      'Toetsen',
      'Observaties',
      'Opdrachten',
    ]);
    await expect(visibleTabs(page).locator('svg.nav-icon')).toHaveCount(5);
    await page.locator('.nav-btn[data-screen="toetsen"]').click();
    await expect(page.locator('.nav-btn[aria-current="page"]')).toHaveText('Toetsen');
    await expect(page.locator('#topbar')).toHaveCSS('height', '56px');
    // Logo: the light variant shows in the light theme.
    await expect(page.locator('.app-brand .brand-word.theme-light-only')).toBeVisible();
    await expect(page.locator('.app-brand .brand-word.theme-dark-only')).toBeHidden();
  });

  test('the admin sees seven tabs', async ({ page }) => {
    await login(page, 'nat', 'admin');
    await expect(visibleTabs(page)).toHaveText([
      'Leerlingen',
      'Groepen',
      'Opdrachten',
      'Gebruikers',
      'School',
      'Gegevenscontrole',
      'Instellingen',
    ]);
    await expect(visibleTabs(page).locator('svg.nav-icon')).toHaveCount(7);
  });
});
