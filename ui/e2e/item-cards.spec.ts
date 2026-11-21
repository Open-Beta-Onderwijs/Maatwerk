// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 34a: Observaties and Opdrachten as cards (F-28, spec 4.16, 4.17): the count follows the
// filters, the ⋮ actions, and a click on an Observatie card opens Observatie bewerken.

import { expect, test } from '@playwright/test';
import { cardMenu, login, watchErrors } from './helpers';

const count = (page: import('@playwright/test').Page, row: string) =>
  page.locator(`#filter-row-${row} .filter-count`);

test('Observaties: cards, the count follows the filter, a click opens the edit modal', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  await page.locator('.nav-btn[data-screen="observaties"]').click();
  const cards = page.locator('#obs-list .icard');
  const all = await cards.count();
  expect(all).toBeGreaterThan(4);
  await expect(count(page, 'observaties')).toHaveText(`${all} observaties`);

  await page.locator('#btn-filter-toetstype').click();
  await page.getByRole('radio', { name: 'PO', exact: true }).click();
  await expect(cards).toHaveCount(4);
  await expect(count(page, 'observaties')).toHaveText('4 observaties');
  await page.locator('#btn-filter-toetstype').click();
  await page.getByRole('radio', { name: 'Alle toetstypes' }).click();
  await expect(cards).toHaveCount(all);

  // Every card has six jaarlaag boxes and says where it is used.
  await expect(cards.first().locator('.icard-jl')).toHaveCount(6);
  await expect(cards.first().locator('.icard-use').first()).toHaveText(
    /^(\d+ toetsen?|geen toetsen|nog niet gebruikt)$/,
  );

  // A click on the card body (not the title) opens Observatie bewerken.
  const naam = (await cards.first().locator('.icard-title').textContent())!.trim();
  await cards.first().locator('.icard-desc').click();
  await expect(page.locator('.dlg.modal-obs-edit')).toBeVisible();
  await expect(page.locator('#f-onam')).toHaveValue(naam);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg.modal-obs-edit')).toHaveCount(0);

  // ⋮ Bewerken opens it too.
  await cardMenu(cards.first(), 'Bewerken');
  await expect(page.locator('#f-onam')).toHaveValue(naam);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('Observaties: an unused observatie is deleted from its ⋮ menu after a confirm', async ({
  page,
}) => {
  await login(page);
  await page.locator('.nav-btn[data-screen="observaties"]').click();
  const unused = page.locator('#obs-list .icard', { hasText: 'nog niet gebruikt' });
  const before = await page.locator('#obs-list .icard').count();
  // "nog niet gebruikt" means no test of this year and no opdracht; another year or a rubric may
  // still hold it, so pick the first one whose Verwijderen is enabled.
  const n = await unused.count();
  let deleted = false;
  for (let i = 0; i < n && !deleted; i++) {
    await unused.nth(i).getByRole('button', { name: 'Meer acties' }).click();
    const item = page.getByRole('menuitem', { name: 'Verwijderen' });
    if ((await item.getAttribute('aria-disabled')) === 'true') {
      await page.keyboard.press('Escape');
      continue;
    }
    await item.click();
    await page.locator('.dlg--confirm').getByRole('button', { name: 'Verwijderen' }).click();
    deleted = true;
  }
  expect(deleted).toBe(true);
  await expect(page.locator('#obs-list .icard')).toHaveCount(before - 1);
  await expect(count(page, 'observaties')).toHaveText(`${before - 1} observaties`);
});

test('Opdrachten: cards with the ⋮ actions; Kopiëren adds a card', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  const cards = page.locator('#opdracht-list .icard');
  const all = await cards.count();
  expect(all).toBeGreaterThan(1);
  await expect(count(page, 'opdrachten')).toHaveText(`${all} opdrachten`);

  await cards.first().getByRole('button', { name: 'Meer acties' }).click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Openen in de editor',
    'Bewerken',
    'Kopiëren',
    'Afdrukken',
    'Verwijderen',
  ]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await cardMenu(cards.first(), 'Kopiëren');
  await expect(cards).toHaveCount(all + 1);
  await expect(count(page, 'opdrachten')).toHaveText(`${all + 1} opdrachten`);

  await cardMenu(cards.first(), 'Openen in de editor');
  await expect(page.frameLocator('#editor-frame').locator('.cm-content')).toBeVisible();
  expect(errors).toEqual([]);
});
