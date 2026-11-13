// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 7c (perceived speed): list screens keep their DOM between visits and
// render again only when what they show may have changed (Store.generation,
// filters, login); long lists and score modals build in stages.

import { expect, test, type Page } from '@playwright/test';
import { YEAR, login, readMockJson, seedFiles, watchErrors, withMock } from './helpers';
import { screen } from './views';
import { EXAMS, cell, gridTable, openGrid, studentIdOf } from './grid-driver';

interface StudentsFile {
  students: { id: string; voornaam: string; achternaam: string }[];
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

/**
 * Opens the app and waits for the start screen. WebKit logs "Importing a module script failed."
 * when the next navigation (login) aborts a page that is still importing app.js.
 */
async function loadApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.subject-card').first()).toBeVisible();
}

// More students than the first batch of cards (60): the rest arrive in idle time.
async function seedManyStudents(page: Page): Promise<StudentsFile> {
  await loadApp(page);
  const file = await readMockJson<StudentsFile>(page, STUDENTS);
  const base = file.students[0]!;
  const extra = Array.from({ length: 150 }, (_, i) => ({
    ...base,
    id: String(990000 + i),
    voornaam: 'Extra',
    achternaam: `Leerling ${String(i).padStart(3, '0')}`,
  }));
  const many = { ...file, students: [...extra, ...file.students] };
  await seedFiles(page, { [STUDENTS]: many });
  return many;
}

test('a long student list renders completely and every card works', async ({ page }) => {
  const errors = watchErrors(page);
  const many = await seedManyStudents(page);
  await login(page);
  await screen(page, 'leerlingen');
  const cards = page.locator('#student-list .card');
  await expect(cards).toHaveCount(many.students.length);
  // A teacher's card is the profile button itself (F-07).
  const last = page.locator('#student-list [data-action="profile"]').last();
  // Playwright's scrolling on WebKit does not reach into a `content-visibility: auto` card;
  // the browser's own scrollIntoView (as a user's scrolling) does.
  await last.evaluate((b) => b.scrollIntoView({ block: 'center' }));
  await last.click();
  await expect(page.locator('.dlg-backdrop')).toBeVisible();
  expect(errors).toEqual([]);
});

test('admin: Verwijderen is blocked for students with scores, also in late cards', async ({
  page,
}) => {
  const many = await seedManyStudents(page);
  // A fixture student with scores sits after the 150 extra students.
  const withScores = await withMock(
    page,
    (m, ids) => ids.find((id) => m.peek(`2025-2026/scores/nat/${id}.json`) !== null) ?? '',
    many.students.slice(150).map((s) => s.id),
  );
  expect(withScores).not.toBe('');
  await login(page, 'nat', 'admin');
  await screen(page, 'leerlingen');
  await expect(page.locator('#student-list .card')).toHaveCount(many.students.length);
  const del = page.locator(`[data-action="del-student"][data-id="${withScores}"]`);
  await expect(del).toBeDisabled();
  await expect(del).toHaveAttribute('title', /scores ingevoerd/);
});

test('score modal: later groups are built after the first and get colleague changes', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // A second group with the same students, sorted after the first.
  await loadApp(page);
  const group = await withMock(
    page,
    async (m, dir) => (await m.readAllJson(dir))[0],
    `${YEAR}/groups`,
  );
  const { _meta, ...rest } = group as { id: string; name: string; _meta?: unknown };
  void _meta;
  await seedFiles(page, {
    [`${YEAR}/groups/kopie.json`]: { ...rest, id: 'kopie', name: `${rest.name} zz` },
  });
  await openGrid(page, EXAMS.empty);
  const headings = page.locator('.dlg .score-group-section .group-heading');
  await expect(headings.filter({ hasText: `${rest.name} zz` })).toHaveCount(1);
  const names = await headings.allTextContents();
  const g0 = names.indexOf(rest.name);
  const g1 = names.indexOf(`${rest.name} zz`);
  await expect(gridTable(page, g1)).toBeVisible();

  const id = await studentIdOf(page, 0, g0);
  await withMock(
    page,
    (m, { f, exam }) =>
      m.externalWrite(f, {
        student_id: Number(f.match(/(\d+)\.json$/)![1]),
        scores: { [exam]: { q1: 3 } },
      }),
    { f: `${YEAR}/scores/nat/${id}.json`, exam: EXAMS.empty },
  );
  await expect(cell(page, 0, 2, g0)).toHaveText('3');
  await expect(cell(page, 0, 2, g1)).toHaveText('3');
  expect(errors).toEqual([]);
});

// Playwright scrolls the button into view before it clicks, and the browser
// delivers that scroll event a frame later, which closes a menu that just
// opened (exam menus close on scroll). Scroll first, let the event pass, click.
async function openExamMenu(page: Page, examId: string): Promise<void> {
  const btn = page.locator(`[data-action="exam-menu"][data-id="${examId}"]`);
  await btn.scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await btn.click();
  await expect(page.locator('.sc-prebuild .score-grid-table').first()).toBeAttached();
}

// Score-modal presence written so far (updatePresence calls with a scoreModal).
const scoreModalPresence = (page: Page) =>
  withMock(
    page,
    (m) =>
      m.calls.filter(
        ([name, , state]) =>
          name === 'updatePresence' && (state as { scoreModal?: unknown })?.scoreModal,
      ).length,
  );

test('the exam menu prebuilds the grids without telling colleagues', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await screen(page, 'toetsen');
  await openExamMenu(page, EXAMS.empty);
  expect(await scoreModalPresence(page)).toBe(0);
  // Mark the prebuilt grid: the modal must show this very table (review 7c m5).
  await page
    .locator('.sc-prebuild .score-grid-table')
    .first()
    .evaluate((t) => t.setAttribute('data-pre', '1'));

  await page.getByRole('menuitem', { name: 'Scores invoeren' }).click();
  await expect(gridTable(page)).toBeVisible();
  await expect(page.locator('.sc-prebuild')).toHaveCount(0);
  await expect(gridTable(page)).toHaveAttribute('data-pre', '1');
  await expect.poll(() => scoreModalPresence(page)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a change while the exam menu is open is in the score modal', async ({ page }) => {
  await login(page);
  await screen(page, 'toetsen');
  await openExamMenu(page, EXAMS.empty);
  const id = await page
    .locator('.sc-prebuild .score-grid-table')
    .first()
    .locator('tbody tr')
    .first()
    .locator('td')
    .first()
    .textContent();
  await withMock(
    page,
    (m, { f, exam }) =>
      m.externalWrite(f, {
        student_id: Number(f.match(/(\d+)\.json$/)![1]),
        scores: { [exam]: { q1: 4 } },
      }),
    { f: `${YEAR}/scores/nat/${id}.json`, exam: EXAMS.empty },
  );
  await page.getByRole('menuitem', { name: 'Scores invoeren' }).click();
  await expect(cell(page, 0, 2)).toHaveText('4');
});

test('review 7c M1: a background refresh of a long list keeps the scroll position', async ({
  page,
}) => {
  const many = await seedManyStudents(page);
  await login(page);
  await screen(page, 'leerlingen');
  await expect(page.locator('#student-list .card')).toHaveCount(many.students.length);
  const scroller = () => page.evaluate(() => document.scrollingElement!.scrollTop);
  await page.evaluate(() => document.scrollingElement!.scrollTo(0, 3000));
  const before = await scroller();
  expect(before).toBeGreaterThan(2000);

  const renamed = structuredClone(many);
  renamed.students[0]!.voornaam = 'Hernoemd';
  await withMock(page, (m, [p, d]) => m.externalWrite(p as string, d as never), [
    STUDENTS,
    renamed,
  ]);
  await expect(page.locator('#student-list')).toContainText('Hernoemd');
  expect(await scroller()).toBe(before);
});
