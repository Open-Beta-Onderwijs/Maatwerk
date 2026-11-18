// SPDX-License-Identifier: AGPL-3.0-or-later

// The window draws emoji with the embedded Noto Color Emoji (the PDFs' font), in the main window
// and in the editor frame (utils/emoji-font.ts); text keeps its own font. Only where the browser
// draws COLRv1 (supportsColrV1): macOS WebKit keeps the system emoji and registers nothing.

import { expect, test, type Page } from '@playwright/test';
import { login, watchErrors } from './helpers';

const loadedFaces = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((f) => f.family.replace(/"/g, '') === 'Maatwerk Emoji')
      .map((f) => f.status);
  });

test('emoji use the embedded font in the window and in the editor', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await page.locator('.nav-btn[data-screen="observaties"]').click();
  await expect(page.locator('.obs-card-icon').first()).toBeVisible();
  const colr = await page.evaluate(() => CSS.supports('font-tech(color-COLRv1)'));
  if (!colr) {
    expect(await loadedFaces(page)).toEqual([]);
    expect(errors).toEqual([]);
    return;
  }
  await expect.poll(() => loadedFaces(page)).toEqual(['loaded']);
  // The emoji's own box uses it; a letter next to it does not need it.
  const usesEmoji = await page.evaluate(() => document.fonts.check('16px "Maatwerk Emoji"', '📏'));
  expect(usesEmoji).toBe(true);

  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('[data-action="open-editor"]').first().click();
  await expect(page.frameLocator('#editor-frame').locator('.cm-content')).toBeVisible();
  const frame = page.frames().find((f) => f.url().includes('editor.html'))!;
  await expect
    .poll(() =>
      frame.evaluate(() =>
        [...document.fonts]
          .filter((f) => f.family.replace(/"/g, '') === 'Maatwerk Emoji')
          .map((f) => f.status),
      ),
    )
    .toHaveLength(1);
  expect(errors).toEqual([]);
});
