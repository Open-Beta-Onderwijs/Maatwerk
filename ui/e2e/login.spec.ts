// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 26: the splash (F-06) and the login screen (V-04, design spec 4.1-4.2):
// stages, the avatar flight and its reverse, the inline PIN, keyboard flow and
// the reduced-motion fallback. Every page load starts a fresh MockApi.

import { expect, test, type Page } from '@playwright/test';
import { PIN, TEACHER, enterPin, logout } from './helpers';

const stage = (page: Page) => page.locator('.login');
const tile = (page: Page, vak: string) => page.locator(`.login-tile[data-subject="${vak}"]`);
const badge = (page: Page, id = TEACHER) => page.locator(`.user-badge[data-user-id="${id}"]`);
/** The avatar has landed: "Andere gebruiker" and Escape wait for that (review 26-28 m1). */
const landed = (page: Page) =>
  page.waitForFunction(() => document.querySelector('.login-hero')?.getAnimations().length === 0);

test('the splash shows the version and is gone once the vak tiles are there', async ({
  page,
  request,
}) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('id="splash"');
  expect(html).toMatch(/versie \d+\.\d+\.\d+/);
  expect(html).not.toContain('%MAATWERK_VERSION%');
  await page.goto('/');
  await expect(tile(page, 'nat')).toBeVisible();
  await expect(page.locator('#splash')).toHaveCount(0);
});

test('choosing a vak moves the tiles up and shows its users per group', async ({ page }) => {
  await page.goto('/');
  await expect(stage(page)).toHaveAttribute('data-stage', 'start');
  await expect(page.locator('.login-mark-hint')).toHaveText('Kies je vak');
  await expect(tile(page, 'nat')).toHaveCSS('width', '200px');

  await tile(page, 'nat').click();
  await expect(stage(page)).toHaveAttribute('data-stage', 'vak');
  await expect(tile(page, 'nat')).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page, 'nat')).toHaveCSS('width', '112px');
  await expect(page.locator('.login-group-label')).toContainText(['DOCENTEN', 'BEHEER']);
  await expect(badge(page).locator('.avatar')).toHaveClass(/avatar--round/);
  await expect(badge(page, 'admin').locator('.avatar')).toHaveClass(/avatar--square/);

  // The chosen tile again: back to the start.
  await tile(page, 'nat').click();
  await expect(stage(page)).toHaveAttribute('data-stage', 'start');
  await expect(tile(page, 'nat')).toHaveAttribute('aria-pressed', 'false');
});

test('a chosen user gets the PIN block inline; "Andere gebruiker" goes back', async ({ page }) => {
  await page.goto('/');
  await tile(page, 'nat').click();
  await badge(page).click();
  await expect(stage(page)).toHaveAttribute('data-stage', 'user');
  await expect(page.locator('.login-hero')).toHaveClass(/avatar--152/);
  await expect(page.locator('.login-pin-role')).toHaveText('Docent · Natuurkunde');
  // First login: two fields, focused, in the space reserved for them.
  await expect(page.locator('#pin-new')).toBeFocused();
  await expect(page.locator('#pin-repeat')).toBeVisible();
  await expect(page.locator('#pin-ok')).toHaveText('Pincode opslaan en inloggen');
  const fields = await page.locator('.login-pin-fields').boundingBox();
  expect(fields!.height).toBeGreaterThanOrEqual(168);
  await expect(page.locator('.dlg')).toHaveCount(0);

  await landed(page);
  await page.getByRole('button', { name: 'Andere gebruiker' }).click();
  await expect(stage(page)).toHaveAttribute('data-stage', 'vak');
  await expect(page.locator('.login-pin')).toBeHidden();
  await expect(badge(page)).toBeFocused();
  await expect(badge(page).locator('.avatar')).toBeVisible();
});

test('keyboard: Enter on a tile and a user, Escape back out, Enter logs in', async ({ page }) => {
  await page.goto('/');
  await tile(page, 'nat').focus();
  await page.keyboard.press('Enter');
  await expect(stage(page)).toHaveAttribute('data-stage', 'vak');
  await expect(page.locator('.login-user').first()).toBeFocused();

  await badge(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pin-new')).toBeFocused();
  await landed(page);
  await page.keyboard.press('Escape');
  await expect(stage(page)).toHaveAttribute('data-stage', 'vak');
  await expect(badge(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(stage(page)).toHaveAttribute('data-stage', 'start');
  await expect(tile(page, 'nat')).toBeFocused();

  await page.keyboard.press('Enter');
  await badge(page).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type(PIN);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PIN);
  await page.keyboard.press('Enter');
  await expect(page.locator('#topbar')).toBeVisible();
});

test('the last vak is chosen already; a known PIN is one field', async ({ page }) => {
  await page.goto('/');
  await tile(page, 'nat').click();
  await badge(page).click();
  await enterPin(page);
  await logout(page);
  await expect(stage(page)).toHaveAttribute('data-stage', 'vak');
  await badge(page).click();
  await expect(page.locator('#pin-input')).toBeFocused();
  await expect(page.locator('#pin-new')).toHaveCount(0);
  await expect(page.locator('.login-pin-hint')).toContainText('Vraag de beheerder');
  await page.locator('#pin-input').fill(PIN);
  await page.locator('#pin-input').press('Enter');
  await expect(page.locator('#topbar')).toBeVisible();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the flight becomes a fade and the login still works', async ({ page }) => {
    await page.goto('/');
    await tile(page, 'nat').click();
    await badge(page).click();
    const moving = await page
      .locator('.login-hero')
      .evaluate((el) =>
        el
          .getAnimations()
          .some((a) =>
            ((a.effect as KeyframeEffect | null)?.getKeyframes() ?? []).some(
              (k) => 'transform' in k,
            ),
          ),
      );
    expect(moving).toBe(false);
    await enterPin(page);
    await expect(page.locator('#topbar')).toBeVisible();
  });
});
