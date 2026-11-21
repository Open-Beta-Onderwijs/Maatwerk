// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 17: Typst warnings in the rapport and opdrachten dialogs (F-04).

import { expect, test, type Page } from '@playwright/test';
import { cardMenu, login, watchErrors, withMock } from './helpers';

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

// 0.23.1 hotfix: one opdracht printed from the Opdrachten tab, without the student block.
test('Opdrachten tab: the print button shows one plain copy of the opdracht', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  const card = page.locator('#opdracht-list .icard').first();
  const naam = (await card.locator('.icard-title').textContent())!.trim();
  await cardMenu(card, 'Afdrukken');
  await expect(page.locator('.dlg.modal-pdf .rapport-pdf-frame')).toBeVisible();
  type Call = [string, ...unknown[]];
  const lastBatch = () =>
    withMock(page, (m) => {
      const c = (m.calls as Call[]).filter((x) => x[0] === 'renderAssignmentBatch').at(-1)!;
      return { jobs: c[1], opts: c[2] } as {
        jobs: { mode: string; header: Record<string, unknown> }[];
        opts: { includeAnswers: boolean; duplex: boolean };
      };
    });
  const first = await lastBatch();
  expect(first.jobs).toHaveLength(1);
  expect(first.jobs[0]!.mode).toBe('plain');
  expect(first.jobs[0]!.header).toEqual({ title: naam });
  expect(first.opts).toMatchObject({ includeAnswers: false, duplex: false });

  await page.getByLabel('Met antwoorden').check();
  await expect.poll(async () => (await lastBatch()).opts.includeAnswers).toBe(true);
  expect((await lastBatch()).jobs[0]!.mode).toBe('plain');

  // The viewer's button opens the rendered PDF itself; nothing is saved in rapporten/.
  await expect(page.locator('.dlg.modal-pdf .rapport-pdf-frame')).toBeVisible();
  await page.evaluate(() => window.postMessage({ type: 'print-pdf' }, '*'));
  await expect
    .poll(() =>
      withMock(page, (m) => (m.calls as Call[]).filter((c) => c[0] === 'openPath').length),
    )
    .toBe(1);
  expect(
    await withMock(page, (m) => (m.calls as Call[]).filter((c) => c[0] === 'printPdf').length),
  ).toBe(0);
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
