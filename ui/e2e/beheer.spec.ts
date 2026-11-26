// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 28: the Beheer screens (design spec 4.9, board 12): Gebruikers,
// School, Gegevenscontrole (findings as cards), Instellingen (units, the
// snapshots there are), the CSV example (F-02). Every page load starts a fresh MockApi.

import { expect, test, type Page } from '@playwright/test';
import { TEACHER, chooseVak, enterPin, login, withMock } from './helpers';

async function admin(page: Page, tab: string) {
  await login(page, 'nat', 'admin');
  await page.locator(`.nav-btn[data-screen="${tab}"]`).click();
}

test('Gebruikers: 52 px avatars, the amber pill and the action order', async ({ page }) => {
  await admin(page, 'gebruikers');
  const card = page.locator('.gebruiker-card', { has: page.locator(`[data-id="${TEACHER}"]`) });
  await expect(card.locator('.avatar')).toHaveClass(/avatar--52/);
  await expect(card.locator('.pill--amber')).toHaveText('Nog geen pincode');
  const actions = await card
    .locator('.card-actions button')
    .evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.action));
  expect(actions).toEqual(['edit-user', 'toggle-user']); // no PIN yet: no "Pincode resetten"
  await expect(page.locator('.voorzitter-row')).toHaveCount(4);
  await expect(page.locator('.voorzitter-row').first()).toContainText('Natuurkunde');
});

test('School: logo panel and watermark with their buttons', async ({ page }) => {
  await admin(page, 'school');
  await expect(page.getByRole('button', { name: 'Logo wijzigen…' })).toBeVisible();
  await expect(page.locator('.school-logo-wrap')).toContainText('Gebruikt in de rapporten.');
  await expect(page.getByRole('button', { name: 'Watermerk wijzigen…' })).toBeVisible();
  await expect(page.locator('[data-field="watermerk"]')).toContainText('Rechtsonder in de app');
});

test('Gegevenscontrole: a clean check is a green card; findings are cards with actions', async ({
  page,
}) => {
  await admin(page, 'gegevens');
  await expect(page.locator('.gegevens-clean')).toContainText('Geen fouten of waarschuwingen');
  await expect(page.locator('.gegevens-clean')).toContainText(
    /bestanden gecontroleerd · vandaag om \d\d:\d\d/,
  );

  await withMock(page, (m) => {
    m.dataCheck = {
      filesChecked: 238,
      issues: [
        {
          severity: 'warning',
          kind: 'reference',
          path: '2025-2026/exams/x.json',
          message: 'Verwijst naar iets dat niet bestaat.',
        },
        {
          severity: 'error',
          kind: 'corrupt',
          path: '2025-2026/scores/nat/106052.json',
          message: 'De JSON is afgebroken.',
        },
      ],
    };
  });
  await page.getByRole('button', { name: 'Opnieuw controleren' }).click();
  const cards = page.locator('.gegevens-card');
  await expect(cards).toHaveCount(2);
  // Errors first, with a FOUT pill, the message and the path.
  await expect(cards.first().locator('.pill')).toHaveText('FOUT');
  await expect(cards.first()).toContainText('Onleesbaar: De JSON is afgebroken.');
  await expect(cards.first().locator('.gegevens-path')).toHaveText(
    '2025-2026/scores/nat/106052.json',
  );
  await expect(cards.nth(1).locator('.pill')).toHaveText('WAARSCHUWING');
  await expect(page.locator('.gegevens-summary .pill')).toHaveText(['1 fout', '1 waarschuwing']);
  await cards.first().getByRole('button', { name: 'Map openen' }).click();
  const opened = await withMock(page, (m) =>
    m.calls.filter((c) => c[0] === 'openDataFolder').map((c) => c[1]),
  );
  expect(opened).toEqual(['2025-2026/scores/nat']);
});

test('Instellingen: fields with units, Opslaan top right, the snapshots with their kind', async ({
  page,
}) => {
  await page.goto('/');
  await withMock(page, (m) => {
    m.snapshots = [
      { name: '2026-11-04 1118.zip', files: {} },
      { name: '2026-10-28 0905.zip', files: {} },
    ];
  });
  // Not login(): it reloads the page, which starts a fresh MockApi.
  await chooseVak(page, 'nat');
  await page.locator('.user-badge[data-user-id="admin"]').click();
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="instellingen"]').click();
  await expect(page.locator('.screen-header #inst-save')).toBeVisible();
  await expect(page.locator('.unit-input__unit')).toHaveText([
    'uur',
    'dagen',
    'weken',
    'maanden',
    'seconden',
  ]);
  await expect(page.locator('.snapshot-list li')).toHaveText([
    /04-11-2026 11:18\s*dagelijks/,
    /28-10-2026 09:05\s*dagelijks/,
  ]);
  await page.getByRole('button', { name: 'Map openen' }).click();
  const opened = await withMock(page, (m) =>
    m.calls.filter((c) => c[0] === 'openDataFolder').map((c) => c[1]),
  );
  expect(opened).toEqual(['snapshots']);
});

test('Instellingen: the school AI switch is saved in instellingen.json (step 32c)', async ({
  page,
}) => {
  await admin(page, 'instellingen');
  const sw = page.getByRole('switch', { name: 'Docenten mogen de AI-assistent gebruiken' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.inst-ai__tag')).toHaveText('Aan');
  await sw.click();
  await expect(page.locator('.inst-ai__tag')).toHaveText('Uit voor alle docenten');
  await page.locator('#inst-save').click();
  await expect(page.locator('.toast').last()).toContainText('Instellingen opgeslagen');
  const saved = await withMock(page, (m) => JSON.parse(m.peek('instellingen.json') ?? 'null'));
  expect(saved).toMatchObject({ ai: { enabled: false }, editor: { compileTimeoutSeconds: 30 } });
  await expect(
    page.getByRole('switch', { name: 'Docenten mogen de AI-assistent gebruiken' }),
  ).toHaveAttribute('aria-checked', 'false');
});

test('Instellingen: Cijfergemiddelden per average, live examples, saved (step 38)', async ({
  page,
}) => {
  await admin(page, 'instellingen');
  const r = page.getByRole('group', { name: 'Methode Jaargemiddelde (r)' });
  const rDec = page.getByRole('group', { name: 'Decimalen Jaargemiddelde (r)' });
  const examples = page.locator('.inst-gem__list').first();
  await expect(r.getByRole('button', { name: 'Afronden' })).toHaveAttribute('aria-pressed', 'true');
  await expect(examples.locator('b')).toHaveText(['5,5', '5,5', '5,9', '6,7', '7,0']);
  // 2 decimals: 6,666... tells afronden from afkappen (step 39).
  await rDec.getByRole('button', { name: '2' }).click();
  await expect(examples.locator('b').nth(3)).toHaveText('6,67');
  await r.getByRole('button', { name: 'Afkappen' }).click();
  await expect(examples.locator('b').nth(3)).toHaveText('6,66');
  await rDec.getByRole('button', { name: '0' }).click();
  await expect(examples.locator('b')).toHaveText(['5', '5', '5', '6', '6']);
  // The SE column keeps its own format.
  await expect(page.locator('.inst-gem__list').nth(1).locator('b')).toHaveText([
    '5,5',
    '5,5',
    '5,9',
    '6,7',
    '7,0',
  ]);
  await page.locator('#inst-save').click();
  await expect(page.locator('.toast').last()).toContainText('Instellingen opgeslagen');
  const saved = await withMock(page, (m) => JSON.parse(m.peek('instellingen.json') ?? 'null'));
  expect(saved.gemiddelden).toEqual({
    r: { methode: 'afkappen', decimalen: 0 },
    se: { methode: 'afronden', decimalen: 1 },
  });
  await expect(
    page.getByRole('group', { name: 'Methode Jaargemiddelde (r)' }).getByRole('button', {
      name: 'Afkappen',
    }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('F-02: the CSV import shows an example that can be saved', async ({ page }) => {
  await admin(page, 'leerlingen');
  await page.locator('#btn-import-students').click();
  // First the school year, then the import dialog.
  await page.locator('#f-year-ok').click();
  await expect(page.locator('.csv-example__text')).toContainText('Leerlingnummer;Voornaam');
  await page.getByRole('button', { name: 'Voorbeeld opslaan…' }).click();
  const saved = await withMock(page, (m) => m.calls.find((c) => c[0] === 'saveTextAs'));
  expect(saved?.[1]).toBe('Voorbeeld leerlingen.csv');
  expect(String(saved?.[2])).toContain('100001;Anna;de;Vries');
});
