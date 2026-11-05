// SPDX-License-Identifier: AGPL-3.0-or-later

// UI quirks the port fixes (ADR-0002 section 10; docs/reference/quirks.md).
// Each test failed on the imported reference code before its fix.
// Every page load starts a fresh MockApi, so tests do not share data.

import { expect, test, type Page } from '@playwright/test';
import { TEACHER, YEAR, examMenuItem, login, readMockJson, seedFiles, withMock } from './helpers';

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
  const file = `gebruikers/${TEACHER}.json`; // one file per user (C16)
  const user = await readMockJson<Record<string, unknown>>(page, file);
  await seedFiles(page, { [file]: { ...user, voornaam: NASTY, afkorting: '<i>', foto: null } });
  await page.goto('/');
  await page.locator('.subject-card[data-subject="nat"]').click();
  const badge = page.locator(`.user-badge[data-user-id="${TEACHER}"]`);
  await expect(badge.locator('.badge-name')).toHaveText(NASTY);
  await expect(badge.locator('.badge-initials')).toHaveText('<i>');
  await expect(badge.locator('b, i')).toHaveCount(0);
});

test('U6: the RTTI uitleg modal keeps teacher text as typed', async ({ page }) => {
  const file = 'templates/rtti/nat_3.json'; // C11
  await page.goto('/');
  const template = await readMockJson<{ uitleg: Record<string, string> }>(page, file);
  await seedFiles(page, { [file]: { ...template, uitleg: { ...template.uitleg, R: NASTY } } });
  await login(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await page.locator('#btn-toetsen-rtti-uitleg').click();
  await page.locator('.dlg-tabs [role="tab"]', { hasText: /^3$/ }).click();
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
  const id = new URLSearchParams(src!.split('?')[1]).get('id');
  const file = `opdrachten/${id}/opdracht.typ`; // C14
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n// laatste regel');
  await frame.locator('#btn-app-title').click(); // within the 600 ms autosave delay
  await expect(page.locator('#editor-overlay')).toBeHidden();
  await expect.poll(() => withMock(page, (m, f) => m.peek(f), file)).toContain('// laatste regel');
});

test('D25: the editor reports a failed load instead of waiting forever', async ({ page }) => {
  await login(page);
  await withMock(page, (m) => m.fail('readTextFileVersioned', 'opdrachten/'));
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('[data-action="open-editor"]').first().click();
  const status = page.frameLocator('#editor-frame').locator('#editor-status');
  await expect(status).toContainText('Fout bij laden');
});

test('U9: after a failed save the editor can still be closed, after confirming', async ({
  page,
}) => {
  // As in Tauri: tauri-plugin-dialog makes window.confirm async, so it never stops
  // anything; the editor must ask in the app's own dialog (manual test 10, M-OPD-9).
  await page.addInitScript(() => {
    window.confirm = (async () => true) as unknown as typeof window.confirm;
  });
  await login(page);
  const frame = await openFirstOpdrachtInEditor(page);
  await withMock(page, (m) => m.fail('writeTextFile', 'opdrachten/'));
  await frame.locator('.cm-content').click();
  await page.keyboard.type('x');
  const dialog = page.locator('.dlg--confirm');
  await frame.locator('#btn-app-title').click(); // save fails -> asks; cancelled: stays open
  await expect(dialog).toContainText('niet opgeslagen');
  await dialog.getByRole('button', { name: 'Annuleren' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#editor-overlay')).toBeVisible();
  await frame.locator('#btn-app-title').click(); // retries, fails, asks again; accepted: closes
  await dialog.getByRole('button', { name: 'Toch sluiten' }).click();
  await expect(page.locator('#editor-overlay')).toBeHidden();
});

test('U7: the user dialog keeps the colour attribute intact', async ({ page }) => {
  await page.goto('/');
  const file = `gebruikers/${TEACHER}.json`;
  const user = await readMockJson<Record<string, unknown>>(page, file);
  const kleur = '#123456" data-x="1';
  await seedFiles(page, { [file]: { ...user, kleur } });
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
  // New groups get an opaque id (C10): look the new one up by name.
  const added = () =>
    withMock(
      page,
      async (m, dir) => {
        const all = (await m.readAllJson(dir)) as { name?: string }[];
        return all.find((g) => g.name === 'nieuwe groep') ?? null;
      },
      `${YEAR}/groups`,
    );
  const before = await readMockJson<{ student_ids: string[] }>(page, file);
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
  const dialog = page.locator('.dlg--confirm');
  await expect(dialog).toContainText('3a nat');
  await expect(dialog.locator('tr.diff-removed')).toHaveCount(before.student_ids.length);
  await expect(dialog).not.toContainText('nieuwe groep');
  await dialog.getByRole('button', { name: 'Annuleren' }).click();
  expect((await readMockJson<{ student_ids: string[] }>(page, file)).student_ids).toEqual(
    before.student_ids,
  );
  expect(await added()).toBeNull();

  await page.locator('#f-csv-grp-import').click();
  await dialog.getByRole('button', { name: 'Overschrijven' }).click();
  await expect
    .poll(async () => (await readMockJson<{ student_ids: string[] }>(page, file)).student_ids)
    .toEqual([]);
  expect(await added()).not.toBeNull();
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

test('C1: a v1 folder offers the one-time conversion, after a confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __maatwerkMockFolderStatus: unknown }).__maatwerkMockFolderStatus = {
      dataDir: 'D:/OneDrive/Maatwerk/data',
      error: { code: 'needs_migration', message: 'needs migration', details: { found: '1' } },
    };
  });
  await page.goto('/');
  const region = page.getByRole('region', { name: 'Gegevensmap omzetten' });
  await expect(region).toContainText('eenmalig worden omgezet');
  await expect(region).toContainText('D:/OneDrive/Maatwerk/data');
  const go = page.getByRole('button', { name: 'Omzetten' });
  await expect(go).toBeDisabled();
  await page.locator('#migration-confirm').check();
  await go.click();
  await expect(region).toContainText('Gegevensmap omgezet van versie 1 naar 2.');
  await expect(region).toContainText('Back-up:');
  // The report itemises the migration warnings and every check issue (cutover dry run: the
  // warnings were only counted before).
  const report = page.getByRole('region', { name: 'Verslag van het omzetten' });
  await expect(report).toContainText('Verslag (ook na het starten te lezen):');
  await expect(report).toContainText('leerling 1002 stond er dubbel in');
  await expect(report).toContainText('0 fouten, 2 waarschuwingen');
  await expect(report.locator('tbody tr')).toHaveCount(2);
  await expect(report).toContainText('toets-1 (1).json');
  await expect(report).toContainText('verwijst naar groep 4H9');
  await page.getByRole('button', { name: 'Maatwerk starten' }).click();
  const calls = await withMock(page, (m) => m.calls.map((c) => c[0]));
  expect(calls).toEqual(expect.arrayContaining(['migrateDataFolder', 'restartApp']));
  expect(calls).not.toContain('listYears');
});

test('C17: a colleague saved the opdracht meanwhile: keep my text, choose what happens', async ({
  page,
}) => {
  await login(page);
  const frame = await openFirstOpdrachtInEditor(page);
  const src = await page.locator('#editor-frame').getAttribute('src');
  const id = new URLSearchParams(src!.split('?')[1]).get('id');
  const file = `opdrachten/${id}/opdracht.typ`;
  await withMock(page, (m, f) => m.externalWriteText(f, '// versie van de collega\n'), file);
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n// mijn regel');
  const bar = frame.locator('#conflict-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Intussen gewijzigd door een collega');
  // Nothing of mine overwrote theirs, and my text is still in the editor.
  expect(await withMock(page, (m, f) => m.peek(f), file)).toBe('// versie van de collega\n');
  await expect(frame.locator('.cm-content')).toContainText('// mijn regel');

  await frame.getByRole('button', { name: 'Mijn versie bewaren als kopie' }).click();
  await expect(bar).toBeHidden();
  await expect(frame.locator('.cm-content')).toContainText('versie van de collega');
  await expect(frame.locator('#editor-status')).toContainText('(kopie)');
  const copies = await withMock(page, async (m) => {
    const all = (await m.readOpdrachten()) as { id: string; naam: string }[];
    return all.filter((o) => o.naam.endsWith('(kopie)')).map((o) => o.id);
  });
  expect(copies).toHaveLength(1);
  expect(
    await withMock(page, (m, f) => m.peek(f), `opdrachten/${copies[0]}/opdracht.typ`),
  ).toContain('// mijn regel');
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

test('B24: a question added after a deletion gets a new id', async ({ page }) => {
  const examId = `nat-lege-toets-${YEAR}`; // q1..q3, no scores
  await login(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await examMenuItem(page, examId, 'Toets bewerken');
  await page.locator('.qi-del[data-qi="0"]').click();
  await page.locator('#f-addq').click();
  await page.locator('#f-esave').click();
  await expect(page.locator('.dlg-backdrop')).toBeHidden();
  await expect(async () => {
    const exam = await readMockJson<{ questions: { id: string }[] }>(
      page,
      `${YEAR}/exams/${examId}.json`,
    );
    expect(exam.questions.map((q) => q.id)).toEqual(['q2', 'q3', 'q4']);
  }).toPass();
});

test('U8: a resit description is shown as text in the group overview', async ({ page }) => {
  await page.goto('/');
  const resit = await withMock(
    page,
    async (m, year) => {
      const exams = (await m.readAllJson(`${year}/exams`)) as Record<string, unknown>[];
      return exams.find((e) => e.description === 'HERKANSING')!;
    },
    YEAR,
  );
  const NASTY_DESC = `"><b class="u8">x</b>`;
  await seedFiles(page, {
    [`${YEAR}/exams/${resit.id as string}.json`]: { ...resit, description: NASTY_DESC },
  });
  await login(page);
  await page.locator('.nav-btn[data-screen="groepen"]').click();
  await page.getByRole('button', { name: '3a nat', exact: true }).click();
  const badges = page.locator('.dlg .attempt-badge');
  await expect(page.locator('.dlg b.u8')).toHaveCount(0);
  // In the fixture the resit is the best grade of some 3a students.
  await expect(badges.first()).toHaveAttribute('title', NASTY_DESC);
});

test('a migrated config.json without activeYear opens every tab on the current school year', async ({
  page,
}) => {
  // Since Step 7a config.json holds only schema_version; the reference fell back to the
  // current school year when activeYear was missing (user, 2026-11-03).
  await page.clock.setFixedTime(new Date('2025-11-03T12:00:00'));
  await seedFiles(page, { 'config.json': { schema_version: 2 } });
  await login(page);
  for (const [screen, select] of [
    ['leerlingen', '#student-year-select'],
    ['groepen', '#groups-year-select'],
    ['toetsen', '#toetsen-year-select'],
  ] as const) {
    await page.locator(`.nav-btn[data-screen="${screen}"]`).click();
    await expect(page.locator(`${select} .csel-trigger`)).toContainText('2025-2026');
  }
});
