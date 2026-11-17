// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 30: Observatie bewerken with the icon picker (F-15, spec 4.12, board 15) and Opdracht
// bewerken with observatie chips and "Inhoud bewerken in de editor".

import { expect, test } from '@playwright/test';
import { login, watchErrors, withMock } from './helpers';

test('the icon picker: 200+ icons, search, categories; the chosen icon is saved', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  await page.locator('.nav-btn[data-screen="observaties"]').click();
  await page.locator('#btn-add-obs').click();
  const picker = page.getByRole('complementary', { name: 'Icoon kiezen' });
  const foot = picker.locator('.obs-picker-foot');
  const count = Number((await foot.textContent())!.match(/^(\d+) iconen$/)![1]);
  expect(count).toBeGreaterThanOrEqual(200);

  await picker.getByLabel('Zoek icoon').fill('molecuul');
  await expect(picker.locator('.obs-icon-btn')).toHaveText(['⚛️']);
  await expect(foot).toHaveText(`1 van ${count} iconen`);
  await picker.getByLabel('Zoek icoon').fill('');
  await picker.getByRole('button', { name: 'Biologie', exact: true }).click();
  await expect(picker.locator('.obs-picker-group-label')).toHaveText(['Biologie']);
  await picker.locator('.obs-icon-btn[data-icon="🧬"]').click();
  await expect(page.locator('#obs-icon-preview')).toHaveText('🧬');
  await expect(picker.locator('.obs-icon-btn[data-icon="🧬"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.locator('#f-onam').fill('Erfelijkheid door elkaar');
  await page.locator('#obs-ss-group [data-ss="Havo"]').click();
  await page.locator('#obs-jl-group [data-jl="4"]').click();
  await page.locator('#f-osave').click();
  await expect(page.locator('.dlg.modal-obs-edit')).toHaveCount(0);
  const saved = (await withMock(page, (m) => m.readAllJson('observaties'))) as {
    naam: string;
    icon: string;
  }[];
  expect(saved.find((o) => o.naam === 'Erfelijkheid door elkaar')?.icon).toBe('🧬');
  expect(errors).toEqual([]);
});

test('searching or switching categories alone does not count as an unsaved change', async ({
  page,
}) => {
  await login(page);
  await page.locator('.nav-btn[data-screen="observaties"]').click();
  await page.locator('[data-action="edit-obs"]').first().click();
  await page.getByLabel('Zoek icoon').fill('lamp');
  await page.getByRole('button', { name: 'Wiskunde', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg.modal-obs-edit')).toHaveCount(0);
});

test('Opdracht bewerken: observaties as emoji chips, filtered by the chosen fields', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('#btn-add-opdracht').click();
  const chips = page.locator('#op-obs-group .opd-obs-chip');
  const all = await chips.count();
  expect(all).toBeGreaterThan(0);
  // Every chip has its emoji and its name.
  await expect(chips.first().locator('.opd-obs-chip-icon')).not.toBeEmpty();
  await page.locator('#op-vak-group [data-vak="bio"]').click();
  await expect.poll(() => chips.count()).toBeLessThan(all);

  await page.locator('#op-vak-group [data-vak="bio"]').click();
  await page.locator('#op-vak-group [data-vak="nat"]').click();
  await page.locator('#op-ss-group [data-ss="Havo"]').click();
  await page.locator('#op-jl-group [data-jl="3"]').click();
  const first = chips.first();
  const obsId = (await first.getAttribute('data-obsid'))!;
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#f-opnam').fill('Nieuwe opdracht');
  await page.locator('#f-opsave').click();
  await expect(page.locator('.dlg.modal-opd-edit')).toHaveCount(0);
  const saved = (await withMock(page, (m) => m.readOpdrachten())) as {
    naam: string;
    observaties: string[];
    jaarlagen: number[];
  }[];
  const op = saved.find((o) => o.naam === 'Nieuwe opdracht');
  expect(op?.observaties).toEqual([obsId]);
  expect(op?.jaarlagen).toEqual([3]);
  expect(errors).toEqual([]);
});

test('"Inhoud bewerken in de editor" saves the opdracht and opens the editor', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('#btn-add-opdracht').click();
  // A missing field keeps the modal open.
  await page.getByRole('button', { name: 'Inhoud bewerken in de editor' }).click();
  await expect(page.locator('.dlg.modal-opd-edit')).toBeVisible();
  await page.locator('#f-opnam').fill('Direct naar de editor');
  await page.locator('#op-ss-group [data-ss="Havo"]').click();
  await page.locator('#op-vak-group [data-vak="nat"]').click();
  await page.locator('#op-jl-group [data-jl="4"]').click();
  await page.getByRole('button', { name: 'Inhoud bewerken in de editor' }).click();
  await expect(page.locator('.dlg.modal-opd-edit')).toHaveCount(0);
  await expect(page.frameLocator('#editor-frame').locator('.cm-content')).toBeVisible();
  const src = await page.locator('#editor-frame').getAttribute('src');
  expect(new URLSearchParams(src!.split('?')[1]).get('naam')).toBe('Direct naar de editor');
  expect(errors.filter((e) => !e.includes('Vul') && !e.includes('Selecteer'))).toEqual([]);
});
