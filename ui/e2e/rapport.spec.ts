// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 17: Typst warnings in the rapport and opdrachten dialogs (F-04).

import { expect, test, type Page } from '@playwright/test';
import { login, watchErrors, withMock } from './helpers';

const WARNING = 'warning: unknown font family: Comic\n  ┌─ opdracht.typ:3:12';

async function examMenu(page: Page, item: string) {
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  // Retried: the exam list re-renders once its statistics are loaded (helpers examMenuItem).
  await expect(async () => {
    await page.locator('[data-action="exam-menu"]:not([data-kind="summary"])').first().click();
    await page.getByRole('menuitem', { name: item }).click({ timeout: 1000 });
  }).toPass();
}

test('the rapport shows no warning panel when Typst has none', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await examMenu(page, 'Rapport genereren');
  await expect(page.locator('.rapport-pdf-frame')).toBeVisible();
  await expect(page.locator('.render-warnings')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the rapport shows Typst's warnings, folded, above the PDF", async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await withMock(page, (m, w) => m.useRenderWarnings(w), [WARNING, 'warning: second']);
  await examMenu(page, 'Rapport genereren');
  const panel = page.locator('.render-warnings');
  await expect(panel).toBeVisible();
  await expect(panel.locator('summary')).toHaveText(
    '2 waarschuwingen bij het maken van de PDF: controleer de PDF.',
  );
  await expect(panel.locator('pre').first()).toBeHidden();
  await panel.locator('summary').click();
  await expect(panel.locator('pre').first()).toHaveText(WARNING);
  await expect(page.locator('.rapport-pdf-frame')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the answer key in Opdrachten genereren shows the warnings too', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await withMock(page, (m, w) => m.useRenderWarnings(w), [`Opdracht "Remweg":\n${WARNING}`]);
  await examMenu(page, 'Opdrachten genereren');
  await page.locator('[data-action="og-key"]').click();
  const panel = page.locator('.render-warnings');
  await expect(panel.locator('summary')).toHaveText(
    '1 waarschuwing bij het maken van de PDF: controleer de PDF.',
  );
  await expect(page.locator('.og-result .rapport-pdf-frame')).toBeVisible();
  expect(errors).toEqual([]);
});
