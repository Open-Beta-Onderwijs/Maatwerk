// SPDX-License-Identifier: AGPL-3.0-or-later

// Smoke test of the main teacher flow on the mock build (PLAN.md Step 3a):
// boot, every tab, create an exam, enter a score, open the rapport.

import { expect, test } from '@playwright/test';
import { YEAR, examMenuItem, login, readMockJson, watchErrors, withMock } from './helpers';
import { screen } from './views';

const EXAM_ID = `nat-smoketoets-${YEAR}`;

interface ScoreFile {
  scores?: Record<string, Record<string, unknown>>;
}

test('boot, tabs, create exam, enter score, rapport', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);

  for (const name of ['leerlingen', 'groepen', 'toetsen', 'observaties', 'opdrachten']) {
    await screen(page, name);
    await expect(page.locator(`#screen-${name}`)).toBeVisible();
  }

  // Create an exam (step 1: properties, step 2: questions).
  await screen(page, 'toetsen');
  await page.locator('#btn-add-exam').click();
  await page.locator('#f-etitle').fill('Smoketoets');
  await page.locator('.ss-btn[data-ss="Havo"]').click();
  await page.locator('.jl-btn[data-jl="3"]').click();
  await page.locator('.per-btn[data-per="1"]').click();
  await page.locator('#f-e-next').click();
  await page.locator('#f-esave').click();
  await expect(page.locator('#modal-overlay')).toBeHidden();
  const exam = await readMockJson<{ title: string; questions: unknown[] }>(
    page,
    `${YEAR}/exams/${EXAM_ID}.json`,
  );
  expect(exam).toMatchObject({ title: 'Smoketoets' });
  expect(exam.questions.length).toBeGreaterThan(0);
  await expect(page.locator(`[data-action="exam-menu"][data-id="${EXAM_ID}"]`)).toBeVisible();

  // Enter a score in the first question cell of the first student.
  await examMenuItem(page, EXAM_ID, 'Scores invoeren');
  const firstRow = page.locator('.handsontable .htCore tbody tr').first();
  const studentId = (await firstRow.locator('td').first().innerText()).trim();
  await firstRow.locator('td').nth(2).click();
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  const scoreFile = `${YEAR}/scores/nat/${studentId}.json`;
  await expect
    .poll(async () => (await readMockJson<ScoreFile>(page, scoreFile))?.scores?.[EXAM_ID])
    .toEqual({ q1: 1 });
  await page.locator('#modal-close').click();

  // Rapport: the mock compiles a canned PDF that the PDF viewer renders.
  await examMenuItem(page, EXAM_ID, 'Rapport genereren');
  const viewer = page.frameLocator('.rapport-pdf-frame');
  await expect(viewer.locator('canvas').first()).toBeVisible();
  const calls = await withMock(page, (m) => m.calls.filter((c) => c[0] === 'renderRapportPdf'));
  expect(calls).toHaveLength(1);

  expect(errors).toEqual([]);
});
