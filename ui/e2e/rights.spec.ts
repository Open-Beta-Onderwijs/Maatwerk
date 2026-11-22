// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 35 (PLAN-2 decisions 78-80): the score lock, the sectiesecretaris and the role at login.
// Teacher A (the fixture teacher) has 3a and the cluster, teacher B (`gebr-b`, also the
// voorzitter) has 3b (po-seed's two students), S (`gebr-s`) is the secretaris without groups.

import { expect, test, type Page } from '@playwright/test';
import { EXAMS, cell, gridTable, select, storedScores, typeInto } from './grid-driver';
import {
  TEACHER,
  YEAR,
  chooseVak,
  enterPin,
  examMenuItem,
  login,
  logout,
  readMockJson,
  seedFiles,
  watchErrors,
  withMock,
} from './helpers';
import { CLASS_3B, NEW_STUDENTS, PO_ID, poExam, poSeed } from './po-seed';

const B = 'gebr-b';
const S = 'gebr-s';
const Q1 = 2; // first question column of Toets H2
const OBS1 = 13; // its first observatie column
/** Sections in name order: "3 nat cluster", "3a nat", "3b nat". */
const G3B = 2;

const user = (id: string, voornaam: string, achternaam: string) => ({
  id,
  voornaam,
  tussenvoegsel: '',
  achternaam,
  afkorting: voornaam.slice(0, 3).toUpperCase(),
  vakken: ['nat'],
  schoolsoort: ['Havo', 'Vwo'],
  kleur: '#2e86de',
  foto: null,
  isAdmin: false,
  actief: true,
  _meta: { rev: 1 },
});

async function seed(page: Page, po = false): Promise<void> {
  const files = await poSeed(page, { po });
  const school = await readMockJson<Record<string, unknown>>(page, 'school.json');
  files['school.json'] = { ...school, secties: { nat: { voorzitter: B, secretaris: S } } };
  files[`gebruikers/${B}.json`] = user(B, 'Bea', 'Bos');
  files[`gebruikers/${S}.json`] = user(S, 'Sam', 'Smit');
  const group = files[`${YEAR}/groups/${CLASS_3B}.json`] as Record<string, unknown>;
  files[`${YEAR}/groups/${CLASS_3B}.json`] = { ...group, docenten: [B] };
  if (po) {
    files[`${YEAR}/exams/${PO_ID}.json`] = poExam({
      projectgroepen: [
        { id: 'pg-1', naam: 'Valtoren', student_ids: ['900001', NEW_STUDENTS[0]] },
        { id: 'pg-3', naam: 'Alleen 3b', student_ids: [NEW_STUDENTS[1]] },
      ],
    });
  }
  await seedFiles(page, files);
}

async function openH2(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await examMenuItem(page, EXAMS.h2, 'Scores invoeren');
  await expect(gridTable(page, G3B)).toBeVisible();
}

test('a teacher changes only the scores of own students; other groups are locked', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await seed(page);
  await login(page);
  await openH2(page);
  const section = page.locator('.score-group-section').nth(G3B);
  await expect(section).toHaveClass(/score-group-section--locked/);
  await expect(section.locator('.sc-group-lock')).toHaveAttribute(
    'title',
    'Alleen-lezen: Bea Bos of Sam Smit (als Sectiesecretaris) kan deze scores wijzigen.',
  );
  await expect(page.locator('.sc-group-lock')).toHaveCount(1);
  await expect(cell(page, 0, Q1, G3B)).toHaveClass(/sc-locked/);
  await expect(cell(page, 0, Q1, 1)).not.toHaveClass(/sc-locked/);
  // A locked row keeps its observatie boxes, disabled (manual check 35-36); a click does nothing.
  const lockedBox = cell(page, 0, OBS1, G3B).locator('input[type="checkbox"]');
  await expect(lockedBox).toBeDisabled();
  await expect(cell(page, 0, OBS1, 1).locator('input[type="checkbox"]')).toBeEnabled();
  await lockedBox.click({ force: true });
  await expect(lockedBox).not.toBeChecked();

  // Typing, Delete and a paste do nothing on a locked row.
  await typeInto(page, 0, Q1, '3', G3B);
  await select(page, 1, Q1, G3B);
  await page.keyboard.press('Delete');
  expect(await storedScores(page, NEW_STUDENTS[0]!, EXAMS.h2)).toBeUndefined();
  expect(await storedScores(page, NEW_STUDENTS[1]!, EXAMS.h2)).toBeUndefined();
  // An own row still saves.
  await typeInto(page, 0, Q1, '2', 1);
  await expect.poll(() => storedScores(page, '900001', EXAMS.h2)).toMatchObject({});

  // The backend refuses the write too (the core's rule, mirrored by the mock).
  const refused = await withMock(
    page,
    (m, rel) => m.writeJson(rel, { student_id: '900101', scores: { x: { q: 1 } } }),
    `${YEAR}/scores/nat/${NEW_STUDENTS[0]}.json`,
  );
  expect(refused).toMatchObject({ ok: false });
  expect((refused as { reason: string }).reason).toContain('niet in een van je groepen');
  expect(errors).toEqual([]);
});

test('the secretaris logs in through the SECTIESECRETARIS badge and changes every score', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/');
  await chooseVak(page, 'nat');
  await expect(page.locator('.login-group-label')).toHaveText([
    'DOCENTEN',
    'SECTIEVOORZITTER',
    'SECTIESECRETARIS',
    'BEHEER',
  ]);
  await page.locator(`.badge-secretaris[data-secretaris-id="${S}"]`).click();
  await expect(page.locator('.login-pin-role')).toHaveText('Sectiesecretaris · Natuurkunde');
  await enterPin(page);
  await expect(page.locator('#user-badge-btn')).toHaveAttribute('title', /Sectiesecretaris/);
  await openH2(page);
  await expect(page.locator('.sc-group-lock')).toHaveCount(0);
  await expect(page.locator('td.sc-locked')).toHaveCount(0);
  await typeInto(page, 0, Q1, '3', G3B);
  await expect
    .poll(() => storedScores(page, NEW_STUDENTS[0]!, EXAMS.h2))
    .toEqual(expect.objectContaining({}));
  expect(Object.values((await storedScores(page, NEW_STUDENTS[0]!, EXAMS.h2)) ?? {})).toContain(3);

  // As a plain teacher S has no groups: everything is locked.
  await page.keyboard.press('Escape');
  await logout(page);
  await chooseVak(page, 'nat');
  await page.locator(`.user-badge[data-user-id="${S}"]`).click();
  await enterPin(page);
  await openH2(page);
  await expect(page.locator('.sc-group-lock')).toHaveCount(3);
});

test('a removed secretaris loses the role at the next write', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await chooseVak(page, 'nat');
  await page.locator(`.badge-secretaris[data-secretaris-id="${S}"]`).click();
  await enterPin(page);
  // The admin (on another PC) removes S as secretaris.
  await withMock(page, (m) => {
    const school = JSON.parse(m.peek('school.json')!);
    school.secties = { nat: { voorzitter: 'gebr-b' } };
    return m.writeJson('school.json', school);
  });
  const refused = await withMock(
    page,
    (m, rel) => m.writeJson(rel, { student_id: '900101', scores: { x: { q: 1 } } }),
    `${YEAR}/scores/nat/${NEW_STUDENTS[0]}.json`,
  );
  expect(refused).toMatchObject({ ok: false });
});

test('the admin assigns a sectiesecretaris next to the voorzitter', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await chooseVak(page, 'nat');
  await page.locator('.user-badge[data-user-id="admin"]').click();
  await enterPin(page);
  await page.locator('.nav-btn[data-screen="gebruikers"]').click();
  await expect(page.locator('#sec-nat')).toHaveValue(S);
  // The voorzitter is not offered as secretaris, and the other way round.
  await expect(page.locator(`#sec-nat option[value="${B}"]`)).toHaveCount(0);
  await expect(page.locator(`#vz-nat option[value="${S}"]`)).toHaveCount(0);
  await page.locator('#sec-nat').selectOption(TEACHER);
  await expect(page.locator('.toast').last()).toHaveText(
    'Sectiesecretaris Natuurkunde opgeslagen.',
  );
  const school = await readMockJson<{ secties: Record<string, unknown> }>(page, 'school.json');
  expect(school.secties).toEqual({ nat: { voorzitter: B, secretaris: TEACHER } });
  // Clearing the voorzitter keeps the secretaris.
  await page.locator('#vz-nat').selectOption('');
  await expect(page.locator('.toast').last()).toHaveText(
    'Sectievoorzitter Natuurkunde opgeslagen.',
  );
  expect((await readMockJson<{ secties: unknown }>(page, 'school.json')).secties).toEqual({
    nat: { secretaris: TEACHER },
  });
});

test('PO: a mixed projectgroep may be graded, not another teacher’s own lines or group', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await seed(page, true);
  await login(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await examMenuItem(page, PO_ID, 'Scores invoeren');
  await expect(page.locator('.dlg--po-scores')).toBeVisible();

  await page.locator('[data-grade-group="pg-1"]').click();
  const d = page.locator('.dlg--po-grade');
  await expect(d.locator('.po-gr-lock')).toHaveCount(0);
  await expect(d.locator('input[type=range]').first()).toBeEnabled();
  const bLines = d.locator(`.po-gr-member-lines[data-member="${NEW_STUDENTS[0]}"]`);
  await expect(bLines).toHaveClass(/po-gr-member-lines--locked/);
  await expect(bLines.locator('[data-add-line="own"]')).toBeDisabled();
  await expect(
    d.locator('.po-gr-member-lines[data-member="900001"] [data-add-line="own"]'),
  ).toBeEnabled();
  await d.locator('#po-gr-overall').fill('Samen goed gedaan.');
  await d.locator('#po-gr-done').click();
  await expect(d).toHaveCount(0);
  await expect
    .poll(async () => {
      const rec = await readMockJson<{ po?: Record<string, { comment?: string }> }>(
        page,
        `${YEAR}/scores/nat/${NEW_STUDENTS[0]}.json`,
      );
      return rec?.po?.[PO_ID]?.comment;
    })
    .toBe('Samen goed gedaan.');

  // A projectgroep with only B's student: read-only.
  await page.locator('[data-grade-group="pg-3"]').click();
  await expect(d.locator('.po-gr-lock')).toContainText('Alleen-lezen');
  await expect(d.locator('input[type=range]').first()).toBeDisabled();
  await expect(d.locator('#po-gr-overall')).toBeDisabled();
  expect(errors).toEqual([]);
});
