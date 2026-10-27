// SPDX-License-Identifier: AGPL-3.0-or-later

// The score grid against its behaviour spec (docs/specs/score-grid.md, ids
// G..). Written against Handsontable first; the own grid (Step 3b) passes the
// same tests (only e2e/grid-driver.ts changed). The new grid fixes U2, U4 and
// U19, which were pinned here as known failures on Handsontable.

import { expect, test, type Page } from '@playwright/test';
import {
  EXAMS,
  cell,
  header,
  headerTexts,
  isMarkedUnsaved,
  openGrid,
  rows,
  select,
  selected,
  storedScores,
  studentIdOf,
  typeInto,
} from './grid-driver';
import { YEAR, readMockJson, withMock } from './helpers';

// Column indices. Lege toets: 3 questions, no observaties.
const E = { q1: 2, q2: 3, q3: 4, totaal: 6, cijfer: 7, columns: 13 };
// Toets H2: 10 questions, 3 observaties.
const H2 = { q1: 2, q10: 11, obs1: 13, obs3: 15, totaal: 17, cijfer: 18, columns: 24 };

const bg = (page: Page, row: number, col: number) =>
  cell(page, row, col).evaluate((td) => getComputedStyle(td).backgroundColor);

async function storedObservations(page: Page, studentId: string, examId: string) {
  const rec = await readMockJson<{ observations?: Record<string, string[]> } | null>(
    page,
    `${YEAR}/scores/nat/${studentId}.json`,
  );
  return rec?.observations?.[examId] ?? [];
}

test.describe('layout', () => {
  test('G01 columns', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const h = await headerTexts(page);
    expect(h).toHaveLength(E.columns);
    expect(h.slice(0, 2)).toEqual(['#', 'Naam']);
    expect(h[E.totaal]).toBe('Totaal');
    expect(h[E.cijfer]).toBe('Cijfer');
    expect(h.slice(-4)).toEqual(['R%', 'T1%', 'T2%', 'I%']);
  });

  test('G01 observatie columns and G03 headers', async ({ page }) => {
    await openGrid(page, EXAMS.h2);
    const h = await headerTexts(page);
    expect(h).toHaveLength(H2.columns);
    expect(h[H2.q1]).toMatch(/^\w+\s*\d+p/); // RTTI tag + points
    await expect(header(page).locator('[title$="(F1)"]')).toHaveCount(1);
    await expect(header(page).locator('[title$="(F3)"]')).toHaveCount(1);
  });

  test('G04 summary rows', async ({ page }) => {
    await openGrid(page, EXAMS.h2);
    const n = await rows(page).count();
    await expect(cell(page, n - 2, 1)).toHaveText('Gemiddelde');
    await expect(cell(page, n - 1, 1)).toHaveText('Standaarddeviatie');
  });
});

test.describe('entering scores', () => {
  test('G10 numbers with comma or point, shown with a comma', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await typeInto(page, 0, E.q1, '2,5');
    await typeInto(page, 0, E.q2, '3.5');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 2.5, q2: 3.5 });
    await expect(cell(page, 0, E.q1)).toHaveText('2,5');
    await expect(cell(page, 0, E.q2)).toHaveText('3,5');
  });

  test('G11 empty removes the score; 0 is a score', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await typeInto(page, 0, E.q1, '0');
    await typeInto(page, 0, E.q2, '4');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 0, q2: 4 });
    await typeInto(page, 0, E.q2, '');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 0 });
  });

  test('G12 N means niet gemaakt', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await typeInto(page, 0, E.q1, 'n');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: null });
    await expect(cell(page, 0, E.q1)).toHaveText('N');
  });

  test('G13 numpad dot writes N, also while typing', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await select(page, 0, E.q1);
    await page.keyboard.press('NumpadDecimal');
    await select(page, 0, E.q2);
    await page.keyboard.type('4');
    await page.keyboard.press('NumpadDecimal');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: null, q2: null });
  });

  test('G14 invalid input is kept, red, and reported', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await typeInto(page, 0, E.q1, 'abc');
    await typeInto(page, 0, E.q2, '9'); // max 5
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 'abc', q2: '9' });
    await expect(page.locator('.toast-persistent').first()).toContainText('Ongeldige score');
    await expect(cell(page, 0, E.q1)).toHaveText('abc');
  });

  test('G15 totals and grade are recomputed', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    await typeInto(page, 0, E.q1, '5');
    await typeInto(page, 0, E.q2, '5');
    await typeInto(page, 0, E.q3, '4');
    await expect(cell(page, 0, E.totaal)).toHaveText('14 / 14');
    await expect(cell(page, 0, E.cijfer)).toHaveText('10,0');
    const n = await rows(page).count();
    await expect(cell(page, n - 2, E.cijfer)).toHaveText('10,0'); // Gemiddelde of one student
  });

  test('G16 row status colours the # and Naam cells', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    await typeInto(page, 0, E.q1, '3');
    await expect.poll(() => bg(page, 0, 0)).toBe('rgb(255, 243, 205)'); // partly entered
    await typeInto(page, 0, E.q2, 'x');
    await expect.poll(() => bg(page, 0, 1)).toBe('rgb(255, 0, 51)'); // invalid
  });
});

test.describe('grade override', () => {
  test('G20 a typed grade overrides, G21 empty restores', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    const overrides = async () =>
      (
        await readMockJson<{ overrides?: Record<string, unknown> } | null>(
          page,
          `${YEAR}/scores/nat/${id}.json`,
        )
      )?.overrides?.[EXAMS.empty];
    await typeInto(page, 0, E.cijfer, '7,34');
    await expect.poll(overrides).toEqual({ cijfer: 7.3, berekend: null });
    await expect(cell(page, 0, E.cijfer)).toHaveText('7,3');
    await typeInto(page, 0, E.cijfer, '');
    await expect.poll(overrides).toBeUndefined();
  });

  test('G21 an invalid grade is refused', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    await typeInto(page, 0, E.cijfer, '11');
    await expect(page.locator('.toast').last()).toBeVisible();
    await expect(cell(page, 0, E.cijfer)).not.toHaveText('11');
  });

  test('G22 context menu on an overridden grade', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    await typeInto(page, 0, E.cijfer, '6');
    await cell(page, 0, E.cijfer).click({ button: 'right' });
    await expect(page.getByText('Berekend cijfer herstellen')).toBeVisible();
  });
});

test.describe('observaties', () => {
  test('G30 one click toggles and saves', async ({ page }) => {
    await openGrid(page, EXAMS.h2);
    const id = await studentIdOf(page, 0);
    const before = await storedObservations(page, id, EXAMS.h2);
    await cell(page, 0, H2.obs1).locator('input[type="checkbox"]').click();
    await expect
      .poll(async () => (await storedObservations(page, id, EXAMS.h2)).length)
      .not.toBe(before.length);
  });

  test('G31 0 unchecks, 1 checks', async ({ page }) => {
    await openGrid(page, EXAMS.h2);
    const box = cell(page, 0, H2.obs3).locator('input[type="checkbox"]');
    await select(page, 0, H2.obs3);
    await page.keyboard.press('0');
    await expect(box).not.toBeChecked();
    await page.keyboard.press('1');
    await expect(box).toBeChecked();
  });

  test('G31 other printable keys do nothing (U19)', async ({ page }) => {
    await openGrid(page, EXAMS.h2);
    const box = cell(page, 0, H2.obs3).locator('input[type="checkbox"]');
    await select(page, 0, H2.obs3);
    await page.keyboard.press('0');
    await page.keyboard.press('a'); // Handsontable opened its text editor here
    await page.keyboard.press('1');
    await expect(box).toBeChecked({ timeout: 2000 });
  });

  test('G32 F-keys toggle the n-th observatie without moving', async ({ page }) => {
    await openGrid(page, EXAMS.h2);
    const box = cell(page, 1, H2.obs1).locator('input[type="checkbox"]');
    const was = await box.isChecked();
    await select(page, 1, H2.q1);
    await page.keyboard.press('F1');
    await expect(box).toBeChecked({ checked: !was });
    expect(await selected(page)).toEqual([1, H2.q1]);
  });

  test('G33 pasting into observatie cells saves them (U4)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openGrid(page, EXAMS.h2);
    const id = await studentIdOf(page, 0);
    const before = await storedObservations(page, id, EXAMS.h2);
    await select(page, 0, H2.obs1);
    await page.evaluate((v) => navigator.clipboard.writeText(v), before.length ? '0' : '1');
    await page.keyboard.press('Control+V');
    await expect
      .poll(async () => (await storedObservations(page, id, EXAMS.h2)).length, { timeout: 2000 })
      .not.toBe(before.length);
  });
});

test.describe('keyboard', () => {
  test('G40 arrows move; Escape cancels an edit', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await select(page, 0, E.q1);
    await page.keyboard.press('ArrowRight');
    expect(await selected(page)).toEqual([0, E.q2]);
    await page.keyboard.press('ArrowDown');
    expect(await selected(page)).toEqual([1, E.q2]);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('3');
    await page.keyboard.press('Escape');
    await expect(cell(page, 0, E.q2)).toHaveText('');
    expect(await storedScores(page, id, EXAMS.empty)).toBeUndefined();
  });

  test('G41 Enter: next editable cell, then the next student', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    await select(page, 0, E.q1);
    for (const key of ['Enter', 'NumpadEnter']) {
      await page.keyboard.type('1');
      await page.keyboard.press(key);
    }
    expect(await selected(page)).toEqual([0, E.q3]);
    await page.keyboard.type('1');
    await page.keyboard.press('NumpadMultiply');
    expect(await selected(page)).toEqual([1, E.q1]); // next student's first empty question
  });

  test('G42 Enter in Cijfer goes to the next student', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    await select(page, 0, E.cijfer);
    await page.keyboard.press('Enter');
    expect(await selected(page)).toEqual([1, E.cijfer]);
  });

  test('G43 numpad / - +', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    await typeInto(page, 1, E.q1, '2'); // row 1: first empty question is q2
    await select(page, 0, E.q3);
    await page.keyboard.press('NumpadDivide');
    expect(await selected(page)).toEqual([0, E.q2]);
    await page.keyboard.press('NumpadAdd');
    expect(await selected(page)).toEqual([1, E.q2]);
    await page.keyboard.press('NumpadSubtract');
    expect(await selected(page)).toEqual([0, E.q1]);
  });

  test('G44 Home and End', async ({ page }) => {
    await openGrid(page, EXAMS.h2);
    await select(page, 0, H2.q1 + 3);
    await page.keyboard.press('End');
    expect(await selected(page)).toEqual([0, H2.q10]);
    await page.keyboard.press('End');
    expect(await selected(page)).toEqual([0, H2.obs3]);
    await page.keyboard.press('Home');
    expect(await selected(page)).toEqual([0, H2.obs1]);
    await page.keyboard.press('Home');
    expect(await selected(page)).toEqual([0, H2.q1]);
  });

  test('G45 Tab order', async ({ page }) => {
    await openGrid(page, EXAMS.h2);
    await select(page, 0, H2.q10);
    await page.keyboard.press('Tab');
    expect(await selected(page)).toEqual([0, H2.obs1]);
    await select(page, 0, H2.obs3);
    await page.keyboard.press('Tab');
    expect(await selected(page)).toEqual([1, H2.q1]);
  });

  test('G46 Ctrl+Z / Ctrl+Y use the app history (U1)', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await typeInto(page, 0, E.q1, '4');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 4 });
    await page.keyboard.press('Control+Z');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({});
    // The app's history has a redo step (Handsontable's own undo saves a new change instead).
    await expect(page.locator('#sc-redo')).toBeEnabled({ timeout: 2000 });
    await page.keyboard.press('Control+Y');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 4 });
    await page.keyboard.press('Control+Z');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({});
    await page.keyboard.press('Control+Shift+Z');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 4 });
  });
});

test.describe('undo, saving, colleagues', () => {
  test('G50 undo and redo buttons', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await typeInto(page, 0, E.q1, '4');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 4 });
    await page.locator('#sc-undo').click();
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({});
    await page.locator('#sc-redo').click();
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 4 });
  });

  test('G51 a save keeps what a colleague saved meanwhile', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    const file = `${YEAR}/scores/nat/${id}.json`;
    // A colleague's save of another exam reaches the file without a sync event.
    await withMock(
      page,
      (m, f) => {
        const rec = JSON.parse(m.peek(f) ?? '{"scores":{}}');
        rec.scores['nat-iets-anders'] = { q1: 1 };
        return m.writeJson(f, rec);
      },
      file,
    );
    await typeInto(page, 0, E.q1, '2');
    await expect
      .poll(
        async () => (await readMockJson<{ scores: Record<string, unknown> }>(page, file)).scores,
      )
      .toMatchObject({ 'nat-iets-anders': { q1: 1 }, [EXAMS.empty]: { q1: 2 } });
  });

  test('G52 fast entry is never dropped (U2)', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await withMock(page, (m) => m.slowWrites(300));
    await select(page, 0, E.q1);
    // Three scores within one save round trip.
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => storedScores(page, id, EXAMS.empty), { timeout: 2000 })
      .toEqual({ q1: 1, q2: 2, q3: 3 });
  });

  test('G59 Delete clears the selected scores', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await typeInto(page, 0, E.q1, '1');
    await typeInto(page, 0, E.q2, '2');
    await typeInto(page, 0, E.q3, '3');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 1, q2: 2, q3: 3 });
    await select(page, 0, E.q1);
    await cell(page, 0, E.q2).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q3: 3 });
    await expect(cell(page, 0, E.q1)).toHaveText('');
  });

  test('G53 a failed save marks the cell; typing the same value retries it', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await withMock(page, (m) => m.fail('writeJson', '/scores/'));
    await typeInto(page, 0, E.q1, '2');
    await expect(page.locator('.toast-persistent').first()).toContainText('niet opgeslagen');
    await expect.poll(() => isMarkedUnsaved(page, 0, E.q1)).toBe(true);
    await withMock(page, (m) => m.clearFaults());
    await typeInto(page, 0, E.q1, '2');
    await expect.poll(() => storedScores(page, id, EXAMS.empty)).toEqual({ q1: 2 });
    await expect.poll(() => isMarkedUnsaved(page, 0, E.q1)).toBe(false);
  });

  test('G54 copy and paste a range', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openGrid(page, EXAMS.empty);
    const id1 = await studentIdOf(page, 1);
    await page.evaluate(() => navigator.clipboard.writeText('1\t2\t3'));
    await select(page, 1, E.q1);
    await page.keyboard.press('Control+V');
    await expect.poll(() => storedScores(page, id1, EXAMS.empty)).toEqual({ q1: 1, q2: 2, q3: 3 });
    await select(page, 1, E.q1);
    await cell(page, 1, E.q2).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Control+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1\t2');
  });

  test('G55 a colleague change updates the row and flashes it', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    const id = await studentIdOf(page, 0);
    await withMock(
      page,
      (m, { f, exam }) =>
        m.externalWrite(f, {
          student_id: Number(f.match(/(\d+)\.json$/)![1]),
          scores: { [exam]: { q1: 3 } },
        }),
      { f: `${YEAR}/scores/nat/${id}.json`, exam: EXAMS.empty },
    );
    await expect(cell(page, 0, E.q1)).toHaveText('3');
  });

  test('G57 a colleague N-term change is applied in place', async ({ page }) => {
    await openGrid(page, EXAMS.empty);
    await withMock(
      page,
      (m, rel) => {
        const exam = JSON.parse(m.peek(rel)!);
        m.externalWrite(rel, {
          ...exam,
          n_term: 2,
          _meta: { ...exam._meta, rev: (exam._meta?.rev ?? 0) + 1 },
        });
      },
      `${YEAR}/exams/${EXAMS.empty}.json`,
    );
    await expect(page.locator('#sc-nterm .spin-val')).toHaveValue('2');
  });
});
