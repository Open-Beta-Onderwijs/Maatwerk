// SPDX-License-Identifier: AGPL-3.0-or-later

// The dialog component (step 14, R-02, design spec 3.3): every modal opens at
// the same top, Escape closes, stacked dialogs keep their close guard, and a
// modal with lazy content does not change size while loading.

import { expect, test, type Page } from '@playwright/test';
import { VIEWS, openView } from './views';

const TOP = 64;

const topDialog = (page: Page) => page.locator('.dlg').last();

const view = (name: string) => {
  const v = VIEWS.find((x) => x.name === name);
  if (!v) throw new Error(`no view ${name}`);
  return v;
};

for (const v of VIEWS.filter((x) => x.target === 'modal')) {
  test(`${v.name} opens at the fixed top`, async ({ page }) => {
    await openView(page, v);
    const box = await topDialog(page).boundingBox();
    expect(box?.y).toBe(TOP);
    // Centred horizontally (1 px rounding).
    const vw = page.viewportSize()!.width;
    expect(Math.abs(box!.x + box!.width / 2 - vw / 2)).toBeLessThanOrEqual(1);
  });
}

test('Escape closes a modal without changes', async ({ page }) => {
  await openView(page, view('modal-overzicht-resultaten'));
  await expect(page.locator('.dlg')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg')).toHaveCount(0);
});

test('Escape closes an open dropdown first, not the modal around it', async ({ page }) => {
  await openView(page, view('admin-modal-leerling-csv-year'));
  await page.locator('.dlg .csel-trigger').click();
  await expect(page.locator('.csel--open')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.csel--open')).toHaveCount(0);
  await expect(page.locator('.dlg')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg')).toHaveCount(0);
});

test('stacked dialogs: the guard question stacks, Escape closes only the top one', async ({
  page,
}) => {
  await openView(page, view('modal-rtti-uitleg'));
  const modal = page.locator('.dlg').first();
  await modal.locator('textarea').first().fill('Gewijzigde uitleg');

  // Escape on a dirty modal asks first: the question stacks on top.
  await page.keyboard.press('Escape');
  const ask = page.locator('.dlg--confirm');
  await expect(ask).toContainText('onopgeslagen wijzigingen');
  await expect(page.locator('.dlg')).toHaveCount(2);
  const askBox = await ask.boundingBox();
  expect(askBox?.y).toBe(TOP);

  // Escape closes the question only; the modal and its guard stay.
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(modal).toBeVisible();

  // A click next to it asks again; the guard still holds.
  await page.mouse.click(5, page.viewportSize()!.height - 5);
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Annuleren' }).click();
  await expect(modal).toBeVisible();

  // The close button asks too; confirming closes both.
  await modal.getByRole('button', { name: 'Sluiten' }).first().click();
  await ask.getByRole('button', { name: 'Sluiten zonder opslaan' }).click();
  await expect(page.locator('.dlg')).toHaveCount(0);
});

test('a lazy modal keeps its size while loading and across tabs', async ({ page }) => {
  await openView(page, view('modal-rapport'));
  const dlg = topDialog(page);
  const loading = await dlg.boundingBox();
  // The fixed height is the maximum: viewport minus 96 px.
  expect(loading?.height).toBe(page.viewportSize()!.height - 96);
  await expect(dlg.locator('iframe.rapport-pdf-frame')).toBeVisible();
  expect(await dlg.boundingBox()).toEqual(loading);
  await page.keyboard.press('Escape');

  await page.locator('[data-action="exam-overview"]').first().click();
  const overview = topDialog(page);
  const first = await overview.boundingBox();
  for (const tab of ['cijferverdeling', 'boxplots', 'vraaganalyse', 'resultaten']) {
    await overview.locator(`[data-tab="${tab}"]`).click();
    expect(await overview.boundingBox()).toEqual(first);
  }
});

test.describe('sticky screen headers', () => {
  // Short window, so every list scrolls.
  test.use({ viewport: { width: 1280, height: 320 } });
  for (const name of ['leerlingen', 'groepen', 'toetsen', 'observaties', 'opdrachten']) {
    test(`${name}: title row stays under the top bar`, async ({ page }) => {
      await openView(page, view(`screen-${name}`));
      const head = page.locator(`#screen-${name} .screen-head`);
      await page.mouse.move(640, 300);
      await page.mouse.wheel(0, 2000);
      await expect
        .poll(() => page.evaluate(() => document.scrollingElement!.scrollTop))
        .toBeGreaterThan(0);
      const box = await head.boundingBox();
      expect(box?.y).toBe(50); // #topbar height
      await expect(head.locator('h2')).toBeInViewport();
    });
  }
});
