// SPDX-License-Identifier: AGPL-3.0-or-later

// The only place where the score-grid tests know how the grid is built
// (docs/specs/score-grid.md). Today: Handsontable. When the grid is replaced
// (Step 3b), only this file changes; ui/e2e/score-grid.spec.ts stays as is.

import { expect, type Locator, type Page } from '@playwright/test';
import { YEAR, examMenuItem, login, readMockJson } from './helpers';
import { screen } from './views';

/** The tiny fixture's exams used by the grid tests. */
export const EXAMS = {
  /** 3 questions (5, 5, 4 points), no observaties, no scores yet. */
  empty: `nat-lege-toets-${YEAR}`,
  /** 10 questions, 3 observaties, n-term 0, scores for most students. */
  h2: `nat-toets-h2-${YEAR}`,
};

/** Logs in and opens the score modal of `examId`. */
export async function openGrid(page: Page, examId: string): Promise<void> {
  await login(page);
  await screen(page, 'toetsen');
  await examMenuItem(page, examId, 'Scores invoeren');
  await expect(gridTable(page)).toBeVisible();
}

/** The table of the g-th group grid in the modal (0 = first). */
export function gridTable(page: Page, g = 0): Locator {
  return page.locator('#modal-box .ht_master .htCore').nth(g);
}

/** Data and summary rows of a grid (header rows excluded). */
export function rows(page: Page, g = 0): Locator {
  return gridTable(page, g).locator('tbody tr');
}

export function cell(page: Page, row: number, col: number, g = 0): Locator {
  return rows(page, g).nth(row).locator('td').nth(col);
}

/** Header cell texts of the last header row (one per column). */
export async function headerTexts(page: Page, g = 0): Promise<string[]> {
  const header = page.locator('#modal-box .ht_master .htCore thead').nth(g);
  // textContent: Handsontable shows a clone of the header; the master one is hidden.
  return (await header.locator('tr').last().locator('th').allTextContents()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
}

/** Selected cell [row, col] of grid g, or null. */
export async function selected(page: Page, g = 0): Promise<[number, number] | null> {
  return gridTable(page, g).evaluate((table) => {
    const td = table.querySelector('td.current');
    if (!td) return null;
    const tr = td.parentElement as HTMLTableRowElement;
    return [tr.sectionRowIndex, (td as HTMLTableCellElement).cellIndex];
  });
}

/** Selects a cell without editing it. */
export async function select(page: Page, row: number, col: number, g = 0): Promise<void> {
  await cell(page, row, col, g).click();
  await expect.poll(() => selected(page, g)).toEqual([row, col]);
}

/** Types into the selected cell and commits with Enter. */
export async function typeInto(
  page: Page,
  row: number,
  col: number,
  text: string,
  g = 0,
): Promise<void> {
  await select(page, row, col, g);
  if (text === '') {
    // Clear through the editor: F2 opens it, then select all and delete.
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
  } else {
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Enter');
}

/** The leerlingnummer shown in a row. */
export async function studentIdOf(page: Page, row: number, g = 0): Promise<string> {
  return (await cell(page, row, 0, g).innerText()).trim();
}

/** The student's scores for `examId` as stored by the MockApi. */
export async function storedScores(
  page: Page,
  studentId: string,
  examId: string,
): Promise<Record<string, unknown> | undefined> {
  const rec = await readMockJson<{ scores?: Record<string, Record<string, unknown>> } | null>(
    page,
    `${YEAR}/scores/nat/${studentId}.json`,
  );
  return rec?.scores?.[examId];
}
