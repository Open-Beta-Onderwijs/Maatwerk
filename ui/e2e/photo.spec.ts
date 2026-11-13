// SPDX-License-Identifier: AGPL-3.0-or-later

// F-19: a teacher changes their own photo in the user menu, with a square
// crop over a non-square image (design spec 4.9, board 12). The crop field is
// shared with Gebruiker bewerken (step 28).

import { expect, test, type Page } from '@playwright/test';
import { TEACHER, login, readMockJson, withMock } from './helpers';

/** A PNG of w x h px: left half red, right half blue. */
async function pngOf(page: Page, w: number, h: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d')!;
      x.fillStyle = '#ff0000';
      x.fillRect(0, 0, w / 2, h);
      x.fillStyle = '#0000ff';
      x.fillRect(w / 2, 0, w / 2, h);
      return c.toDataURL('image/png').split(',')[1]!;
    },
    [w, h],
  );
  return Buffer.from(b64, 'base64');
}

async function openPhotoDialog(page: Page) {
  await page.locator('#user-badge-btn').click();
  await page.locator('#acc-photo').click();
  await expect(page.locator('.dlg .photo-crop')).toBeVisible();
}

test('a teacher crops a wide image to a square photo', async ({ page }) => {
  await login(page);
  await openPhotoDialog(page);
  // The fixture's photo is shown first, with the whole square selected.
  await expect(page.locator('.photo-crop__frame')).toBeVisible();

  await page.locator('.photo-crop__file').setInputFiles({
    name: 'breed.png',
    mimeType: 'image/png',
    buffer: await pngOf(page, 400, 200),
  });
  const frame = page.locator('.photo-crop__frame');
  const before = (await frame.boundingBox())!;
  // 80% of the short side, centred: 160 of 200 px, at a scale of 0.75 (300 / 400).
  expect(Math.round(before.width)).toBe(120);
  // Drag it all the way left, then zoom in with the keyboard.
  await frame.hover();
  await page.mouse.down();
  await page.mouse.move(before.x - 200, before.y + before.height / 2, { steps: 4 });
  await page.mouse.up();
  const area = (await page.locator('.photo-crop__area').boundingBox())!;
  const moved = (await frame.boundingBox())!;
  expect(moved.x - area.x).toBeCloseTo(0, 0);
  await frame.press('+');
  expect((await frame.boundingBox())!.width).toBeLessThan(moved.width);

  await page.locator('#foto-save').click();
  await expect(page.locator('.toast').last()).toHaveText('Foto opgeslagen.');
  const path = `afbeeldingen/${TEACHER}.jpg`;
  const user = await readMockJson<{ foto: string }>(page, `gebruikers/${TEACHER}.json`);
  expect(user.foto).toBe(path);
  // A square JPEG, all red (the left half of the image).
  const pixel = await withMock(
    page,
    async (m, p) => {
      const url = await m.readPhotoAsDataUrl(p);
      const img = new Image();
      img.src = url!;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext('2d')!;
      x.drawImage(img, 0, 0);
      const d = x.getImageData(img.width / 2, img.height / 2, 1, 1).data;
      return { w: img.width, h: img.height, r: d[0], b: d[2] };
    },
    path,
  );
  expect(pixel.w).toBe(pixel.h);
  expect(pixel.r).toBeGreaterThan(200);
  expect(pixel.b).toBeLessThan(60);
  await expect(page.locator('#user-badge-btn img.avatar-photo')).toHaveAttribute(
    'src',
    /^data:image\/jpeg/,
  );
});

test('Verwijderen removes the photo: initials again', async ({ page }) => {
  await login(page);
  await openPhotoDialog(page);
  await expect(page.locator('.photo-crop__frame')).toBeVisible();
  await page.getByRole('button', { name: 'Verwijderen' }).click();
  await expect(page.locator('.photo-crop__empty')).toBeVisible();
  await page.locator('#foto-save').click();
  await expect(page.locator('.toast').last()).toHaveText('Foto verwijderd.');
  const user = await readMockJson<{ foto: string | null }>(page, `gebruikers/${TEACHER}.json`);
  expect(user.foto).toBeNull();
  await expect(page.locator('#user-badge-btn img')).toHaveCount(0);
});

test('Annuleren saves nothing', async ({ page }) => {
  await login(page);
  const before = await readMockJson<{ foto: string }>(page, `gebruikers/${TEACHER}.json`);
  await openPhotoDialog(page);
  await page.locator('.photo-crop__frame').press('ArrowRight');
  await page.getByRole('button', { name: 'Annuleren' }).click();
  const after = await readMockJson<{ foto: string }>(page, `gebruikers/${TEACHER}.json`);
  expect(after.foto).toBe(before.foto);
  expect(await withMock(page, (m) => m.calls.some((c) => c[0] === 'savePhoto'))).toBe(false);
});
