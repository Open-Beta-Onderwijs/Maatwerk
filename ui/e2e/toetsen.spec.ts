// SPDX-License-Identifier: AGPL-3.0-or-later

// The Toetsen screen and its modals (step 20; design spec 4.7, 4.11; V-11, F-12, B-05).

import { expect, test, type Page } from '@playwright/test';
import {
  examMenuItem,
  login,
  openStackOf,
  readMockJson,
  seedFiles,
  watchErrors,
  withMock,
  YEAR,
} from './helpers';

interface Exam {
  id: string;
  title: string;
  parent_id?: string;
  description?: string;
  obs_ids?: string[];
  obs_from_parent?: boolean;
  type?: string;
  weging?: number;
  weging_se?: number;
  diagnostic?: boolean;
  volgnummer?: number;
  subject?: string;
  [key: string]: unknown;
}

interface Observatie {
  id: string;
  naam: string;
}

/** A folder for screenshots of the cards and stacks (visual check by hand). */
const SHOTS = process.env.TOETSEN_SHOTS;

const examFile = (id: string) => `${YEAR}/exams/${id}.json`;

async function toetsen(page: Page) {
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await expect(page.locator('#screen-toetsen')).toBeVisible();
}

async function menu(page: Page, examId: string, kind: string, item: string) {
  // As examMenuItem: scrolling to the button can close the menu again; try again then.
  if (kind === 'attempt') await openStackOf(page, examId);
  await expect(async () => {
    await page
      .locator(`[data-action="exam-menu"][data-id="${examId}"][data-kind="${kind}"]`)
      .click();
    await page.getByRole('menuitem', { name: item }).click({ timeout: 1000 });
  }).toPass();
}

/** The fixture's exams, read before the app logs in. */
async function fixtureExams(page: Page): Promise<Exam[]> {
  await page.goto('/');
  return withMock(
    page,
    async (m, year) => (await m.readAllJson(`${year}/exams`)) as unknown as Exam[],
    YEAR,
  );
}

/** A nat test with a resit from the fixture. */
async function testWithResit(page: Page): Promise<{ original: Exam; resit: Exam }> {
  const exams = await fixtureExams(page);
  const resit = exams.find((e) => e.parent_id && e.subject === 'nat')!;
  return { original: exams.find((e) => e.id === resit.parent_id)!, resit };
}

const readExam = (page: Page, id: string) => readMockJson<Exam>(page, examFile(id));

test.describe('exam list (spec 4.7)', () => {
  test('the legend names the five test types; cards have a kind pill', async ({ page }) => {
    await login(page);
    await toetsen(page);
    await expect(page.locator('#toetsen-legend .test-legend-item')).toHaveText([
      'Toets',
      'Praktische opdracht',
      'SE-toets',
      'SE praktische opdracht',
      'Diagnostisch',
    ]);
    await expect(page.locator('.tcard .tcard-pill--kind').first()).toHaveText(/^(Toets|SE-toets)$/);
  });

  test('cards: three per row per jaarlaag, periode labels, the two lines and the numbers', async ({
    page,
  }) => {
    await login(page);
    await toetsen(page);
    const grid = page.locator('.tgrid').first();
    await expect(page.locator('.tsection-label').first()).toHaveText(/^Jaarlaag /);
    expect(
      await grid.evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length),
    ).toBe(3);
    await expect(grid.locator('.tgrid-per').first()).toHaveText(/^Periode \d+$/);
    // Line 1 and the RTTI line with all four categories (spec 4.7).
    const card = page.locator('.tcard[data-kind="solo"]').first();
    await expect(card.locator('.tcard-line').first()).toHaveText(
      /^\d+(,\d+)? punten( \+ \d+ bonus)? · weging rapport \d+/,
    );
    await expect(card.locator('.tcard-rtti b')).toHaveText(['R', 'T1', 'T2', 'I']);
    // The numbers fill in: count, mean ± SD, % onvoldoende, ten bins in the mini histogram.
    await expect(card.locator('[data-count]')).toHaveText(/^\d+ leerlingen?$/);
    await expect(card.locator('.tcard-fail')).toHaveText(/(% onvoldoende|nog geen cijfers)$/);
    await expect(card.locator('.tcard-bin')).toHaveCount(10);
    const box = await card.boundingBox();
    expect(Math.round(box!.height)).toBe(214);
  });

  test('a periode that starts mid-row gets a divider to its left', async ({ page }) => {
    await login(page);
    await toetsen(page);
    const cells = page.locator('.tgrid-cell');
    await expect(cells.first()).toBeVisible();
    const n = await cells.count();
    for (let i = 0; i < n; i++) {
      const cell = cells.nth(i);
      const label = (await cell.locator('.tgrid-per').textContent()) ?? '';
      const col = await cell.getAttribute('data-col');
      const divider = await cell.locator('.tgrid-divider').count();
      expect(divider, `cell ${i}`).toBe(label && col !== '0' ? 1 : 0);
    }
  });

  test('a diagnostic test: grey badge, pill, "telt niet mee"', async ({ page }) => {
    const exams = await fixtureExams(page);
    const exam = exams.find((e) => e.title && !e.parent_id && e.subject === 'nat')!;
    await seedFiles(page, {
      [examFile(exam.id)]: { ...exam, diagnostic: true, weging: 0, type: 'regular' },
    });
    await login(page);
    await toetsen(page);
    const card = page.locator('.tcard--diagnostic').first();
    await expect(card.locator('.test-badge--diagnostic')).toBeVisible();
    await expect(card.locator('.tcard-pill--kind')).toHaveText('Diagnostisch');
    await expect(card.locator('.tcard-line').first()).toHaveText(/ · telt niet mee$/);
    await expect(card.locator('.tcard-line').first()).not.toContainText('weging');
  });

  test('a click on a card opens its overview; "Overzicht openen" is in the menu', async ({
    page,
  }) => {
    await login(page);
    await toetsen(page);
    const card = page.locator('.tcard[data-kind="solo"]:not(.tcard--po)').first();
    const id = await card.getAttribute('data-exam-card');
    // Somewhere on the card that is not a button: the mini histogram.
    await card.locator('.tcard-hist').click();
    await expect(page.locator('.dlg [data-tab="resultaten"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dlg [data-tab="resultaten"]')).toBeHidden();
    await menu(page, id!, 'solo', 'Overzicht openen');
    await expect(page.locator('.dlg [data-tab="resultaten"]')).toBeVisible();
  });

  test('a stack: closed by default, opens into a tray, closes again; remembered', async ({
    page,
  }) => {
    const { original, resit } = await testWithResit(page);
    await login(page);
    await toetsen(page);
    const toggle = page.locator(`[data-action="exam-attempts"][data-examid="${original.id}"]`);
    const attempt = page.locator('.ttray-card').filter({
      has: page.locator(`[data-action="exam-menu"][data-id="${resit.id}"]`),
    });
    const tray = page.locator('.ttray').filter({ has: attempt });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText(/^\d+ pogingen ▾$/);
    await expect(attempt).toHaveAttribute('inert', '');
    expect((await tray.boundingBox())!.height).toBe(0);
    // The Verzamelkaart: numbers over the best attempt per student.
    const summary = page.locator(`.tcard[data-exam-card="${original.id}"][data-kind="summary"]`);
    await expect(summary.locator('[data-count]')).toHaveText(/^beste poging · \d+ leerlingen?$/);
    // The closed stack still shows its attempts' score warnings, named per attempt (review 33 M1).
    await expect(summary.locator('.exam-warning')).toBeVisible();
    await expect(summary.locator('.exam-warning')).toHaveAttribute(
      'title',
      /^(Origineel|Herkansing|Inhaal): .+ — (ongeldige score|onvolledige scores)/,
    );
    await expect(summary.locator('.presence-badges')).toHaveCount(3);
    await expect(toggle).toHaveAttribute('aria-controls', /^ttray-/);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/stack-closed.png`, fullPage: true });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Inklappen ▴');
    await expect(attempt).not.toHaveAttribute('inert', '');
    await expect(tray.locator('.ttray-title')).toHaveText(
      `Pogingen van ${original.volgnummer} · de beste poging per leerling telt`,
    );
    await expect(tray.locator('.ttray-outline path')).toHaveAttribute('d', /^M .* Z$/);
    // Spread: the attempt cards end side by side under the stack's row.
    await expect(async () => {
      const boxes = await tray
        .locator('.ttray-card')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
      const s = (await summary.boundingBox())!;
      for (const b of boxes) expect(b.top).toBeGreaterThan(s.y + s.height);
      expect(new Set(boxes.map((b) => Math.round(b.left))).size).toBe(boxes.length);
    }).toPass();
    if (SHOTS) {
      await page.waitForTimeout(700); // the spread animation
      await page.screenshot({ path: `${SHOTS}/stack-open.png`, fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: `${SHOTS}/stack-open-dark.png`, fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    }
    // The attempt's card: label, lock pill, its own menu.
    const card = attempt.locator('.tcard');
    await expect(card.locator('.tcard-pill--attempt')).toHaveText('Herkansing');
    await expect(card.locator('.test-badge').first()).toHaveText(`${original.volgnummer}-H`);
    await expect(card.locator('.tcard-pill--lock')).toHaveText(
      `Observaties van ${original.volgnummer}`,
    );
    const first = page.locator(`.ttray-card[data-stack-of="${original.id}"][data-k="0"]`);
    await expect(first.locator('.tcard-pill--attempt')).toHaveText('Origineel');
    await expect(first.locator('.tcard-pill--lock')).toHaveCount(0);

    // Stays open when the list is drawn again (session), and closes.
    await page.locator('.nav-btn[data-screen="groepen"]').click();
    await toetsen(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(attempt).not.toHaveAttribute('inert', '');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(attempt).toHaveAttribute('inert', '');
    await expect.poll(async () => (await tray.boundingBox())!.height).toBe(0);
  });

  test('cards below a stack move down while it is open; cards beside it do not', async ({
    page,
  }) => {
    const { original } = await testWithResit(page);
    await login(page);
    await toetsen(page);
    const cell = page.locator(`.tgrid-cell--stack[data-stack="${original.id}"]`);
    const grid = page.locator('.tgrid').filter({ has: cell });
    const others = grid.locator('.tgrid-cell:not(.tgrid-cell--stack)');
    const before = await others.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    const stackTop = (await cell.boundingBox())!.y;
    await cell.locator('[data-action="exam-attempts"]').click();
    await expect(async () => {
      const after = await others.evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect().top),
      );
      after.forEach((top, i) => {
        if (before[i]! <= stackTop + 1) expect(Math.abs(top - before[i]!)).toBeLessThan(1);
        else expect(top).toBeGreaterThan(before[i]! + 200);
      });
    }).toPass();
  });

  test('reduced motion: the stack switches without transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { original } = await testWithResit(page);
    await login(page);
    await toetsen(page);
    await page.locator(`[data-action="exam-attempts"][data-examid="${original.id}"]`).click();
    const card = page.locator(`.ttray-card[data-stack-of="${original.id}"]`).first();
    expect(await card.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s/);
    await expect(card).not.toHaveAttribute('inert', '');
  });
});

test.describe('Nieuwe toets (spec 4.11)', () => {
  test('D and PTA exclude each other; D sets Weging to 0, unticking brings it back', async ({
    page,
  }) => {
    await login(page);
    await toetsen(page);
    await page.locator('#btn-add-exam').click();
    const pta = page.locator('#f-epta-btn');
    const diag = page.locator('#f-ediag-btn');
    const weging = page.locator('#f-eweging .spin-val');
    const wegingSe = page.locator('#f-eweging-se .spin-val');
    const note = page.locator('#f-diag-note');

    await expect(wegingSe).toHaveValue('—');
    await expect(wegingSe).toBeDisabled();
    await expect(note).toBeHidden();

    await page.locator('#f-eweging .spin-plus').click();
    await expect(weging).toHaveValue('1,5');

    await pta.click();
    await expect(wegingSe).toBeEnabled();
    await expect(wegingSe).toHaveValue('1');

    await diag.click();
    await expect(pta).toHaveAttribute('data-checked', 'false');
    await expect(weging).toHaveValue('0');
    await expect(weging).toBeDisabled();
    await expect(wegingSe).toHaveValue('—');
    await expect(note).toBeVisible();

    await pta.click();
    await expect(diag).toHaveAttribute('data-checked', 'false');
    await expect(weging).toHaveValue('1,5');
    await expect(weging).toBeEnabled();
    await expect(note).toBeHidden();
  });

  test('a diagnostic test is saved with weging 0, never PTA', async ({ page }) => {
    const errors = watchErrors(page);
    await login(page);
    await toetsen(page);
    await page.locator('#btn-add-exam').click();
    await page.locator('#f-etitle').fill('Diagnose H2');
    await page.locator('.ss-btn[data-ss="Havo"]').click();
    await page.locator('.jl-btn[data-jl="3"]').click();
    await page.locator('#f-ediag-btn').click();
    await page.locator('#f-e-next').click();
    // Step 2: the same choices, in one row.
    await expect(page.locator('.dlg-tab--active')).toHaveText('2 · Vragen');
    await expect(page.locator('#f-ediag-btn')).toHaveAttribute('data-checked', 'true');
    await expect(page.locator('#f-eweging2 .spin-val')).toBeDisabled();
    await page.locator('#f-esave').click();
    await expect(page.locator('.dlg-backdrop')).toBeHidden();

    const saved = await withMock(
      page,
      async (m, year) =>
        ((await m.readAllJson(`${year}/exams`)) as unknown as Exam[]).find(
          (e) => e.title === 'Diagnose H2',
        )!,
      YEAR,
    );
    expect(saved).toMatchObject({ diagnostic: true, weging: 0, type: 'regular', kind: 'toets' });
    // Kept: it applies only with PTA, and unticking D brings it back (review 20 M1).
    expect(saved.weging_se).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('Toets bewerken (spec 4.11)', () => {
  const EMPTY = `nat-lege-toets-${YEAR}`;

  test('one top row, totals in the footer that follow the table', async ({ page }) => {
    await login(page);
    await toetsen(page);
    await menu(page, EMPTY, 'solo', 'Toets bewerken');

    const tops = await page
      .locator('.exam-edit-top .form-group > label')
      .evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);

    const summary = page.locator('#f-exam-summary');
    await expect(summary).toContainText('3 vragen');
    await page.locator('.pts-btn[data-qi="0"][data-pts="10"]').click();
    await page.locator('.rtti-btn[data-qi="0"][data-rtti="I"]').click();
    await expect(summary).toContainText(/I: 10 \(\d+%\)/);
    await page.locator('.kind-sel[data-qi="0"]').selectOption('bonus');
    await expect(summary).toContainText('(+10 bonus)');
    await expect(summary).toContainText('I: 0 (0%)');
  });

  test('the question heading stays in view while the table scrolls', async ({ page }) => {
    await login(page);
    await toetsen(page);
    await menu(page, EMPTY, 'solo', 'Toets bewerken');
    for (let i = 0; i < 25; i++) await page.locator('#f-addq').click();
    const head = page.locator('.questions-table th').first();
    const before = (await head.boundingBox())!.y;
    await page.locator('.questions-scroll').evaluate((s) => {
      s.scrollTop = 400;
    });
    await expect
      .poll(() => page.locator('.questions-scroll').evaluate((s) => s.scrollTop))
      .toBeGreaterThan(0);
    expect((await head.boundingBox())!.y).toBeCloseTo(before, 0);
  });

  test('D on an existing test: weging 0 on saving', async ({ page }) => {
    await login(page);
    await toetsen(page);
    await menu(page, EMPTY, 'solo', 'Toets bewerken');
    await page.locator('#f-ediag-btn').click();
    await page.locator('#f-esave').click();
    await expect(page.locator('.dlg-backdrop')).toBeHidden();
    await expect.poll(async () => (await readExam(page, EMPTY)).diagnostic).toBe(true);
    expect((await readExam(page, EMPTY)).weging).toBe(0);
  });

  test('an observatie the form does not offer stays on the exam (T33)', async ({ page }) => {
    const exams = await fixtureExams(page);
    const exam = exams.find((e) => e.id === EMPTY)!;
    await seedFiles(page, {
      [examFile(EMPTY)]: { ...exam, obs_ids: [...(exam.obs_ids ?? []), 'obs-elders'] },
    });
    await login(page);
    await toetsen(page);
    await menu(page, EMPTY, 'solo', 'Toets bewerken');
    await page.locator('#f-etitle2').fill('Andere naam');
    await page.locator('#f-esave').click();
    await expect(page.locator('.dlg-backdrop')).toBeHidden();
    await expect.poll(async () => (await readExam(page, EMPTY)).title).toBe('Andere naam');
    expect((await readExam(page, EMPTY)).obs_ids).toContain('obs-elders');
  });
});

test.describe('Nieuwe poging (spec 4.11, F-12)', () => {
  /** A nat test without resits but with observaties. */
  async function soloTest(page: Page): Promise<Exam> {
    const exams = await fixtureExams(page);
    return exams.find(
      (e) =>
        !e.parent_id &&
        e.subject === 'nat' &&
        (e.obs_ids ?? []).length > 0 &&
        !exams.some((x) => x.parent_id === e.id),
    )!;
  }

  test('Soort poging fills and locks Beschrijving; Anders makes it editable', async ({ page }) => {
    const solo = await soloTest(page);
    await login(page);
    await toetsen(page);
    await menu(page, solo.id, 'solo', 'Inhaal / herkansing toevoegen');
    await expect(page.locator('.dlg-title')).toHaveText('Nieuwe poging');
    const desc = page.locator('#f-resit-desc');
    await expect(desc).toHaveValue('INHAAL');
    await expect(desc).toBeDisabled();

    await page.locator('.attempt-kind[data-kind="herkansing"]').click();
    await expect(desc).toHaveValue('HERKANSING');
    await expect(desc).toBeDisabled();
    await expect(page.locator('.attempt-kind[data-kind="herkansing"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await page.locator('.attempt-kind[data-kind="anders"]').click();
    await expect(desc).toHaveValue('');
    await expect(desc).toBeEnabled();
    await page.locator('#f-resit-next').click(); // no description yet
    await expect(page.locator('.toast').last()).toContainText('beschrijving');
    await expect(page.locator('#f-resit-next')).toBeVisible();

    // The arrow keys move through the cards.
    await page.locator('.attempt-kind[data-kind="anders"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(desc).toHaveValue('INHAAL');
  });

  test('a new attempt copies the observaties and shows them locked', async ({ page }) => {
    const solo = await soloTest(page);
    await login(page);
    await toetsen(page);
    await menu(page, solo.id, 'solo', 'Inhaal / herkansing toevoegen');
    const chips = page.locator('#f-obs-locked .exam-obs-chip--locked');
    await expect(chips).toHaveCount(solo.obs_ids!.length);
    await expect(page.locator('.exam-lock-title')).toHaveText(
      'Observaties worden overgenomen van het origineel.',
    );
    await page.locator('#f-resit-next').click();

    // Step 2: no observatie buttons, the same lock block.
    await expect(page.locator('.dlg-title')).toHaveText('Nieuwe poging');
    await expect(page.locator('.obs-sel-btn')).toHaveCount(0);
    await expect(chips).toHaveCount(solo.obs_ids!.length);
    await page.locator('#f-esave').click();
    await expect(page.locator('.dlg-backdrop')).toBeHidden();

    const resit = await withMock(
      page,
      async (m, [year, parent]) =>
        ((await m.readAllJson(`${year}/exams`)) as unknown as Exam[]).find(
          (e) => e.parent_id === parent,
        )!,
      [YEAR, solo.id] as const,
    );
    expect(resit).toMatchObject({
      description: 'INHAAL',
      obs_ids: solo.obs_ids,
      obs_from_parent: true,
    });
  });

  test('editing an attempt keeps its observaties locked', async ({ page }) => {
    const { resit } = await testWithResit(page);
    await seedFiles(page, { [examFile(resit.id)]: { ...resit, obs_ids: ['eigen-obs'] } });
    await login(page);
    await toetsen(page);
    await menu(page, resit.id, 'attempt', 'Toets bewerken');
    await expect(page.locator('.obs-sel-btn')).toHaveCount(0);
    await expect(page.locator('#f-obs-locked')).toBeVisible();
    await page.locator('#f-etitle2').fill('Nieuwe naam');
    await page.locator('#f-esave').click();
    await expect(page.locator('.dlg-backdrop')).toBeHidden();
    await expect.poll(async () => (await readExam(page, resit.id)).title).toBe('Nieuwe naam');
    expect((await readExam(page, resit.id)).obs_ids).toEqual(['eigen-obs']);
  });

  test("the original's observaties reach its attempts; an attempt's own stays", async ({
    page,
  }) => {
    const { original, resit } = await testWithResit(page);
    await seedFiles(page, {
      [examFile(resit.id)]: { ...resit, obs_ids: [...original.obs_ids!, 'eigen-obs'] },
    });
    await login(page);
    await toetsen(page);
    await menu(page, original.id, 'attempt', 'Toets bewerken');
    const chip = page.locator('.obs-sel-btn.selected').first();
    const first = (await chip.getAttribute('data-obs-id'))!;
    await chip.click();
    // The fixture has scores: it asks first, and names the attempts.
    await expect(page.locator('.dlg--confirm')).toContainText('al zijn pogingen');
    await page.locator('.dlg--confirm .btn--danger').click();
    await page.locator('#f-esave').click();
    await expect(page.locator('.dlg-backdrop')).toHaveCount(0);
    await expect
      .poll(async () => (await readExam(page, resit.id)).obs_ids)
      .toEqual([...original.obs_ids!.filter((id) => id !== first), 'eigen-obs']);
  });

  test('Verzamelkaart: D goes to every attempt', async ({ page }) => {
    const { original, resit } = await testWithResit(page);
    await login(page);
    await toetsen(page);
    await menu(page, original.id, 'summary', 'Verzamelkaart bewerken');
    await page.locator('#f-sum-diag').click();
    await expect(page.locator('#f-sum-weging .spin-val')).toBeDisabled();
    await page.locator('#f-sum-save').click();
    await expect(page.locator('.dlg-backdrop')).toHaveCount(0);
    for (const id of [original.id, resit.id]) {
      await expect.poll(async () => (await readExam(page, id)).diagnostic).toBe(true);
      expect(await readExam(page, id)).toMatchObject({ weging: 0, type: 'regular' });
    }
  });
});

test.describe('removing an observatie from the original (F-12)', () => {
  interface ScoreFile {
    scores?: Record<string, unknown>;
    observations?: Record<string, string[]>;
  }

  /** A student with scores on the resit; the app starts with no observaties on that file. */
  async function seed(page: Page) {
    const { original, resit } = await testWithResit(page);
    const records = await withMock(
      page,
      async (m, year) =>
        (await m.readJsonDir(`${year}/scores/nat`)) as unknown as {
          name: string;
          data: ScoreFile;
        }[],
      YEAR,
    );
    const one = records.find((r) => Object.keys(r.data.scores?.[resit.id] ?? {}).length > 0)!;
    const score = `${YEAR}/scores/nat/${one.name}`;
    await seedFiles(page, { [score]: { ...one.data, observations: {} } });
    return { original, resit, data: one.data, score };
  }

  /** What another PC would do: the file changes on disk while the app runs. */
  const write = (page: Page, file: string, data: unknown) =>
    withMock(page, (m, [f, d]) => m.externalWrite(f as string, d as never), [file, data] as const);

  /** Logs in, opens the original's editor; returns an observatie ticked there. */
  async function openOriginal(page: Page, originalId: string) {
    await login(page);
    await toetsen(page);
    await menu(page, originalId, 'attempt', 'Toets bewerken');
    return (await page.locator('.obs-sel-btn.selected').first().getAttribute('data-obs-id'))!;
  }

  test('its indications go from the original and every attempt', async ({ page }) => {
    const { original, resit, data, score } = await seed(page);
    const obsId = await openOriginal(page, original.id);
    await write(page, score, {
      ...data,
      observations: { [original.id]: [obsId], [resit.id]: [obsId] },
    });
    await page.locator(`.obs-sel-btn[data-obs-id="${obsId}"]`).click();
    await page.locator('.dlg--confirm .btn--danger').click();
    await page.locator('#f-esave').click();
    await expect(page.locator('.dlg-backdrop')).toHaveCount(0);
    await expect
      .poll(async () => (await readMockJson<ScoreFile>(page, score)).observations)
      .toEqual({ [original.id]: [], [resit.id]: [] });
  });

  test('a refused save leaves the indications alone (review 20 M2)', async ({ page }) => {
    const { original, resit, data, score } = await seed(page);
    const obsId = await openOriginal(page, original.id);
    const observations = { [original.id]: [obsId], [resit.id]: [obsId] };
    await write(page, score, { ...data, observations });
    await page.locator(`.obs-sel-btn[data-obs-id="${obsId}"]`).click();
    await page.locator('.dlg--confirm .btn--danger').click();
    await withMock(page, (m, id) => m.fail('writeJson', `/exams/${id}`), original.id);
    await page.locator('#f-esave').click();
    await expect(page.locator('.toast-persistent')).toBeVisible();
    expect((await readMockJson<ScoreFile>(page, score)).observations).toEqual(observations);
  });

  test("ticking one on and off again leaves an attempt's own alone (review 20 m1)", async ({
    page,
  }) => {
    const { original, resit, data, score } = await seed(page);
    await openOriginal(page, original.id);
    // Offered on the original, not ticked there: from now on only the resit has it.
    const chip = page.locator('.obs-sel-btn:not(.selected)').first();
    const own = (await chip.getAttribute('data-obs-id'))!;
    const observations = { [resit.id]: [own] };
    await write(page, score, { ...data, observations });
    const before = await readExam(page, resit.id);
    await write(page, examFile(resit.id), {
      ...before,
      obs_ids: [...(before.obs_ids ?? []), own],
    });
    await expect(async () => {
      expect((await readExam(page, resit.id)).obs_ids).toContain(own);
    }).toPass();

    const button = page.locator(`.obs-sel-btn[data-obs-id="${own}"]`);
    await button.click();
    await page.locator('.dlg--confirm .btn--primary').click();
    await button.click();
    await page.locator('.dlg--confirm .btn--danger').click();
    await page.locator('#f-esave').click();
    await expect(page.locator('.dlg-backdrop')).toHaveCount(0);
    await expect(page.locator('.toast').last()).toContainText('opgeslagen');
    expect((await readMockJson<ScoreFile>(page, score)).observations).toEqual(observations);
  });
});

test.describe('B-05: the summary overview shows observaties of attempts', () => {
  /** One student, only in the resit, with one observatie there; nobody else has any. */
  async function seed(page: Page, noGrade = false) {
    const { original, resit } = await testWithResit(page);
    const obsId = original.obs_ids![0]!;
    const obs = await withMock(
      page,
      async (m, id) => {
        const all = (await m.readAllJson('observaties')) as unknown as Observatie[];
        return all.find((o) => o.id === id)!.naam;
      },
      obsId,
    );
    const records = await withMock(
      page,
      async (m, year) =>
        (await m.readJsonDir(`${year}/scores/nat`)) as unknown as {
          name: string;
          data: { scores?: Record<string, unknown>; observations?: unknown };
        }[],
      YEAR,
    );
    const files: Record<string, unknown> = {};
    for (const { name, data } of records) {
      files[`${YEAR}/scores/nat/${name}`] = { ...data, observations: {} };
    }
    const one = records.find((r) => Object.keys(r.data.scores?.[resit.id] ?? {}).length > 0)!;
    const scores = { ...one.data.scores };
    delete scores[original.id];
    files[`${YEAR}/scores/nat/${one.name}`] = {
      ...one.data,
      // No grade on any attempt: no attempt counts.
      ...(noGrade ? { overrides: {} } : {}),
      scores: noGrade ? {} : scores,
      observations: { [resit.id]: [obsId] },
    };
    await seedFiles(page, files);
    return { original, obs };
  }

  test('also for a student without any grade (review 20 m3)', async ({ page }) => {
    const { original, obs } = await seed(page, true);
    await login(page);
    await toetsen(page);
    await page
      .locator(`[data-action="exam-overview-best"][data-examid="${original.id}"]`)
      .first()
      .click();
    await expect(page.locator(`#tab-resultaten td[title="${obs}"]`).first()).toBeAttached();
  });

  test('the Resultaten tab marks the observatie made on the resit', async ({ page }) => {
    const { original, obs } = await seed(page);
    await login(page);
    await toetsen(page);
    await page
      .locator(`[data-action="exam-overview-best"][data-examid="${original.id}"]`)
      .first()
      .click();
    await expect(page.locator('.dlg [data-tab="resultaten"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The student's row is in its group's table and in the list of all students.
    await expect(page.locator(`#tab-resultaten td[title="${obs}"]`).first()).toBeAttached();
  });
});

test('after scores a max or soort change asks once; a max below an entered score is refused (decision 11)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const examId = `nat-lege-toets-${YEAR}`; // q1..q3 without scores
  type Q = { id: string; max_points: number; kind?: string };
  await page.goto('/');
  const before = await readMockJson<{ questions: Q[] }>(page, `${YEAR}/exams/${examId}.json`);
  const [m0, m1, m2] = before.questions.map((q) => q.max_points) as [number, number, number];
  expect(m0).toBeGreaterThan(0);
  expect(m1).toBeGreaterThan(0);
  const file = await withMock(
    page,
    async (m, y) => (await m.readJsonDir(`${y}/scores/nat`))[0]!,
    YEAR,
  );
  const rec = file.data as { scores?: Record<string, unknown> };
  await seedFiles(page, {
    [`${YEAR}/scores/nat/${file.name}`]: {
      ...rec,
      scores: { ...rec.scores, [examId]: { q1: 1, q2: m1 } },
    },
  });
  await login(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await examMenuItem(page, examId, 'Toets bewerken');
  const pts = (qi: number, n: number) => page.locator(`.pts-btn[data-qi="${qi}"][data-pts="${n}"]`);
  await expect(pts(1, m1 - 1)).toBeDisabled();
  await expect(pts(1, m1 - 1)).toHaveAttribute('title', new RegExp(`score van ${m1} ingevoerd`));
  await expect(pts(0, 0)).toBeDisabled();
  await expect(pts(0, 1)).toBeEnabled();

  const next = m0 === 10 ? 9 : m0 + 1;
  await pts(0, next).click();
  const ask = page.locator('.dlg', { hasText: 'veranderen de cijfers' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Annuleren' }).click();
  await expect(ask).toHaveCount(0);
  await expect(pts(0, m0)).toHaveClass(/selected/);
  await expect(pts(0, next)).not.toHaveClass(/selected/);
  await pts(0, next).click();
  await ask.getByRole('button', { name: 'Doorgaan' }).click();
  await expect(pts(0, next)).toHaveClass(/selected/);
  // Asked once per editor: the soort change goes straight through.
  await page.locator('.kind-sel[data-qi="2"]').selectOption('bonus');
  await expect(ask).toHaveCount(0);
  await page.locator('#f-esave').click();
  await expect(page.locator('.dlg-backdrop')).toBeHidden();
  await expect(async () => {
    const exam = await readMockJson<{ questions: Q[] }>(page, `${YEAR}/exams/${examId}.json`);
    expect(exam.questions.map((q) => [q.max_points, q.kind ?? 'normal'])).toEqual([
      [next, before.questions[0]!.kind ?? 'normal'],
      [m1, before.questions[1]!.kind ?? 'normal'],
      [m2, 'bonus'],
    ]);
  }).toPass();
  expect(errors).toEqual([]);
});
