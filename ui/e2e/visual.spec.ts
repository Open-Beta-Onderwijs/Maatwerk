// SPDX-License-Identifier: AGPL-3.0-or-later

// Visual regression of every screen and modal on the mock build (tiny
// fixture), for refactors that must not change the look (Step 3a: inline
// styles -> CSS classes). Local tool (Playwright project "visual"), not run in
// CI: the baseline images are machine-specific and not committed.
//
//   npm run test:visual -- --update-snapshots   # baseline before the change
//   npm run test:visual                         # compare after the change

import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const SETTLE = 1300; // Chart.js animations last 1000 ms

// Tall window: modals show most of their content without scrolling.
test.use({ viewport: { width: 1280, height: 2000 } });

async function screen(page: Page, name: string) {
  await page.locator(`.nav-btn[data-screen="${name}"]`).click();
  await page.waitForTimeout(400);
}

async function examMenu(page: Page, item: string, kind = ':not([data-kind="summary"])') {
  await screen(page, 'toetsen');
  await page.locator(`[data-action="exam-menu"]${kind}`).first().click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function shot(page: Page, name: string, target: 'page' | 'modal' = 'modal') {
  await page.waitForTimeout(SETTLE);
  const opts = { animations: 'disabled' as const, maxDiffPixels: 0 };
  if (target === 'modal')
    await expect(page.locator('#modal-box')).toHaveScreenshot(`${name}.png`, opts);
  else await expect(page).toHaveScreenshot(`${name}.png`, { ...opts, fullPage: true });
}

test('startup', async ({ page }) => {
  await page.goto('/');
  await page.locator('.subject-card[data-subject="nat"]').click();
  await shot(page, 'startup', 'page');
});

for (const name of ['leerlingen', 'groepen', 'toetsen', 'observaties', 'opdrachten']) {
  test(`screen ${name}`, async ({ page }) => {
    await login(page);
    await screen(page, name);
    await shot(page, `screen-${name}`, 'page');
  });
}

for (const name of ['leerlingen', 'groepen', 'gebruikers', 'school']) {
  test(`admin screen ${name}`, async ({ page }) => {
    await login(page, 'nat', 'admin');
    await screen(page, name);
    await shot(page, `admin-${name}`, 'page');
  });
}

// Admin-only screens and modals.
const ADMIN_MODALS: [string, (page: Page) => Promise<void>][] = [
  [
    'leerling-edit',
    async (p) => (
      await screen(p, 'leerlingen'),
      p.locator('[data-action="edit-student"]').first().click()
    ),
  ],
  [
    'leerling-csv-year',
    async (p) => (await screen(p, 'leerlingen'), p.locator('#btn-import-students').click()),
  ],
  [
    'groep-edit',
    async (p) => (
      await screen(p, 'groepen'),
      p.locator('[data-action="edit-group"]').first().click()
    ),
  ],
  [
    'groep-csv-year',
    async (p) => (await screen(p, 'groepen'), p.locator('#btn-import-groups').click()),
  ],
];

for (const [name, open] of ADMIN_MODALS) {
  test(`admin modal ${name}`, async ({ page }) => {
    await login(page, 'nat', 'admin');
    await open(page);
    await shot(page, `admin-modal-${name}`);
  });
}

test('modal gebruiker', async ({ page }) => {
  await login(page, 'nat', 'admin');
  await screen(page, 'gebruikers');
  await page.locator('[data-action="edit-user"]').nth(1).click();
  await shot(page, 'modal-gebruiker');
});

const MODALS: [string, (page: Page) => Promise<void>][] = [
  [
    'groep-leerlingen',
    async (p) => (
      await screen(p, 'groepen'),
      p.locator('[data-action="open-group"]').first().click()
    ),
  ],
  ['toets-new', async (p) => (await screen(p, 'toetsen'), p.locator('#btn-add-exam').click())],
  ['toets-edit', (p) => examMenu(p, 'Toets bewerken')],
  ['scores', (p) => examMenu(p, 'Scores invoeren')],
  ['rapport', (p) => examMenu(p, 'Rapport genereren')],
  ['opdrachten-genereren', (p) => examMenu(p, 'Opdrachten genereren')],
  ['herkansing', (p) => examMenu(p, 'Inhaal / herkansing toevoegen', '[data-kind="solo"]')],
  ['verzamelkaart', (p) => examMenu(p, 'Verzamelkaart bewerken', '[data-kind="summary"]')],
  [
    'rtti-uitleg',
    async (p) => (await screen(p, 'toetsen'), p.locator('#btn-toetsen-rtti-uitleg').click()),
  ],
  [
    'observatie-edit',
    async (p) => (
      await screen(p, 'observaties'),
      p.locator('[data-action="edit-obs"]').first().click()
    ),
  ],
  [
    'observatie-new',
    async (p) => (await screen(p, 'observaties'), p.locator('#btn-add-obs').click()),
  ],
  [
    'opdracht-edit',
    async (p) => (
      await screen(p, 'opdrachten'),
      p.locator('[data-action="edit-opdracht"]').first().click()
    ),
  ],
];

for (const [name, open] of MODALS) {
  test(`modal ${name}`, async ({ page }) => {
    await login(page);
    await open(page);
    await shot(page, `modal-${name}`);
  });
}

const OVERVIEW_TABS = [
  'resultaten',
  'cijferverdeling',
  'boxplots',
  'rtti-analyse',
  'vraaganalyse',
  'observaties',
];
for (const tab of OVERVIEW_TABS) {
  test(`modal toets-overzicht ${tab}`, async ({ page }) => {
    await login(page);
    await screen(page, 'toetsen');
    await page.locator('[data-action="exam-overview"]').first().click();
    await page.locator(`#modal-box [data-tab="${tab}"]`).click();
    await shot(page, `modal-overzicht-${tab}`);
  });
}

for (const tab of ['cijferverloop', 'analyse']) {
  test(`modal profiel ${tab}`, async ({ page }) => {
    await login(page);
    await screen(page, 'leerlingen');
    await page.locator('[data-action="profile"]').first().click();
    await page.locator(`#modal-box [data-tab="${tab}"]`).click();
    await shot(page, `modal-profiel-${tab}`);
  });
}

test('exam menu', async ({ page }) => {
  await login(page);
  await screen(page, 'toetsen');
  await page.locator('[data-action="exam-menu"]').first().click();
  await shot(page, 'exam-menu', 'page');
});

test('editor', async ({ page }) => {
  await login(page);
  await screen(page, 'opdrachten');
  await page.locator('[data-action="open-editor"]').first().click();
  await expect(page.frameLocator('#editor-frame').locator('.cm-content')).toBeVisible();
  await shot(page, 'editor', 'page');
});
