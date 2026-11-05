// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 7b on the mock build: PIN login, the admin's recovery codes and PIN
// reset, the sectievoorzitter role, Instellingen and "Herstellen uit snapshot".
// The mock stores PINs as `mock$<pin>`; the rules match maatwerk-core::auth.

import { expect, test, type Page } from '@playwright/test';
import {
  PIN,
  TEACHER,
  YEAR,
  enterPin,
  login,
  logout,
  readMockJson,
  watchErrors,
  withMock,
} from './helpers';

type User = { pinHash?: string; recoveryCodeHashes?: string[]; _meta: { rev: number } };

async function pickUser(page: Page, userId: string, subject = 'nat') {
  await page.locator(`.subject-card[data-subject="${subject}"]`).click();
  await page.locator(`.user-badge[data-user-id="${userId}"]`).click();
}

test('a teacher chooses a PIN at the first login and needs it the next time', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await pickUser(page, TEACHER);
  await page.locator('#pin-new').fill('123');
  await page.locator('#pin-repeat').fill('123');
  await page.locator('#pin-ok').click();
  await expect(page.locator('.pin-error')).toHaveText('Een pincode heeft 4 tot 8 cijfers.');
  await page.locator('#pin-new').fill(PIN);
  await page.locator('#pin-repeat').fill('54321');
  await page.locator('#pin-ok').click();
  await expect(page.locator('.pin-error')).toHaveText('De twee pincodes zijn niet gelijk.');
  await page.locator('#pin-repeat').fill(PIN);
  await page.locator('#pin-ok').click();
  await expect(page.locator('#user-badge-btn')).toBeVisible();
  const user = await readMockJson<User>(page, `gebruikers/${TEACHER}.json`);
  expect(user.pinHash).toBe(`mock$${PIN}`);
  expect(user.recoveryCodeHashes).toBeUndefined();

  await logout(page);
  expect(await withMock(page, (m) => m.loggedIn)).toBeNull();
  await pickUser(page, TEACHER);
  // Wrong twice: the second one makes the next try wait.
  await page.locator('#pin-input').fill('99999');
  await page.locator('#pin-ok').click();
  await expect(page.locator('.pin-error')).toHaveText('Onjuiste pincode.');
  await page.locator('#pin-input').fill('99999');
  await page.locator('#pin-ok').click();
  await expect(page.locator('.pin-error')).toContainText('Probeer het over 2 seconden opnieuw');
  await expect(page.locator('#pin-ok')).toBeDisabled();
  await expect(page.locator('#pin-ok')).toBeEnabled({ timeout: 4000 });
  await page.locator('#pin-input').fill(PIN);
  await page.locator('#pin-input').press('Enter');
  await expect(page.locator('#user-badge-btn')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a teacher changes the PIN in the account modal', async ({ page }) => {
  await login(page);
  await page.locator('#user-badge-btn').click();
  await page.locator('#acc-pin').click();
  await page.locator('#pin-current').fill(PIN);
  await page.locator('#pin-new').fill('7654321');
  await page.locator('#pin-repeat').fill('7654321');
  await page.locator('#pin-ok').click();
  await expect(page.locator('.toast').last()).toHaveText('Pincode gewijzigd.');
  const user = await readMockJson<User>(page, `gebruikers/${TEACHER}.json`);
  expect(user.pinHash).toBe('mock$7654321');
});

test('the admin gets recovery codes once and can log in with one', async ({ page }) => {
  await page.goto('/');
  await pickUser(page, 'admin');
  await page.locator('#pin-new').fill(PIN);
  await page.locator('#pin-repeat').fill(PIN);
  await page.locator('#pin-ok').click();
  const codes = page.locator('.recovery-codes code');
  await expect(codes).toHaveCount(10);
  const first = (await codes.first().textContent())!;
  expect(first).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  await page.locator('#codes-save').click();
  const saved = await withMock(page, (m) => m.calls.find((c) => c[0] === 'saveTextAs'));
  expect(saved?.[1]).toBe('Maatwerk herstelcodes.txt');
  expect(String(saved?.[2])).toContain(first);
  await expect(page.locator('#codes-done')).toBeDisabled();
  await page.locator('#codes-kept').check();
  await page.locator('#codes-done').click();
  await expect(page.locator('#user-badge-btn')).toBeVisible();

  await logout(page);
  await pickUser(page, 'admin');
  await page.locator('#pin-forgot').click();
  await page.locator('#pin-code').fill(first.replace('-', '').toLowerCase());
  await page.locator('#pin-new').fill('24680');
  await page.locator('#pin-repeat').fill('24680');
  await page.locator('#pin-ok').click();
  await expect(page.locator('#user-badge-btn')).toBeVisible();
  const admin = await readMockJson<User>(page, 'gebruikers/admin.json');
  expect(admin.pinHash).toBe('mock$24680');
  expect(admin.recoveryCodeHashes).toHaveLength(9);
});

test('the admin resets a teacher PIN; the teacher chooses a new one', async ({ page }) => {
  await login(page); // the teacher sets PIN
  await logout(page);
  await pickUser(page, 'admin');
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="gebruikers"]').click();
  await page.locator(`[data-action="reset-pin"][data-id="${TEACHER}"]`).click();
  await page.locator('.dlg--confirm [data-action="ok"]').click();
  await expect(page.locator(`[data-action="reset-pin"][data-id="${TEACHER}"]`)).toHaveCount(0);
  const user = await readMockJson<User>(page, `gebruikers/${TEACHER}.json`);
  expect(user.pinHash).toBeUndefined();

  await logout(page);
  await pickUser(page, TEACHER);
  await expect(page.locator('#pin-new')).toBeVisible();
});

test('the user form keeps the PIN fields it does not show', async ({ page }) => {
  await login(page);
  await logout(page);
  await pickUser(page, 'admin');
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="gebruikers"]').click();
  await page.locator(`[data-action="edit-user"][data-id="${TEACHER}"]`).click();
  await page.locator('#f-utussen').fill('van');
  await page.locator('#f-u-save').click();
  await expect(page.locator('.toast').last()).toContainText('opgeslagen');
  const user = await readMockJson<User & { tussenvoegsel: string }>(
    page,
    `gebruikers/${TEACHER}.json`,
  );
  expect(user.tussenvoegsel).toBe('van');
  expect(user.pinHash).toBe(`mock$${PIN}`);
});

test('a sectievoorzitter edits only the composition and teachers of the vak groups', async ({
  page,
}) => {
  await page.goto('/');
  await pickUser(page, 'admin');
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="gebruikers"]').click();
  await page.locator('#vz-nat').selectOption(TEACHER);
  await expect(page.locator('.toast').last()).toHaveText(
    'Sectievoorzitter Natuurkunde opgeslagen.',
  );
  const school = await readMockJson<{ secties: Record<string, { voorzitter: string }> }>(
    page,
    'school.json',
  );
  expect(school.secties).toEqual({ nat: { voorzitter: TEACHER } });

  // As a regular teacher: no group editing.
  await logout(page);
  await pickUser(page, TEACHER);
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="groepen"]').click();
  await expect(page.locator('[data-action="edit-group"]')).toHaveCount(0);

  // Through the sectievoorzitter badge (same PIN): edit button, locked fields.
  await logout(page);
  await page.locator('.subject-card[data-subject="nat"]').click();
  const badge = page.locator(`.badge-voorzitter[data-voorzitter-id="${TEACHER}"]`);
  await expect(badge).toContainText('Sectievoorzitter');
  await badge.click();
  await expect(page.locator('.pin-role')).toHaveText('Sectievoorzitter Natuurkunde');
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="groepen"]').click();
  const group = `3a-nat-${YEAR}`;
  await page.locator(`[data-action="edit-group"][data-id="${group}"]`).click();
  await expect(page.locator('#f-gname')).toBeDisabled();
  await expect(page.locator('.jl-toggle').first()).toBeDisabled();
  await expect(page.locator('.docent-toggle').first()).toBeEnabled();
  await expect(page.locator('[data-action="del-group"]')).toHaveCount(0);
  await page.locator('.docent-toggle').first().click();
  await page.locator('#f-g-save').click();
  await expect(page.locator('.toast').last()).toHaveText('Groep opgeslagen.');
  const saved = await readMockJson<{ _meta: { updatedBy: string } }>(
    page,
    `${YEAR}/groups/${group}.json`,
  );
  expect(saved._meta.updatedBy).toBe(TEACHER);
  // Not the schk groups (another vak).
  await logout(page);
  await page.locator('.subject-card[data-subject="schk"]').click();
  await expect(page.locator('.badge-voorzitter')).toHaveCount(0);
});

test('the admin sets the snapshot interval in Instellingen', async ({ page }) => {
  await page.goto('/');
  await withMock(page, (m) => {
    m.snapshots = [{ name: '2026-10-31 0815.zip', files: {} }];
  });
  await pickUser(page, 'admin');
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="instellingen"]').click();
  await expect(page.locator('.snapshot-list li')).toHaveText(['31-10-2026 08:15']);
  await page.locator('#inst-intervalHours').fill('0');
  await page.locator('#inst-save').click();
  await expect(page.locator('.toast').last()).toContainText('heel getal van 1 tot en met 744');
  await page.locator('#inst-intervalHours').fill('12');
  await page.locator('#inst-save').click();
  await expect(page.locator('.toast').last()).toHaveText('Instellingen opgeslagen.');
  const saved = await readMockJson<{ snapshots: unknown; _meta: { rev: number } }>(
    page,
    'instellingen.json',
  );
  expect(saved.snapshots).toEqual({ intervalHours: 12, daily: 7, weekly: 4, monthly: 12 });
  expect(saved._meta.rev).toBe(1);
});

test('the admin sets the editor compile time limit; the editor uses it', async ({ page }) => {
  await page.goto('/');
  await pickUser(page, 'admin');
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="instellingen"]').click();
  const input = page.locator('#inst-compileTimeoutSeconds');
  await expect(input).toHaveValue('30');
  await input.fill('1');
  await page.locator('#inst-save').click();
  await expect(page.locator('.toast').last()).toContainText('heel getal van 2 tot en met 300');
  await input.fill('5');
  await page.locator('#inst-save').click();
  await expect(page.locator('.toast').last()).toHaveText('Instellingen opgeslagen.');
  const saved = await readMockJson<{ editor: unknown; snapshots: unknown }>(
    page,
    'instellingen.json',
  );
  expect(saved.editor).toEqual({ compileTimeoutSeconds: 5 });
  expect(saved.snapshots).toEqual({ intervalHours: 24, daily: 7, weekly: 4, monthly: 12 });

  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('[data-action="open-editor"]').first().click();
  const frame = page.frameLocator('#editor-frame');
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n#traag');
  await frame.locator('#btn-render-error').click();
  await expect(frame.locator('#error-popover')).toContainText('langer dan 5 seconden');
});

test('a file changed outside Maatwerk is restored from a snapshot', async ({ page }) => {
  const file = `gebruikers/${TEACHER}.json`;
  await page.goto('/');
  const original = await readMockJson<Record<string, unknown>>(page, file);
  await withMock(
    page,
    (m, a) => {
      m.dataCheck = {
        filesChecked: 10,
        issues: [
          {
            severity: 'warning',
            kind: 'stamp',
            path: a.file,
            message: 'Buiten Maatwerk gewijzigd',
          },
        ],
      };
      m.snapshots = [
        { name: '2026-10-30 0800.zip', files: { [a.file]: { ...a.original, voornaam: 'Terug' } } },
      ];
    },
    { file, original },
  );
  await pickUser(page, 'admin');
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="gegevens"]').click();
  await page.getByRole('button', { name: 'Herstellen uit snapshot' }).click();
  await expect(page.locator('.dlg--confirm')).toContainText('30-10-2026 08:00');
  await page.locator('.dlg--confirm [data-action="ok"]').click();
  await expect(page.locator('.gegevens-summary')).toContainText('Geen fouten of waarschuwingen');
  const restored = await readMockJson<{ voornaam: string }>(page, file);
  expect(restored.voornaam).toBe('Terug');
});
