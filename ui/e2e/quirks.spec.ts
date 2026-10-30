// SPDX-License-Identifier: AGPL-3.0-or-later

// UI quirks the port fixes (ADR-0002 section 10; docs/reference/quirks.md).
// Each test failed on the imported reference code before its fix.
// Every page load starts a fresh MockApi, so tests do not share data.

import { expect, test, type Page } from '@playwright/test';
import { TEACHER, YEAR, login, readMockJson, seedFiles, withMock } from './helpers';

const NASTY = `<b>x</b> & "y" a &lt; b </textarea>`;

async function openScoreGrid(page: Page) {
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  // A summary card (exam with resits) has "Scores invoeren" disabled.
  await page.locator('[data-action="exam-menu"]:not([data-kind="summary"])').first().click();
  await page.getByRole('menuitem', { name: 'Scores invoeren' }).click();
  await expect(page.locator('.score-grid-table td').first()).toBeVisible();
}

async function openFirstOpdrachtInEditor(page: Page) {
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('[data-action="open-editor"]').first().click();
  const frame = page.frameLocator('#editor-frame');
  await expect(frame.locator('.cm-content')).toBeVisible();
  return frame;
}

test('U7: the login screen shows teacher names as text', async ({ page }) => {
  await page.goto('/');
  const users = await readMockJson<Record<string, unknown>[]>(page, 'gebruikers.json');
  const nasty = users.map((u) =>
    u.id === TEACHER ? { ...u, voornaam: NASTY, afkorting: '<i>', foto: null } : u,
  );
  await seedFiles(page, { 'gebruikers.json': nasty });
  await page.goto('/');
  await page.locator('.subject-card[data-subject="nat"]').click();
  const badge = page.locator(`.user-badge[data-user-id="${TEACHER}"]`);
  await expect(badge.locator('.badge-name')).toHaveText(NASTY);
  await expect(badge.locator('.badge-initials')).toHaveText('<i>');
  await expect(badge.locator('b, i')).toHaveCount(0);
});

test('U6: the RTTI uitleg modal keeps teacher text as typed', async ({ page }) => {
  const file = 'templates/RTTI explanations and advices/rtti_expl_adv_nat_3.json';
  await page.goto('/');
  const template = await readMockJson<{ uitleg: Record<string, string> }>(page, file);
  await seedFiles(page, { [file]: { ...template, uitleg: { ...template.uitleg, R: NASTY } } });
  await login(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await page.locator('#btn-toetsen-rtti-uitleg').click();
  await page.locator('.rtti-uitleg-tab-bar button', { hasText: /^3$/ }).click();
  await expect(page.locator('textarea[data-uitleg="R"]')).toHaveValue(NASTY);
});

test('U3: a failed score save is reported', async ({ page }) => {
  await login(page);
  await openScoreGrid(page);
  await withMock(page, (m) => m.fail('writeJson', '/scores/'));
  const cell = page.locator('.score-grid-table tbody tr').first().locator('td').nth(2);
  await cell.click();
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast-persistent')).toContainText('niet opgeslagen');
});

test('U9: closing the editor right after typing keeps the edit', async ({ page }) => {
  await login(page);
  const frame = await openFirstOpdrachtInEditor(page);
  const src = await page.locator('#editor-frame').getAttribute('src');
  const file = `opdrachten/${new URLSearchParams(src!.split('?')[1]).get('typFile')}`;
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n// laatste regel');
  await frame.locator('#btn-app-title').click(); // within the 600 ms autosave delay
  await expect(page.locator('#editor-overlay')).toBeHidden();
  await expect.poll(() => withMock(page, (m, f) => m.peek(f), file)).toContain('// laatste regel');
});

test('D25: the editor reports a failed load instead of waiting forever', async ({ page }) => {
  await login(page);
  await withMock(page, (m) => m.fail('readTextFile', 'opdrachten/'));
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('[data-action="open-editor"]').first().click();
  const status = page.frameLocator('#editor-frame').locator('#editor-status');
  await expect(status).toContainText('Fout bij laden');
});

test('U9: after a failed save the editor can still be closed, after confirming', async ({
  page,
}) => {
  await login(page);
  const frame = await openFirstOpdrachtInEditor(page);
  await withMock(page, (m) => m.fail('writeTextFile', 'opdrachten/'));
  await frame.locator('.cm-content').click();
  await page.keyboard.type('x');
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void (dialogs.length === 1 ? d.dismiss() : d.accept());
  });
  await frame.locator('#btn-app-title').click(); // save fails -> asks; dismissed: stays open
  await expect.poll(() => dialogs.length).toBe(1);
  await expect(page.locator('#editor-overlay')).toBeVisible();
  await frame.locator('#btn-app-title').click(); // retries, fails, asks again; accepted: closes
  await expect(page.locator('#editor-overlay')).toBeHidden();
  expect(dialogs).toHaveLength(2);
  expect(dialogs[0]).toContain('niet opgeslagen');
});

test('U7: the user dialog keeps the colour attribute intact', async ({ page }) => {
  await page.goto('/');
  const users = await readMockJson<Record<string, unknown>[]>(page, 'gebruikers.json');
  const kleur = '#123456" data-x="1';
  await seedFiles(page, {
    'gebruikers.json': users.map((u) => (u.id === TEACHER ? { ...u, kleur } : u)),
  });
  await login(page, 'nat', 'admin');
  await page.locator('.nav-btn[data-screen="gebruikers"]').click();
  await page.locator(`[data-action="edit-user"][data-id="${TEACHER}"]`).click();
  await expect(page.locator('#f-ukleur')).not.toHaveAttribute('data-x');
});

test('D25: a failed image call in the editor is reported, not swallowed', async ({ page }) => {
  await login(page);
  const frame = await openFirstOpdrachtInEditor(page);
  await withMock(page, (m) => m.fail('listOpdrachtImages', ''));
  await frame.locator('[data-action="figure"]').click();
  await expect(frame.locator('#editor-status')).toContainText('Fout bij afbeelding');
});

test('D34: a group CSV import asks before overwriting an existing group', async ({ page }) => {
  await login(page, 'nat', 'admin');
  const file = `${YEAR}/groups/3a-nat-${YEAR}.json`;
  const added = `${YEAR}/groups/nieuwe-groep-${YEAR}.json`;
  const before = await readMockJson<{ student_ids: number[] }>(page, file);
  expect(before.student_ids.length).toBeGreaterThan(0);
  await page.locator('.nav-btn[data-screen="groepen"]').click();
  await page.locator('#btn-import-groups').click();
  await page.locator('#f-year-ok').click();
  await page.locator('#f-csv-groups').setInputFiles({
    name: 'groepen.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Naam;Schoolsoort;Vak;Leerjaar;Docent\n3a nat;Havo;nat;3;\nnieuwe groep;Havo;nat;3;\n',
    ),
  });
  await page.locator('#f-csv-grp-import').click();

  // Old vs new per overwritten group: its students are removed (red rows).
  const dialog = page.locator('.app-dialog');
  await expect(dialog).toContainText('3a nat');
  await expect(dialog.locator('tr.diff-removed')).toHaveCount(before.student_ids.length);
  await expect(dialog).not.toContainText('nieuwe groep');
  await dialog.getByRole('button', { name: 'Annuleren' }).click();
  expect((await readMockJson<{ student_ids: number[] }>(page, file)).student_ids).toEqual(
    before.student_ids,
  );
  expect(await readMockJson(page, added)).toBeNull();

  await page.locator('#f-csv-grp-import').click();
  await dialog.getByRole('button', { name: 'Overschrijven' }).click();
  await expect
    .poll(async () => (await readMockJson<{ student_ids: number[] }>(page, file)).student_ids)
    .toEqual([]);
  expect(await readMockJson(page, added)).not.toBeNull();
});

test('4b m5: an unusable data folder shows the startup error screen', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __maatwerkMockFolderStatus: unknown }).__maatwerkMockFolderStatus = {
      dataDir: 'D:/OneDrive/Maatwerk/data',
      error: { code: 'unsupported_schema', message: 'unsupported', details: { found: '3' } },
    };
  });
  await page.goto('/');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Maatwerk kan de gegevensmap niet openen');
  await expect(alert).toContainText('nieuwere versie van Maatwerk (schemaversie 3)');
  await expect(alert).toContainText('D:/OneDrive/Maatwerk/data');
  await expect(page.locator('.subject-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Opnieuw proberen' }).click();
  const calls = await withMock(page, (m) => m.calls.map((c) => c[0]));
  expect(calls).toContain('restartApp');
  expect(calls).not.toContain('listYears');
});

test('6a M1: an unsupported logo type is refused with a message', async ({ page }) => {
  await login(page, 'nat', 'admin');
  await page.locator('.nav-btn[data-screen="school"]').click();
  const input = page.locator('#input-logo');
  await expect(input).toHaveAttribute('accept', '.png,.jpg,.jpeg,.gif,.svg,.webp');
  await input.setInputFiles({ name: 'logo.bmp', mimeType: 'image/bmp', buffer: Buffer.from('BM') });
  await expect(page.locator('.toast')).toContainText('Bestandstype .bmp wordt niet ondersteund');
  const calls = await withMock(page, (m) => m.calls.map((c) => c[0]));
  expect(calls).not.toContain('savePhoto');
});

test('M-GRP-1: a deleted group disappears from the admin list', async ({ page }) => {
  await page.goto('/');
  const group = await readMockJson<Record<string, unknown>>(
    page,
    `${YEAR}/groups/3a-nat-${YEAR}.json`,
  );
  const id = `leeg-nat-${YEAR}`;
  await seedFiles(page, {
    [`${YEAR}/groups/${id}.json`]: { ...group, id, name: 'Lege groep', student_ids: [] },
  });
  await login(page, 'nat', 'admin');
  await page.locator('.nav-btn[data-screen="groepen"]').click();
  const del = page.locator(`[data-action="del-group"][data-id="${id}"]`);
  await del.click();
  await page.getByRole('button', { name: 'Verwijderen', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Groep verwijderd');
  await expect(del).toHaveCount(0);
});

test('U20: a file dropped on the editor is ignored', async ({ page }) => {
  await login(page);
  const frame = await openFirstOpdrachtInEditor(page);
  const content = frame.locator('.cm-content');
  const before = await content.textContent();
  const editor = page.frames().find((f) => f.url().includes('editor.html'))!;
  const dataTransfer = await editor.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['GEDROPT'], 'figuur.png', { type: 'image/png' }));
    return dt;
  });
  await content.dispatchEvent('dragover', { dataTransfer });
  await content.dispatchEvent('drop', { dataTransfer });
  await page.waitForTimeout(300); // CodeMirror reads a dropped file asynchronously
  expect(await content.textContent()).toBe(before);
});
