// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 27: student cards (F-07, F-08) and group cards (F-09); the admin keeps
// the plain student list (spec 4.3, 4.4, 4.9). Numbers from the fixture, the
// same as the group overview's Jaar column (docs/phase-2/step-27-card-numbers.md).

import { expect, test } from '@playwright/test';
import { YEAR, login } from './helpers';
import { screen } from './views';

test('a student card shows bars, the year average with the trend and the last grade', async ({
  page,
}) => {
  await login(page);
  await screen(page, 'leerlingen');
  const card = page.locator('.s-card', { hasText: 'Sem van den Dekker' });
  await expect(card.locator('.s-card__avg-value')).toHaveText('8,3');
  await expect(card.locator('.trend-arrow')).toHaveAttribute('aria-label', 'Trend: sterk omlaag');
  await expect(card.locator('.s-card__small')).toHaveText('laatste 5,0');
  await expect(card.locator('.s-card__bar')).toHaveCount(3);
  await expect(card.locator('.s-card__nr')).toHaveText('900004');
  // Cards in a grid: the second card sits next to the first.
  const boxes = await page
    .locator('.s-card')
    .evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().top));
  expect(boxes[0]).toBe(boxes[1]);
  // The whole card opens the profile.
  await card.click();
  await expect(page.locator('.dlg')).toContainText('Sem van den Dekker');
});

test('a group card shows mean ± SD and % onvoldoende; it opens the group overview', async ({
  page,
}) => {
  await login(page);
  await screen(page, 'groepen');
  const card = page.locator('.g-card', { hasText: '3a nat' });
  await expect(card.locator('.g-card__line')).toHaveText('5,1 ± 1,3');
  await expect(card.locator('.g-card__fails')).toHaveText('88% onvoldoende');
  await expect(card.locator('.g-card__fails')).toHaveClass(/g-card__fails--alarm/);
  await expect(card.locator('.g-card__meta')).toHaveText('Docent van Natuur · 8 leerlingen');
  await expect(card.locator('.g-card__names')).toContainText('Bram, D');
  // Anywhere on the card (the name's button covers it).
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width - 30, box.y + box.height - 12);
  await expect(page.locator('.dlg .gl-th').first()).toBeVisible();
  // V-02: a line after each periode header and before Gemiddelde.
  await expect(page.locator('.dlg .gl-th', { hasText: 'Gemiddelde' })).toHaveCSS(
    'border-left-width',
    '2px',
  );
});

test('the admin keeps the plain student list, without grades', async ({ page }) => {
  await login(page, 'nat', 'admin');
  await screen(page, 'leerlingen');
  await expect(page.locator('#student-list .s-row').first()).toBeVisible();
  await expect(page.locator('#student-list .s-card')).toHaveCount(0);
  await expect(page.locator('#student-list .trend-arrow')).toHaveCount(0);
  await expect(page.locator('[data-action="edit-student"]').first()).toBeVisible();
  // Group cards for the admin too, with the edit and delete buttons above the card.
  await screen(page, 'groepen');
  const edit = page.locator(`[data-action="edit-group"][data-id="3a-nat-${YEAR}"]`);
  await edit.click();
  await expect(page.locator('#f-gname')).toBeVisible();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('cards do not move on hover', async ({ page }) => {
    await login(page);
    await screen(page, 'leerlingen');
    const card = page.locator('.s-card').first();
    await card.hover();
    await expect(card).toHaveCSS('transform', 'none');
  });
});
