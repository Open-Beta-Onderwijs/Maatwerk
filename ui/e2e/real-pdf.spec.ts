// SPDX-License-Identifier: AGPL-3.0-or-later

// pdf.js shows a real compiled rapport (embedded fonts, colour emoji as Type3
// glyphs) under the strict CSP without errors (backlog 3a m8). The PDF comes
// from `cargo test -p maatwerk-core --test typst_rapport`; without it the test
// is skipped (CI runs it after the cargo tests).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { login, watchErrors, withMock } from './helpers';

const PDF = fileURLToPath(new URL('../../target/tmp/e2e/rapport-valid.pdf', import.meta.url));

test('a real rapport renders in the PDF viewer without CSP errors', async ({ page }) => {
  test.skip(!existsSync(PDF), `no ${PDF}: run cargo test -p maatwerk-core --test typst_rapport`);
  const errors = watchErrors(page);
  await login(page);
  await withMock(page, (m, b64) => m.useRealPdf(b64), readFileSync(PDF).toString('base64'));
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  // Retried: the exam list re-renders once its statistics are loaded (helpers examMenuItem).
  await expect(async () => {
    await page.locator('[data-action="exam-menu"]:not([data-kind="summary"])').first().click();
    await page.getByRole('menuitem', { name: 'Rapport genereren' }).click({ timeout: 1000 });
  }).toPass();
  const viewer = page.frameLocator('.rapport-pdf-frame');
  await expect(viewer.locator('canvas').first()).toBeVisible();
  // pdf.js renders pages lazily; scroll through them so every font and glyph is used.
  const pages = viewer.locator('.page-wrap');
  const count = await pages.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    await pages.nth(i).scrollIntoViewIfNeeded();
    await expect(pages.nth(i).locator('canvas')).toBeVisible();
  }
  await page.waitForTimeout(600);
  expect(errors).toEqual([]);
});
