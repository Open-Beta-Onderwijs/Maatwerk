// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 34a: Observaties and Opdrachten as cards (F-28, spec 4.16, 4.17): the count follows the
// filters, the ⋮ actions, and a click on an Observatie card opens Observatie bewerken.

import { expect, test } from '@playwright/test';
import { cardMenu, login, watchErrors, withMock } from './helpers';

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

// Step 34b: the preview panel (spec 4.17, board 58).
test.describe('Opdracht preview', () => {
  type Call = [string, ...unknown[]];
  const renders = (page: import('@playwright/test').Page) =>
    withMock(page, (m) =>
      (m.calls as Call[]).filter((c) => c[0] === 'renderAssignmentSvg').map((c) => c[1]),
    );

  test('open, switch, close; pages rendered once per opdracht', async ({ page }) => {
    const errors = watchErrors(page);
    await login(page);
    await page.locator('.nav-btn[data-screen="opdrachten"]').click();
    const cards = page.locator('#opdracht-list .icard');
    const panel = page.getByRole('region', { name: 'Voorbeeld van de opdracht' });
    const first = cards.nth(0);
    const second = cards.nth(1);
    const id1 = (await first.getAttribute('data-opd-card'))!;
    const id2 = (await second.getAttribute('data-opd-card'))!;
    const naam1 = (await first.locator('.icard-title').textContent())!.trim();

    await first.locator('.icard-desc').click();
    await expect(panel).toBeVisible();
    await expect(panel.locator('.opd-preview-name')).toHaveText(naam1);
    await expect(panel.locator('img.opd-page')).toHaveCount(1);
    await expect(panel.locator('.opd-preview-page')).toHaveText('Pagina 1 van 1');
    await expect(panel.locator('.opd-preview-meta')).toHaveText(/ · 1 pagina$/);
    await expect(first).toHaveClass(/icard--selected/);
    await expect(first.locator('.icard-title')).toHaveAttribute('aria-expanded', 'true');
    // The cards move to two columns in the left half.
    await expect
      .poll(async () => (await second.boundingBox())!.x - (await first.boundingBox())!.x)
      .toBeLessThan(((await page.locator('#opdracht-list').boundingBox())!.width / 2) * 0.6);

    // Another card switches the preview in place; back to the first uses the cache.
    await second.locator('.icard-title').click();
    await expect(panel.locator('.opd-preview-name')).not.toHaveText(naam1);
    await expect(second).toHaveClass(/icard--selected/);
    await expect(first).not.toHaveClass(/icard--selected/);
    await first.locator('.icard-desc').click();
    await expect(panel.locator('img.opd-page')).toHaveCount(1);
    expect(await renders(page)).toEqual([id1, id2]);

    // The same card again closes it; so do Escape and ✕.
    await first.locator('.icard-desc').click();
    await expect(panel).toHaveCount(0);
    await first.locator('.icard-desc').click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await first.locator('.icard-desc').click();
    await panel.getByRole('button', { name: 'Voorbeeld sluiten' }).click();
    await expect(panel).toHaveCount(0);
    await expect(first).not.toHaveClass(/icard--selected/);
    expect(errors).toEqual([]);
  });

  test('Kopiëren keeps the preview open; Openen in editor opens the editor', async ({ page }) => {
    const errors = watchErrors(page);
    await login(page);
    await page.locator('.nav-btn[data-screen="opdrachten"]').click();
    const cards = page.locator('#opdracht-list .icard');
    const all = await cards.count();
    const panel = page.getByRole('region', { name: 'Voorbeeld van de opdracht' });
    await cards.first().locator('.icard-desc').click();
    const naam = (await panel.locator('.opd-preview-name').textContent())!;
    await panel.getByRole('button', { name: 'Kopiëren' }).click();
    await expect(cards).toHaveCount(all + 1);
    await expect(panel.locator('.opd-preview-name')).toHaveText(naam);
    await expect(page.locator('.icard--selected')).toHaveCount(1);
    await panel.getByRole('button', { name: 'Openen in editor' }).click();
    await expect(page.frameLocator('#editor-frame').locator('.cm-content')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a render error shows its message in the panel', async ({ page }) => {
    await login(page);
    await withMock(page, (m) => {
      (m as unknown as Record<string, unknown>).renderAssignmentSvg = async () => ({
        success: false,
        error: 'opdracht.typ:3: unknown variable: foo',
      });
    });
    await page.locator('.nav-btn[data-screen="opdrachten"]').click();
    await page.locator('#opdracht-list .icard').first().locator('.icard-desc').click();
    await expect(page.getByRole('alert')).toContainText('unknown variable: foo');
  });
  test('an editor session renders the preview again; Escape in ⋮ keeps it open', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await login(page);
    await page.locator('.nav-btn[data-screen="opdrachten"]').click();
    const first = page.locator('#opdracht-list .icard').first();
    const id = (await first.getAttribute('data-opd-card'))!;
    const panel = page.getByRole('region', { name: 'Voorbeeld van de opdracht' });
    await first.locator('.icard-desc').click();
    await expect(panel.locator('img.opd-page')).toHaveCount(1);

    // Escape closes the ⋮ menu only (review 34 m1).
    await first.getByRole('button', { name: 'Meer acties' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(panel).toBeVisible();

    // Bewerken › "Inhoud bewerken in de editor", then back: the pages are rendered again (M1).
    await cardMenu(first, 'Bewerken');
    await page.getByRole('button', { name: 'Inhoud bewerken in de editor' }).click();
    const frame = page.frameLocator('#editor-frame');
    await expect(frame.locator('.cm-content')).toBeVisible();
    await frame.getByRole('button', { name: 'Terug naar opdrachten' }).click();
    await expect(page.locator('#editor-frame')).toBeHidden();
    // The preview stayed open behind the editor and shows the pages again.
    await expect(panel.locator('img.opd-page')).toHaveCount(1);
    await expect.poll(async () => (await renders(page)).filter((x) => x === id).length).toBe(2);
    expect(errors).toEqual([]);
  });
});
