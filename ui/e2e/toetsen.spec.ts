// SPDX-License-Identifier: AGPL-3.0-or-later

// The Toetsen screen and its modals (step 20; design spec 4.7, 4.11; V-11, F-12, B-05).

import { expect, test, type Page } from '@playwright/test';
import { login, readMockJson, seedFiles, watchErrors, withMock, YEAR } from './helpers';

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

const examFile = (id: string) => `${YEAR}/exams/${id}.json`;

async function toetsen(page: Page) {
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await expect(page.locator('#screen-toetsen')).toBeVisible();
}

async function menu(page: Page, examId: string, kind: string, item: string) {
  // As examMenuItem: scrolling to the button can close the menu again; try again then.
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
    await expect(page.locator('.exam-card .exam-kind-pill').first()).toHaveText(
      /^(Toets|SE-toets)$/,
    );
  });

  test('a diagnostic test: grey badge, pill, no wegingen in its meta line', async ({ page }) => {
    const exams = await fixtureExams(page);
    const exam = exams.find((e) => e.title && !e.parent_id && e.subject === 'nat')!;
    await seedFiles(page, {
      [examFile(exam.id)]: { ...exam, diagnostic: true, weging: 0, type: 'regular' },
    });
    await login(page);
    await toetsen(page);
    const card = page.locator('.exam-card--diagnostic').first();
    await expect(card.locator('.test-badge--diagnostic')).toBeVisible();
    await expect(card.locator('.exam-kind-pill')).toHaveText('Diagnostisch');
    await expect(card).toContainText('telt niet mee voor rapport of SE');
    await expect(card.locator('.exam-line').first()).not.toContainText('Weging');
  });

  test('attempts are open by default; the toggle closes them for the session', async ({ page }) => {
    const { original, resit } = await testWithResit(page);
    await login(page);
    await toetsen(page);
    const toggle = page.locator(`[data-action="exam-attempts"][data-examid="${original.id}"]`);
    const attempt = page.locator(`[data-action="exam-menu"][data-id="${resit.id}"]`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toContainText(/^\d+ pogingen/);
    await expect(attempt).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(attempt).toBeHidden();

    // Stays closed when the list is drawn again.
    await page.locator('.nav-btn[data-screen="groepen"]').click();
    await toetsen(page);
    await expect(attempt).toBeHidden();
    await page.locator(`[data-action="exam-attempts"][data-examid="${original.id}"]`).click();
    await expect(attempt).toBeVisible();
  });

  test('an attempt shows its label, number of students and the lock pill', async ({ page }) => {
    const { original, resit } = await testWithResit(page);
    await login(page);
    await toetsen(page);
    const card = page
      .locator('.exam-attempt-card')
      .filter({ has: page.locator(`[data-id="${resit.id}"]`) });
    await expect(card.locator('.exam-attempt-label')).toHaveText('Herkansing');
    await expect(card.locator('.exam-attempt-count')).toHaveText(/^\d+ leerlingen?$/);
    await expect(card.locator('.test-badge').first()).toHaveText(`${original.volgnummer}-H`);
    await expect(card.locator('.exam-lock-pill')).toHaveText(
      `Observaties van ${original.volgnummer}`,
    );
    const first = page
      .locator('.exam-attempt-card')
      .filter({ has: page.locator(`[data-id="${original.id}"]`) });
    await expect(first.locator('.exam-attempt-label')).toHaveText('Origineel');
    await expect(first.locator('.exam-lock-pill')).toHaveCount(0);
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
