// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 7c: list screens keep their DOM between visits and render again only
// when what they show may have changed (Store.generation, filters, login).

import { expect, test, type Page } from '@playwright/test';
import { YEAR, login, readMockJson, watchErrors, withMock } from './helpers';
import { screen } from './views';

interface StudentsFile {
  students: { id: string; voornaam: string }[];
}

const STUDENTS = `${YEAR}/students-${YEAR}.json`;

// Marks the first student card; a render replaces the cards and drops the mark.
const markFirstCard = (page: Page) =>
  page
    .locator('#student-list .card')
    .first()
    .evaluate((el) => el.setAttribute('data-kept', '1'));
const marked = (page: Page) => page.locator('#student-list [data-kept]');

test('a screen keeps its DOM until its data or the filters change', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await screen(page, 'leerlingen');
  await markFirstCard(page);

  // Nothing changed: the same cards come back.
  await screen(page, 'groepen');
  await screen(page, 'leerlingen');
  await expect(marked(page)).toHaveCount(1);

  // A colleague renames a student while another tab is shown: rendered again.
  const file = await readMockJson<StudentsFile>(page, STUDENTS);
  const renamed = structuredClone(file);
  renamed.students[0]!.voornaam = 'Hernoemd';
  await screen(page, 'groepen');
  await withMock(page, (m, [p, d]) => m.externalWrite(p as string, d as never), [
    STUDENTS,
    renamed,
  ]);
  await screen(page, 'leerlingen');
  await expect(page.locator('#student-list')).toContainText('Hernoemd');
  await expect(marked(page)).toHaveCount(0);

  // A filter change on another tab also renders it again.
  await markFirstCard(page);
  await screen(page, 'toetsen');
  await page.locator('#btn-filter-eigen').click();
  await page.locator('#btn-filter-eigen').click();
  await screen(page, 'leerlingen');
  await expect(marked(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
