// SPDX-License-Identifier: AGPL-3.0-or-later

// The editor on the live compile session (Step 8b), against the MockApi's
// MockEditor (ui/src/bridge/mock/mock-editor.ts): changed pages only,
// diagnostics in CodeMirror, vragen panel, autocomplete, hover, Ctrl+click,
// preview <-> source jumps, the watchdog message, main.typ/lib.typ tabs with
// "Herstel standaardversie" and "Bekijk verschillen".

import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { login, watchErrors, withMock } from './helpers';

async function openEditor(page: Page): Promise<{ frame: FrameLocator; id: string }> {
  await login(page);
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('[data-action="open-editor"]').first().click();
  const frame = page.frameLocator('#editor-frame');
  await expect(frame.locator('.cm-content')).toBeVisible();
  const src = await page.locator('#editor-frame').getAttribute('src');
  const id = new URLSearchParams(src!.split('?')[1]).get('id')!;
  await expect(frame.locator('.svg-page').first()).toBeVisible();
  return { frame, id };
}

/** Replaces the whole editor text by typing it (CodeMirror sees real input). */
async function setText(page: Page, frame: FrameLocator, text: string): Promise<void> {
  await frame.locator('.cm-content').click();
  // Delete through CodeMirror's keymap, then one input event (fast, no auto-closing
  // brackets). Typing over a multi-line selection natively makes Chrome insert styled spans,
  // which the strict CSP reports.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

test('the preview shows only the changed pages and keeps them on errors', async ({ page }) => {
  const errors = watchErrors(page);
  const { frame } = await openEditor(page);
  await setText(page, frame, 'Eerste\n#pagebreak()\nTweede');
  await expect(frame.locator('.svg-page')).toHaveCount(2);
  const first = await frame.locator('.svg-page').first().getAttribute('data-hash');

  // Type at the end (no compile of an emptied text in between).
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(', anders');
  await expect(frame.locator('.svg-page').nth(1)).toContainText('Tweede, anders');
  expect(await frame.locator('.svg-page').first().getAttribute('data-hash')).toBe(first);
  const sent = await withMock(page, (m) => m.editor.updates.at(-1)!.pages.map((p) => p.index));
  expect(sent).toEqual([1]);

  // An error: diagnostics in the editor and the status bar, the preview stays.
  await setText(page, frame, 'Eerste\n#pagebreak()\nTweede #fout');
  await expect(frame.locator('.cm-lintRange-error')).toHaveText('fout');
  await expect(frame.locator('#btn-render-error')).toHaveText('Fout bij renderen');
  await frame.locator('#btn-render-error').click();
  await expect(frame.locator('#error-popover')).toContainText('opdracht.typ:3:9: unknown variable');
  await expect(frame.locator('.svg-page')).toHaveCount(2);
  await expect(frame.locator('.svg-page').nth(1)).toContainText('Tweede, anders');

  await setText(page, frame, 'Hersteld');
  await expect(frame.locator('.svg-page')).toHaveCount(1);
  await expect(frame.locator('.cm-lintRange-error')).toHaveCount(0);
  await expect(frame.locator('#btn-render-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('new errors show after a pause in typing, a fix clears them at once', async ({ page }) => {
  const { frame } = await openEditor(page);
  await setText(page, frame, 'Goed #fout');
  // The failed compile is there at once, its error only ~500 ms later.
  await expect.poll(() => withMock(page, (m) => m.editor.updates.at(-1)!.ok)).toBe(false);
  await expect(frame.locator('.cm-lintRange-error')).toHaveCount(0);
  await expect(frame.locator('.cm-lintRange-error')).toHaveText('fout');
  await setText(page, frame, 'Goed');
  await expect(frame.locator('.cm-lintRange-error')).toHaveCount(0, { timeout: 300 });
});

test('the vragen panel lists labels, points and checks', async ({ page }) => {
  const { frame } = await openEditor(page);
  await setText(
    page,
    frame,
    '#opgave[#vraag(punten: 2, antwoord: [Veertig])[Hoeveel?]]\n' +
      '#opgave[#vraag(punten: 1.5, antwoord: [B])[x] #vraag()[y]]',
  );
  const button = frame.locator('#pv-vragen');
  await expect(button).toHaveText('⚠ Vragen: 3 · 3,5 p');
  await button.click();
  const panel = frame.locator('#vragen-panel');
  await expect(panel.locator('.vragen-row')).toHaveText([/^1\s*2\s*Veertig/, /^2a/, /^2b/]);
  await expect(panel.locator('.vragen-checks')).toContainText('Vraag 2b heeft geen punten.');
  await expect(panel.locator('.vragen-checks')).toContainText('Vraag 2b heeft geen antwoord.');

  await setText(page, frame, 'Alleen uitleg.');
  await expect(button).toHaveText('⚠ Vragen: 0 · 0 p');
  await expect(panel.locator('.vragen-checks')).toHaveText('De opdracht heeft geen vragen.');
});

test('autocomplete, hover and Ctrl+click come from the session', async ({ page }) => {
  const { frame } = await openEditor(page);
  await setText(page, frame, '#let mijn-blok = 1\n\n#mijn-blok\n');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('#tab');
  const option = frame.locator('.cm-tooltip-autocomplete li', { hasText: 'table' });
  // A click, not Enter: results arrive on every keystroke and Enter could race the list.
  await option.click();
  await expect(frame.locator('.cm-content')).toContainText('#table()');

  await frame.locator('.cm-line', { hasText: '#table()' }).getByText('table').hover();
  await expect(frame.locator('.cm-typst-hover')).toHaveText('table: uitleg (mock)');

  // Ctrl+click on the use of `mijn-blok` selects its definition on line 1.
  await frame
    .locator('.cm-line')
    .nth(2)
    .click({ modifiers: ['ControlOrMeta'] });
  await expect
    .poll(() =>
      frame.locator('.cm-content').evaluate(() => {
        // Chromium has getSelection() on a shadow root; WebKit only on the document.
        const root = document.getElementById('cm-container')!.shadowRoot as unknown as Document;
        const sel = root.getSelection ? root.getSelection() : document.getSelection();
        return sel?.toString();
      }),
    )
    .toBe('mijn-blok');
});

test('a click in the preview moves the cursor to that line', async ({ page }) => {
  const { frame } = await openEditor(page);
  await setText(page, frame, 'Regel een\nRegel twee\nRegel drie');
  await expect(frame.locator('.svg-page')).toContainText('Regel drie');
  // force: WebKit hit-tests SVG text per glyph, so the centre (the space) hits the page
  // background; the app maps the click point, not the target.
  await frame.locator('.svg-page text', { hasText: 'Regel drie' }).click({ force: true });
  await expect
    .poll(() => withMock(page, (m) => m.calls.filter((c) => c[0] === 'editorJumpFromClick').length))
    .toBeGreaterThan(0);
  await expect(frame.locator('.cm-activeLine')).toHaveText('Regel drie');
});

test('a compile over the time limit reports the admin setting', async ({ page }) => {
  const { frame } = await openEditor(page);
  await setText(page, frame, 'Goed');
  await expect(frame.locator('.svg-page')).toContainText('Goed');
  await setText(page, frame, '#traag');
  await frame.locator('#btn-render-error').click();
  await expect(frame.locator('#error-popover')).toContainText(
    'Het compileren duurde langer dan 30 seconden',
  );
  await expect(frame.locator('.svg-page')).toContainText('Goed');
});

/**
 * As in the Tauri app: tauri-plugin-dialog replaces window.confirm with an async
 * function, so a native confirm never stops anything (manual test M-OPD-9).
 */
async function tauriConfirm(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.confirm = (async () => true) as unknown as typeof window.confirm;
  });
}

test('lib.typ: warning, Bekijk verschillen and Herstel standaardversie', async ({ page }) => {
  await tauriConfirm(page);
  await login(page);
  // An older, changed lib.typ in the first opdracht.
  const id = await withMock(page, async (m) => {
    const all = (await m.readOpdrachten()) as { id: string }[];
    return all[0]!.id;
  });
  await withMock(
    page,
    (m, rel) => m.externalWriteText(rel, '// maatwerk-lib 1 (mock)\n// mijn aanpassing\n'),
    `opdrachten/${id}/lib.typ`,
  );
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator(`[data-action="open-editor"][data-id="${id}"]`).click();
  const frame = page.frameLocator('#editor-frame');
  await expect(frame.locator('.cm-content')).toBeVisible();
  const tab = frame.locator('.file-tab[data-file="lib.typ"]');
  await expect(tab).toHaveClass(/needs-attention/);
  await tab.click();
  await expect(frame.locator('.cm-content')).toContainText('mijn aanpassing');
  const banner = frame.locator('#file-banner');
  await expect(banner).toContainText('Er is een nieuwere versie van lib.typ');
  await expect(banner).toContainText('bepaalt de opmaak');

  await banner.getByRole('button', { name: 'Bekijk verschillen' }).click();
  await expect(frame.locator('.diff-removed')).toHaveText([
    '- // maatwerk-lib 1 (mock)',
    '- // mijn aanpassing',
  ]);
  await expect(frame.locator('.diff-added')).toHaveText('+ // maatwerk-lib 2 (mock)');
  await frame.getByRole('button', { name: 'Sluiten' }).click();

  // The app's own dialog asks first; "Annuleren" keeps my version (M-OPD-9).
  const dialog = page.locator('.dlg--confirm');
  await banner.getByRole('button', { name: 'Herstel standaardversie' }).click();
  await expect(dialog).toContainText('De standaardversie van lib.typ vervangt jouw versie');
  await dialog.getByRole('button', { name: 'Annuleren' }).click();
  await expect(dialog).toBeHidden();
  await expect(frame.locator('.cm-content')).toContainText('mijn aanpassing');
  expect(await withMock(page, (m) => m.calls.map((c) => c[0]))).not.toContain('restoreProjectFile');

  await banner.getByRole('button', { name: 'Herstel standaardversie' }).click();
  await dialog.getByRole('button', { name: 'Herstellen' }).click();
  await expect(frame.locator('#editor-status')).toContainText(
    'Standaardversie van lib.typ hersteld',
  );
  await expect(frame.locator('.cm-content')).toHaveText('// maatwerk-lib 2 (mock)');
  expect(await withMock(page, (m, rel) => m.peek(rel), `opdrachten/${id}/lib.typ`)).toBe(
    '// maatwerk-lib 2 (mock)\n',
  );
  await expect(tab).not.toHaveClass(/needs-attention/);

  // Undo brings my version back; it is saved again.
  await frame.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(frame.locator('.cm-content')).toContainText('mijn aanpassing');
  await expect
    .poll(() => withMock(page, (m, rel) => m.peek(rel), `opdrachten/${id}/lib.typ`))
    .toContain('mijn aanpassing');

  // Back to opdracht.typ: no banner.
  await frame.locator('.file-tab[data-file="opdracht.typ"]').click();
  await expect(banner).toBeHidden();
});

test('lib.typ: a current copy edited in the editor offers Bekijk verschillen', async ({ page }) => {
  // M-OPD-9: the button only showed for a copy that was already changed when the editor opened.
  await login(page);
  const id = await withMock(page, async (m) => {
    const all = (await m.readOpdrachten()) as { id: string }[];
    return all[0]!.id;
  });
  // The current bundled version (mock-api.ts LIB_TYP).
  await withMock(
    page,
    (m, rel) => m.externalWriteText(rel, '// maatwerk-lib 2 (mock)\n'),
    `opdrachten/${id}/lib.typ`,
  );
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator(`[data-action="open-editor"][data-id="${id}"]`).click();
  const frame = page.frameLocator('#editor-frame');
  await expect(frame.locator('.cm-content')).toBeVisible();
  await expect(frame.locator('.file-tab[data-file="lib.typ"]')).not.toHaveClass(/needs-attention/);
  await frame.locator('.file-tab[data-file="lib.typ"]').click();
  const banner = frame.locator('#file-banner');
  await expect(banner).toContainText('bepaalt de opmaak');
  await banner.getByRole('button', { name: 'Bekijk verschillen' }).click();
  await expect(frame.locator('#diff-body')).toContainText('Geen verschillen');
  await frame.getByRole('button', { name: 'Sluiten' }).click();

  await frame.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('// mijn regel\n');
  await banner.getByRole('button', { name: 'Bekijk verschillen' }).click();
  await expect(frame.locator('.diff-removed')).toHaveText('- // mijn regel');
  await expect(frame.locator('#diff-body')).not.toContainText('Geen verschillen');
});

test('closing the editor closes the session', async ({ page }) => {
  const { frame } = await openEditor(page);
  await frame.locator('#btn-app-title').click();
  await expect(page.locator('#editor-overlay')).toBeHidden();
  const calls = await withMock(page, (m) => m.calls.map((c) => c[0]));
  expect(calls).toContain('editorOpen');
  expect(calls).toContain('editorClose');
});
