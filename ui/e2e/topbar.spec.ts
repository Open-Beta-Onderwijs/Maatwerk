// SPDX-License-Identifier: AGPL-3.0-or-later

// The top bar (spec 3.5): it stays in view while a long screen scrolls, and on a narrow window the
// wordmark makes way for the tabs (user 2026-11-10).

import { expect, test, type Page } from '@playwright/test';
import { login, readMockJson, seedFiles, YEAR } from './helpers';
import { screen } from './views';

const STUDENTS = `${YEAR}/students-${YEAR}.json`;

interface StudentsFile {
  students: Record<string, unknown>[];
}

/** 150 extra students: a Leerlingen list much taller than the window. */
async function seedManyStudents(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.subject-card').first()).toBeVisible();
  const file = await readMockJson<StudentsFile>(page, STUDENTS);
  const base = file.students[0]!;
  const extra = Array.from({ length: 150 }, (_, i) => ({
    ...base,
    id: String(990000 + i),
    voornaam: 'Extra',
    achternaam: `Leerling ${String(i).padStart(3, '0')}`,
  }));
  await seedFiles(page, { [STUDENTS]: { ...file, students: [...file.students, ...extra] } });
}

test('the top bar stays at the top while Leerlingen scrolls', async ({ page }) => {
  await seedManyStudents(page);
  await login(page);
  await screen(page, 'leerlingen');
  await expect(page.locator('#student-list .card').nth(100)).toBeAttached();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(2000);
  const box = await page.locator('#topbar').boundingBox();
  expect(box?.y).toBe(0);
  await expect(page.locator('#topbar .nav-btn[data-screen="toetsen"]')).toBeInViewport();
});

const wordmark = (page: Page) => page.locator('#topbar .brand-word:visible');

test('a narrow window hides the wordmark, the logo stays', async ({ page }) => {
  await login(page);
  await expect(wordmark(page)).toHaveCount(1);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(wordmark(page)).toHaveCount(0);
  await expect(page.locator('#topbar .brand-icon:visible')).toHaveCount(1);
  // Every tab fits again.
  const fits = await page
    .locator('#main-nav')
    .evaluate((nav) => nav.scrollWidth <= nav.clientWidth);
  expect(fits).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(wordmark(page)).toHaveCount(1);
});

const navFits = (page: Page) =>
  page.locator('#main-nav').evaluate((nav) => nav.scrollWidth <= nav.clientWidth);

test('still too narrow: inactive tabs show only their icon, the active tab its name', async ({
  page,
}) => {
  await login(page, 'nat', 'admin');
  await page.locator('.nav-btn[data-screen="groepen"]').click();
  const groepen = page.locator('.nav-btn[data-screen="groepen"] span');
  const gebruikers = page.locator('.nav-btn[data-screen="gebruikers"]');
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(wordmark(page)).toHaveCount(0);
  expect(await navFits(page)).toBe(true);
  // The active tab keeps its name; an inactive one shows its icon, its name a tooltip and the
  // accessible name.
  await expect(groepen).toBeVisible();
  expect((await groepen.boundingBox())?.width ?? 0).toBeGreaterThan(20);
  const label = await gebruikers.locator('span').boundingBox();
  expect(label?.width ?? 0).toBeLessThanOrEqual(1);
  await expect(gebruikers).toHaveAttribute('title', 'Gebruikers');
  await expect(gebruikers).toHaveAccessibleName('Gebruikers');
  // Back to wide: every name returns, no tooltips.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(gebruikers.locator('span')).toBeVisible();
  expect((await gebruikers.locator('span').boundingBox())?.width ?? 0).toBeGreaterThan(20);
  await expect(gebruikers).not.toHaveAttribute('title', /./);
});

test('a teacher at 900 px keeps every tab name', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(wordmark(page)).toHaveCount(0);
  expect(await navFits(page)).toBe(true);
  await expect(page.locator('#topbar.topbar--icons')).toHaveCount(0);
});
