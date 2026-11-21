// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 36 (PLAN-2 decisions 81-82): the Gastaccount of a sectie reads everything and writes
// nothing; "Kopieer naar…" copies an opdracht to another sectie as a teacher there.

import { expect, test, type Page } from '@playwright/test';
import { EXAMS, cell, gridTable } from './grid-driver';
import {
  YEAR,
  chooseVak,
  enterPin,
  examMenuItem,
  readMockJson,
  seedFiles,
  watchErrors,
  withMock,
} from './helpers';

const BIO = 'gebr-1756713600002'; // Docent Leven, bio
const BIO_PIN = '24680';

async function seed(page: Page, gast = true): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.subject-card').first()).toBeVisible();
  const school = await readMockJson<Record<string, unknown>>(page, 'school.json');
  const bio = await readMockJson<Record<string, unknown>>(page, `gebruikers/${BIO}.json`);
  await seedFiles(page, {
    'school.json': { ...school, secties: gast ? { nat: { gast: true } } : {} },
    [`gebruikers/${BIO}.json`]: { ...bio, pinHash: `mock$${BIO_PIN}` },
  });
}

async function loginGast(page: Page): Promise<void> {
  await page.goto('/');
  await chooseVak(page, 'nat');
  await expect(page.locator('.login-group[data-role="gast"] h2')).toHaveText('GAST');
  await page.locator('.badge-gast[data-gast-id="gast-nat"]').click();
  await expect(page.locator('#topbar')).toBeVisible();
}

test('the admin switches the Gastaccount of a sectie on', async ({ page }) => {
  await seed(page, false);
  await page.goto('/');
  await chooseVak(page, 'nat');
  await expect(page.locator('.badge-gast')).toHaveCount(0);
  await page.locator('.user-badge[data-user-id="admin"]').click();
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="gebruikers"]').click();
  await page.locator('input[data-gast-vak="nat"]').check();
  await expect(page.locator('.toast').last()).toHaveText('Gastaccount Natuurkunde aangezet.');
  const school = await readMockJson<{ secties: Record<string, unknown> }>(page, 'school.json');
  expect(school.secties).toEqual({ nat: { gast: true } });
});

test('a gast logs in without a PIN and nothing is writable on any tab', async ({ page }) => {
  const errors = watchErrors(page);
  await seed(page);
  await loginGast(page);
  await expect(page.locator('#gast-pill')).toBeVisible();
  await expect(page.locator('#gast-pill')).toHaveText('Alleen lezen (gast)');
  await expect(page.locator('html')).toHaveAttribute('data-gast', '');

  const tabs = page.locator('.nav-btn:visible');
  const names = await tabs.evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.screen));
  expect(names.length).toBeGreaterThan(3);
  for (const name of names) {
    await page.locator(`.nav-btn[data-screen="${name}"]`).click();
    await expect(page.locator(`#screen-${name}`)).toBeVisible();
    await expect(page.locator('[data-write]:visible')).toHaveCount(0);
  }

  // Toetsen: only what reads; Opdrachten genereren is off.
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await expect(async () => {
    await page.locator(`[data-action="exam-menu"][data-id="${EXAMS.h2}"]`).first().click();
    await expect(page.getByRole('menuitem', { name: 'Overzicht openen' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText([
    'Scores invoeren',
    'Overzicht openen',
    'Rapport genereren',
    'Opdrachten genereren',
  ]);
  await expect(page.getByRole('menuitem', { name: 'Opdrachten genereren' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');

  // The score grid is read-only throughout.
  await examMenuItem(page, EXAMS.h2, 'Scores invoeren');
  await expect(gridTable(page, 0)).toBeVisible();
  await expect(cell(page, 0, 2, 0)).toHaveClass(/sc-locked/);
  await expect(page.locator('#sc-nterm .spin-val')).toBeDisabled();
  await page.keyboard.press('Escape');

  // The backend (mock) refuses writes; presence is allowed.
  const refused = await withMock(
    page,
    (m, rel) => m.writeJson(rel, { x: 1 }),
    `${YEAR}/exams/x.json`,
  );
  expect(refused).toMatchObject({ ok: false, reason: 'read_only' });

  // The user menu has no PIN or photo item.
  await page.locator('#user-badge-btn').click();
  await expect(page.locator('#acc-pin')).toHaveCount(0);
  await expect(page.locator('#acc-photo')).toHaveCount(0);
  await expect(page.locator('.user-menu__role')).toContainText('Gast');
  await page.locator('#acc-logout').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-gast', '');
  expect(errors).toEqual([]);
});

test('Kopieer naar…: a wrong PIN copies nothing, the right one copies as that teacher', async ({
  page,
}) => {
  await seed(page);
  await loginGast(page);
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  const count = () => withMock(page, async (m) => (await m.readOpdrachten()).length);
  const before = await count();
  await page.locator('[data-action="opd-menu"][data-id="opdracht_1756713600200"]').click();
  await page.getByRole('menuitem', { name: 'Kopieer naar…' }).click();
  const d = page.locator('.dlg').last();
  await expect(d.locator('.dlg-title')).toHaveText('Kopieer naar…');
  await expect(d).toContainText('gekoppelde observatie');
  await d.locator('#kn-vak').selectOption('bio');
  await d.locator('#kn-docent').selectOption(BIO);
  await d.locator('#kn-pin').fill('11111');
  await d.locator('#kn-ok').click();
  await expect(d.locator('.pin-error')).not.toBeEmpty();
  expect(await count()).toBe(before);

  // The PIN field is emptied after a wrong PIN; the first wrong one has no wait.
  await d.locator('#kn-pin').fill(BIO_PIN);
  await expect(d.locator('#kn-ok')).toBeEnabled();
  await d.locator('#kn-ok').click();
  await expect(page.locator('.toast').last()).toContainText('Gekopieerd naar Biologie');
  const all = (await withMock(page, (m) => m.readOpdrachten())) as {
    vakken?: string[];
    observaties?: string[];
    _meta?: { createdBy?: string };
  }[];
  expect(all.length).toBe(before + 1);
  const copy = all.find((c) => c.vakken?.[0] === 'bio' && c._meta?.createdBy === BIO);
  expect(copy).toBeTruthy();
  expect(copy!.observaties).toEqual([]);
});
