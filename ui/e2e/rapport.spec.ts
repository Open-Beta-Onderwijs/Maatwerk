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

// F-14 (step 30): a score on one question below X points (or N) gets the linked opdrachten.
test('Opdrachten genereren: a question card links opdrachten to a low score on one question', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  await examMenu(page, 'Opdrachten genereren');
  await page.locator('[data-action="og-show-all"]').check();
  await page.getByRole('button', { name: '+ Vraag onder … punten toevoegen' }).click();
  const card = page.locator('[data-vraag-card]');
  await expect(card).toHaveCount(1);
  // Every score on the question is below 100 points: every student with a score or N.
  const onder = card.getByLabel('Puntengrens');
  await onder.fill('100');
  await onder.press('Tab');
  await card.locator('[data-action="og-couple-vraag"]').first().check();
  await expect(card.locator('.og-obs-head > .muted')).toHaveText(/^\d+ leerling(en)?$/);
  await expect(
    page.locator('.og-student .og-chip').filter({ hasText: '🔢' }).first(),
  ).toBeVisible();
  await page.locator('[data-action="og-generate"]').click();
  await expect(page.locator('.og-result .rapport-pdf-frame')).toBeVisible();
  // A call is [method, ...args]: the jobs are the first argument.
  const jobs = await withMock(
    page,
    (m) =>
      m.calls.filter((c) => c[0] === 'renderAssignmentBatch').at(-1)?.[1] as {
        header?: { observaties?: { name: string }[] };
      }[],
  );
  const reasons = jobs.flatMap((j) => j.header?.observaties?.map((o) => o.name) ?? []);
  expect(reasons.some((r) => /^Vraag \S+ onder 100 punten$/.test(r))).toBe(true);

  // Saved on the exam: the card is back after reopening.
  await page.keyboard.press('Escape');
  await expect(page.locator('.og-root')).toHaveCount(0);
  await examMenu(page, 'Opdrachten genereren');
  await expect(page.locator('[data-vraag-card]').getByLabel('Puntengrens')).toHaveValue('100');
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
