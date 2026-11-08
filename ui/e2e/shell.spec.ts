// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 15 (Shell): minimum app version (PLAN-2 decision 5), tab bar, user menu,
// look per user. Every page load starts a fresh MockApi.

import { expect, test } from '@playwright/test';
import {
  TEACHER,
  YEAR,
  enterPin,
  examMenuItem,
  login,
  logout,
  readMockJson,
  seedFiles,
  withMock,
} from './helpers';
import { EXAMS, openGrid, select } from './grid-driver';

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
    await expect(banner).toContainText('deze versie: 0.9.0');
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

test.describe('avatar (B-04, B-08)', () => {
  // The fixture's nat teacher has a photo (afbeeldingen/...); the biology teacher does not.
  test('the same photo on the login screen, in the top bar and in the editor', async ({ page }) => {
    await page.goto('/');
    await page.locator('.subject-card[data-subject="nat"]').click();
    const loginBadge = page.locator(`.user-badge[data-user-id="${TEACHER}"] .avatar`);
    await expect(loginBadge.locator('img.avatar-photo')).toBeVisible();
    await expect(loginBadge).toHaveClass(/avatar--56/);
    await expect(loginBadge).toHaveClass(/avatar--round/);

    await login(page);
    const top = page.locator('#user-badge-btn');
    await expect(top.locator('img.avatar-photo')).toBeVisible();
    await expect(top).toHaveClass(/avatar--38/);
    await expect(top).toHaveCSS('width', '38px');
    await expect(top).toHaveClass(/avatar--ring-accent/);

    await page.locator('.nav-btn[data-screen="opdrachten"]').click();
    await page.locator('[data-action="open-editor"]').first().click();
    const editorBadge = page.frameLocator('#editor-frame').locator('#editor-badge-btn');
    await expect(editorBadge.locator('img.avatar-photo')).toBeVisible();
    await expect(editorBadge).toHaveClass(/avatar--30/);
  });

  test('without a photo: initials; the admin is square', async ({ page }) => {
    await page.goto('/');
    await page.locator('.subject-card[data-subject="bio"]').click();
    const avatars = page.locator('.user-badge .avatar');
    await expect(avatars.first()).toBeVisible();
    const admin = page.locator('.user-badge[data-user-id="admin"] .avatar');
    await expect(admin).toHaveClass(/avatar--square/);
    await expect(admin.locator('.avatar-initials')).toHaveText('ADM');
    await expect(admin.locator('img')).toHaveCount(0);
  });
});

test.describe('user menu (F-17) and look per user (F-18, F-21)', () => {
  const USER_FILE = `gebruikers/${TEACHER}.json`;
  type User = { preferences?: Record<string, unknown> };
  const html = (page: import('@playwright/test').Page) => page.locator('html');

  async function openMenu(page: import('@playwright/test').Page) {
    await page.locator('#user-badge-btn').click();
    await expect(page.locator('#user-menu')).toBeVisible();
  }

  test('a dropdown under the avatar, not a dialog; Escape closes it', async ({ page }) => {
    await login(page);
    await openMenu(page);
    const menu = page.locator('#user-menu');
    await expect(page.locator('.dlg')).toHaveCount(0);
    await expect(menu.locator('.user-menu__name')).toHaveText('Docent van Natuur');
    await expect(menu.locator('.user-menu__role')).toHaveText('Docent · Natuurkunde');
    await expect(menu.locator('.accent-swatch')).toHaveCount(21);
    await expect(menu.locator('#acc-photo')).toBeDisabled();
    await expect(menu.locator('#acc-codes')).toHaveCount(0); // admin only
    await expect(page.locator('#user-badge-btn')).toHaveAttribute('aria-expanded', 'true');
    const box = (await menu.boundingBox())!;
    expect(box.width).toBe(280);
    expect(box.y).toBeGreaterThanOrEqual(56);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('#user-badge-btn')).toBeFocused();
    // A click outside closes it too.
    await openMenu(page);
    await page.locator('h2').first().click();
    await expect(menu).toHaveCount(0);
  });

  test('theme and accent apply at once and persist across logout', async ({ page }) => {
    await login(page);
    await openMenu(page);
    await page.locator('#user-menu [data-theme-choice="dark"]').click();
    await page.locator('#user-menu [data-accent-choice="groen"]').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(html(page)).toHaveAttribute('data-accent', 'groen');
    await expect(page.locator('#user-menu [data-accent-choice="groen"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(async () => {
      const user = await readMockJson<User>(page, USER_FILE);
      expect(user.preferences).toMatchObject({ theme: 'dark', accent: 'groen' });
    }).toPass();

    await logout(page);
    // The login screen is in the base look again.
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(html(page)).toHaveAttribute('data-accent', 'blauw');
    await page.locator('.subject-card[data-subject="nat"]').click();
    await page.locator(`.user-badge[data-user-id="${TEACHER}"]`).click();
    await enterPin(page);
    await expect(page.locator('#topbar')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(html(page)).toHaveAttribute('data-accent', 'groen');
  });

  test('the look and active year follow the teacher to a second PC', async ({ page }) => {
    // PC 1: choose the look; its user file is what OneDrive brings to PC 2.
    await login(page);
    await openMenu(page);
    await page.locator('#user-menu [data-theme-choice="dark"]').click();
    await page.locator('#user-menu [data-accent-choice="marine"]').click();
    await expect(async () => {
      const u = await readMockJson<User>(page, USER_FILE);
      expect(u.preferences?.accent).toBe('marine');
    }).toPass();
    const synced = await readMockJson<User>(page, USER_FILE);

    // PC 2: a fresh app on a copy of the data with that user file.
    await seedFiles(page, {
      [USER_FILE]: { ...synced, preferences: { ...synced.preferences, activeYear: '2024-2025' } },
    });
    await page.goto('/');
    await expect(html(page)).toHaveAttribute('data-theme', 'light'); // before login
    await page.locator('.subject-card[data-subject="nat"]').click();
    await page.locator(`.user-badge[data-user-id="${TEACHER}"]`).click();
    await enterPin(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(html(page)).toHaveAttribute('data-accent', 'marine');
    for (const [screen, select] of [
      ['leerlingen', '#student-year-select'],
      ['groepen', '#groups-year-select'],
      ['toetsen', '#toetsen-year-select'],
    ] as const) {
      await page.locator(`.nav-btn[data-screen="${screen}"]`).click();
      await expect(page.locator(`${select} .csel-trigger`)).toContainText('2024-2025');
    }

    // Choosing a year on one screen makes it the active year everywhere, and saves it.
    await page.locator('#toetsen-year-select .csel-trigger').click();
    await page.locator('#toetsen-year-select [data-value="2025-2026"]').click();
    await page.locator('.nav-btn[data-screen="groepen"]').click();
    await expect(page.locator('#groups-year-select .csel-trigger')).toContainText('2025-2026');
    await expect(async () => {
      const u = await readMockJson<User>(page, USER_FILE);
      expect(u.preferences).toMatchObject({
        theme: 'dark',
        accent: 'marine',
        activeYear: '2025-2026',
      });
    }).toPass();
  });

  test('an admin change to the user meanwhile is kept (merge, no conflict)', async ({ page }) => {
    await login(page);
    // An admin on another PC renames the teacher.
    await withMock(
      page,
      (m, f) => {
        const u = JSON.parse(m.peek(f) ?? '{}');
        m.externalWrite(f, {
          ...u,
          afkorting: 'NAT',
          _meta: { ...u._meta, rev: (u._meta?.rev ?? 0) + 1 },
        });
      },
      USER_FILE,
    );
    await openMenu(page);
    await page.locator('#user-menu [data-accent-choice="paars"]').click();
    await expect(async () => {
      const u = await readMockJson<User & { afkorting: string }>(page, USER_FILE);
      expect(u.afkorting).toBe('NAT');
      expect(u.preferences?.accent).toBe('paars');
    }).toPass();
    await expect(page.locator('.toast-persistent')).toHaveCount(0);
  });

  test('the admin menu has Nieuwe herstelcodes and says Beheerder', async ({ page }) => {
    await login(page, 'nat', 'admin');
    await openMenu(page);
    await expect(page.locator('#user-menu .user-menu__role')).toHaveText('Beheerder');
    await expect(page.locator('#acc-codes')).toBeVisible();
    await expect(page.locator('#user-menu .avatar')).toHaveClass(/avatar--square/);
  });
});

test.describe('read-only while running (review 15 M1, M2)', () => {
  async function raiseMinimum(page: import('@playwright/test').Page) {
    await withMock(page, (m) => {
      const school = JSON.parse(m.peek('school.json') ?? '{}');
      m.externalWrite('school.json', { ...school, minAppVersion: '99.0.0' });
    });
  }

  test('a refused score save shows the read-only text and the banner', async ({ page }) => {
    await openGrid(page, EXAMS.empty); // logs in
    await raiseMinimum(page);
    await select(page, 0, 2); // first question of the empty exam
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('.toast-persistent').first()).toContainText(
      'Niet opgeslagen: deze versie van Maatwerk is te oud',
    );
    await expect(page.locator('.toast-persistent')).not.toContainText('read_only');
    await expect(page.locator('#read-only-banner')).toBeVisible();
  });

  test('a user without a PIN cannot choose one when read-only, and is told why', async ({
    page,
  }) => {
    await seedFiles(page, { 'school.json': await schoolWith(page, '99.0.0') });
    await page.goto('/');
    await expect(page.locator('#read-only-banner')).toBeVisible();
    await page.locator('.subject-card[data-subject="nat"]').click();
    await page.locator('.user-badge[data-user-id="admin"]').click();
    // The admin has no PIN in the fixture: choosing one is a write, refused with the clear text.
    await page.locator('#pin-new').fill('24680');
    await page.locator('#pin-repeat').fill('24680');
    await page.locator('#pin-ok').click();
    await expect(page.locator('.pin-error')).toContainText('Niet opgeslagen');
  });

  test('a year or accent change while read-only applies on screen without errors', async ({
    page,
  }) => {
    await login(page);
    await raiseMinimum(page);
    // The first refused write turns the app read-only (here: a look change).
    await page.locator('#user-badge-btn').click();
    await page.locator('#user-menu [data-accent-choice="groen"]').click();
    await expect(page.locator('#read-only-banner')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'groen');
    await page.locator('#user-menu [data-accent-choice="paars"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'paars');
    await page.keyboard.press('Escape');
    await page.locator('.nav-btn[data-screen="toetsen"]').click();
    await expect(page.locator('#toetsen-year-select .csel-trigger')).toBeVisible();
    await page.locator('#toetsen-year-select .csel-trigger').click();
    await page.locator('#toetsen-year-select [data-value]').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('.toast-persistent')).toHaveCount(0);
  });
});
