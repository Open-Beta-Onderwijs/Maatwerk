// SPDX-License-Identifier: AGPL-3.0-or-later

// The dialog component (step 14, R-02, design spec 3.3): every modal opens at
// the same top, Escape closes, stacked dialogs keep their close guard, and a
// modal with lazy content does not change size while loading.

import { expect, test, type Page } from '@playwright/test';
import { readMockJson, withMock, YEAR } from './helpers';
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

for (const v of VIEWS.filter((x) => x.target === 'modal')) {
  test(`${v.name}: footer has the primary action last`, async ({ page }) => {
    await openView(page, v);
    const buttons = topDialog(page).locator('.dlg-footer > button');
    const n = await buttons.count();
    const primaries = await topDialog(page).locator('.dlg-footer > .btn--primary').count();
    if (n === 0 || primaries === 0) return;
    expect(primaries).toBe(1);
    await expect(buttons.nth(n - 1)).toHaveClass(/btn--primary/);
  });
}

test('a profile opened from a group overview stacks on it; closing returns there', async ({
  page,
}) => {
  await openView(page, view('modal-groep-leerlingen'));
  const overview = topDialog(page);
  const title = await overview.locator('.dlg-title').textContent();
  await overview.locator('[data-action="open-student-from-group"]').first().click();
  await expect(page.locator('.dlg')).toHaveCount(2);
  await expect(topDialog(page).locator('[data-tab="analyse"]')).toBeVisible();
  // Vorige/Volgende replace the profile, they do not stack.
  await topDialog(page).locator('#prof-next').click();
  await expect(page.locator('.dlg')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg')).toHaveCount(1);
  await expect(topDialog(page).locator('.dlg-title')).toHaveText(title!);
});

test.describe('form rules (spec 3.7, 3.9)', () => {
  for (const name of ['modal-toets-new', 'modal-toets-edit', 'modal-verzamelkaart']) {
    test(`${name}: labels in a row share one top`, async ({ page }) => {
      await openView(page, view(name));
      const rows = topDialog(page).locator('.form-row');
      for (let r = 0; r < (await rows.count()); r++) {
        const labels = rows.nth(r).locator(':scope > .form-group > label');
        const tops = new Set<number>();
        for (let i = 0; i < (await labels.count()); i++) {
          const box = await labels.nth(i).boundingBox();
          if (box) tops.add(Math.round(box.y));
        }
        expect([...tops].length, `row ${r}`).toBeLessThanOrEqual(1);
      }
    });
  }

  test('the PTA tick box is 36×36 and toggles aria-pressed', async ({ page }) => {
    await openView(page, view('modal-toets-new'));
    const box = page.locator('#f-epta-btn');
    expect(await box.boundingBox()).toMatchObject({ width: 36, height: 36 });
    await expect(box).toHaveAttribute('aria-pressed', 'false');
    await expect(box).toHaveAttribute('title', /Programma van Toetsing/);
    await box.click();
    await expect(box).toHaveAttribute('aria-pressed', 'true');
    await expect(box).toHaveAttribute('data-checked', 'true');
  });
});

test.describe('review 14 fixes', () => {
  test('M2: opening moves focus into the dialog; Enter does not open a second one', async ({
    page,
  }) => {
    await openView(page, view('modal-observatie-new'));
    await expect(page.locator('.dlg')).toHaveCount(1);
    expect(await page.evaluate(() => !!document.activeElement?.closest('.dlg'))).toBe(true);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator('.dlg')).toHaveCount(1);
  });

  test('M2: Tab stays inside the dialog', async ({ page }) => {
    await openView(page, view('modal-observatie-new'));
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.dlg'))).toBe(true);
    }
  });

  test('M3: arrow keys move between dialog tabs', async ({ page }) => {
    await openView(page, view('modal-overzicht-resultaten'));
    const tabs = topDialog(page).locator('[role="tab"]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('M1 + m1: a colleague change to a covered group overview waits; its notice reloads that overview', async ({
    page,
  }) => {
    await openView(page, view('screen-groepen'));
    const id = await page.locator('[data-action="open-group"]').first().getAttribute('data-id');
    await page.locator('[data-action="open-group"]').first().click();
    await topDialog(page).locator('[data-action="open-student-from-group"]').first().click();
    await expect(page.locator('.dlg')).toHaveCount(2);

    // A colleague edits the group while the profile covers the overview.
    const file = `${YEAR}/groups/${id}.json`;
    const group = await readMockJson<Record<string, unknown>>(page, file);
    await withMock(page, (m, [p, d]) => m.externalWrite(p as string, d as never), [
      file,
      { ...group, docenten: [] },
    ]);
    await page.waitForTimeout(500);
    await expect(page.locator('#reload-notice')).toHaveCount(0);

    // Back on the overview: now the notice; Escape and the backdrop do not dismiss it.
    await page.keyboard.press('Escape');
    const notice = page.locator('#reload-notice');
    await expect(notice).toBeVisible();
    await page.mouse.click(5, 5);
    await page.keyboard.press('Escape');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('.dlg')).toHaveCount(1);
    await expect(
      topDialog(page).locator('[data-action="open-student-from-group"]').first(),
    ).toBeVisible();
  });
});

test('a modal without actions shows no footer', async ({ page }) => {
  await openView(page, view('modal-scores'));
  await expect(topDialog(page).locator('.dlg-footer')).toBeHidden();
});
