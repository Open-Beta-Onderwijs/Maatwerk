// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 31 (spec 4.8, board 10): the editor's header and back button (V-07), the status pill
// (F-05), the draggable divider saved per user (F-16), the toolbar menus, and the typed proxy
// that only serves the opdracht's own files (U10).

import { expect, test, type Frame, type FrameLocator, type Page } from '@playwright/test';
import { login, openOpdrachtEditor, TEACHER, watchErrors, withMock } from './helpers';

async function openEditor(page: Page): Promise<{ frame: FrameLocator; id: string }> {
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await openOpdrachtEditor(page);
  const frame = page.frameLocator('#editor-frame');
  await expect(frame.locator('.cm-content')).toBeVisible();
  await expect(frame.locator('.svg-page').first()).toBeVisible();
  const src = await page.locator('#editor-frame').getAttribute('src');
  const id = new URLSearchParams(src!.split('?')[1]).get('id')!;
  return { frame, id };
}

function editorFrame(page: Page): Frame {
  return page.frames().find((f) => f.url().includes('editor.html'))!;
}

test('header: back button, title and subtitle; the status pill ends on all done', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  const { frame } = await openEditor(page);
  await expect(frame.locator('#btn-app-title')).toHaveText('Terug naar opdrachten');
  await expect(frame.locator('#editor-title-naam')).not.toBeEmpty();
  await expect(frame.locator('#editor-subtitle')).toHaveText(/^Opdracht · \S/);
  const pill = frame.getByRole('status');
  await expect(pill).toHaveAttribute('data-kind', 'ok');
  await expect(pill).toHaveText('Opgeslagen · PDF bijgewerkt');

  // An edit: unsaved, then saved and compiled again.
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nNieuwe regel');
  await expect(pill).toHaveText('Opgeslagen · PDF bijgewerkt');
  await expect(pill).toHaveAttribute('data-kind', 'ok');

  await frame.locator('#btn-app-title').click();
  await expect(page.locator('#editor-overlay')).toHaveClass(/hidden/);
  expect(errors).toEqual([]);
});

// Review 30-31 M1: "Opgeslagen" only when saved; a failed save is not covered by a good compile.
test('a failed save stays in the pill after a good compile; "Opgeslagen" only once saved', async ({
  page,
}) => {
  await login(page);
  const { frame } = await openEditor(page);
  const pill = frame.getByRole('status');
  await expect(pill).toHaveAttribute('data-kind', 'ok');
  await withMock(page, (m) => m.fail('writeTextFile', 'opdrachten/'));
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nEen regel die niet wordt opgeslagen');
  await expect(pill).toHaveText('Fout bij opslaan');
  await expect(pill).toHaveAttribute('data-kind', 'error');
  // The compile of that text is long done; the pill still says the save failed.
  await page.waitForTimeout(1000);
  await expect(pill).toHaveText('Fout bij opslaan');

  await withMock(page, (m) => m.clearFaults());
  await page.keyboard.type('!');
  await expect(pill).toHaveText('Opgeslagen · PDF bijgewerkt');
  await expect(pill).toHaveAttribute('data-kind', 'ok');
});

test('a slow compile shows "Compileren…" with a spinner', async ({ page }) => {
  await login(page);
  const { frame } = await openEditor(page);
  await withMock(page, (m) => {
    m.editor.compileDelayMs = 1500;
  });
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('x');
  const pill = frame.getByRole('status');
  await expect(pill).toHaveAttribute('data-kind', 'busy');
  await expect(pill).toHaveText('Compileren…');
  await expect(pill.locator('.status-spin')).toBeVisible();
  await expect(pill).toHaveAttribute('data-kind', 'ok', { timeout: 10_000 });
});

test('divider: keys, double click and drag between 25% and 75%; saved per user', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  const { frame } = await openEditor(page);
  const divider = frame.getByRole('separator', { name: 'Breedte editor en voorbeeld' });
  await expect(divider).toHaveAttribute('aria-valuenow', '50');

  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '46');
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '25');
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '25');
  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');

  // Drag 20% of the body's width to the right.
  const body = (await frame.locator('#editor-body').boundingBox())!;
  const box = (await divider.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + body.width * 0.2, y, { steps: 5 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  const left = (await frame.locator('#editor-left').boundingBox())!;
  expect(Math.abs(left.width / body.width - 0.7)).toBeLessThan(0.02);

  // Saved in the user's file, and used again the next time.
  const file = `gebruikers/${TEACHER}.json`;
  await expect
    .poll(async () =>
      withMock(
        page,
        (m, rel) =>
          (JSON.parse(m.peek(rel) ?? '{}') as { preferences?: { editorSplit?: number } })
            .preferences?.editorSplit,
        file,
      ),
    )
    .toBe(0.7);
  await frame.locator('#btn-app-title').click();
  const again = await openEditor(page);
  await expect(
    again.frame.getByRole('separator', { name: 'Breedte editor en voorbeeld' }),
  ).toHaveAttribute('aria-valuenow', '70');
  expect(errors).toEqual([]);
});

test('toolbar menus: Wiskunde inserts, Symbolen opens a symbol panel under its button', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  const { frame } = await openEditor(page);
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n');

  await frame.getByRole('button', { name: 'Wiskunde ▾' }).click();
  const menu = frame.getByRole('menu', { name: 'Wiskundige elementen' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Breuk' }).click();
  await expect(menu).toBeHidden();
  await expect(frame.locator('.cm-content')).toContainText('frac(');

  const symButton = frame.getByRole('button', { name: 'Symbolen ▾' });
  await symButton.click();
  await frame.getByRole('menuitem', { name: 'Emoji' }).click();
  const panel = frame.locator('#popup-sym-emoji');
  await expect(panel).toBeVisible();
  const p = (await panel.boundingBox())!;
  const b = (await symButton.boundingBox())!;
  expect(p.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
  await page.keyboard.press('Escape');
  await frame.locator('#editor-title-naam').click();
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test('U10: the editor reads only its own three files; other paths are refused', async ({
  page,
}) => {
  await login(page);
  const { id } = await openEditor(page);
  const ask = (data: Record<string, unknown>) =>
    editorFrame(page).evaluate(
      (msg) =>
        new Promise<{ result?: unknown; error?: string }>((resolve) => {
          const reqId = 900000 + Math.floor(Math.random() * 1000);
          const onMessage = (e: MessageEvent) => {
            if (e.data?.type === 'maatwerk-response' && e.data.id === reqId) {
              window.removeEventListener('message', onMessage);
              resolve(e.data);
            }
          };
          window.addEventListener('message', onMessage);
          window.parent.postMessage({ ...msg, id: reqId }, '*');
        }),
      data,
    );
  const own = await ask({ type: 'maatwerk-read-text-versioned', file: 'lib.typ' });
  expect(own.error).toBeUndefined();
  expect((own.result as { text: string }).text).toContain('maatwerk-lib');
  for (const file of ['../../gebruikers/x.json', 'school.json', `opdrachten/${id}/lib.typ`]) {
    const refused = await ask({ type: 'maatwerk-read-text-versioned', file });
    expect(refused.error).toMatch(/^not allowed: file/);
  }
  const path = await ask({ type: 'maatwerk-read-text', path: 'school.json' });
  expect(path.error).toMatch(/^not allowed/);
});
