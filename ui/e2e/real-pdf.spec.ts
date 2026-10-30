// SPDX-License-Identifier: AGPL-3.0-or-later

// pdf.js shows a real compiled rapport (embedded fonts, colour emoji as Type3
// glyphs) under the strict CSP without errors (backlog 3a m8). The PDF comes
// from `cargo test -p maatwerk-core --test typst_rapport`; without it the test
// is skipped, except in the CI step after the cargo tests, which sets
// MAATWERK_REAL_PDF=1 and fails when the PDF is missing.
// It runs on the mock build, whose CSP shares every directive with the app's
// except connect-src (ui/vite/csp.ts): the PDF comes from a blob: URL, not the
// maatwerk-out scheme. That path is manual check M-TOE-5.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { login, watchErrors, withMock } from './helpers';

const PDF = fileURLToPath(new URL('../../target/tmp/e2e/rapport-valid.pdf', import.meta.url));

test('a real rapport renders in the PDF viewer without CSP errors', async ({ page }) => {
  const missing = `no ${PDF}: run cargo test -p maatwerk-core --test typst_rapport`;
  // Required only where the PDF must exist (review 6 m3). Not plain CI: the
  // general e2e step runs before the cargo tests that write the PDF.
  if (process.env.MAATWERK_REAL_PDF) expect(existsSync(PDF), missing).toBe(true);
  test.skip(!existsSync(PDF), missing);
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
