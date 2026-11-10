// SPDX-License-Identifier: AGPL-3.0-or-later

// The Rubrics tab, the rubric editor and the observatie toetstype (step 21; design spec 4.12,
// 4.13; F-22, F-23; PLAN-2 decisions 20, 21, 23, 25). The mock fixture has three natuurkunde
// rubrics and four PO observaties (tools/fixtures/to-current.mjs).

import { expect, test, type Page } from '@playwright/test';
import { login, readMockJson, seedFiles, watchErrors, withMock, YEAR } from './helpers';

interface Rubric {
  id: string;
  naam: string;
  schoolsoort: string[];
  jaarlagen: string[];
  obs_ids: string[];
  categories: {
    id: string;
    naam: string;
    max: number;
    soort: string;
    obs_ids: string[];
    niveaus: { min: number; max: number; titel?: string; uitleg: string }[];
  }[];
  _meta?: { rev: number };
}

const ONDERZOEK = 'rubric-onderzoek';

async function rubrics(page: Page) {
  await page.locator('.nav-btn[data-screen="rubrics"]').click();
  await expect(page.locator('#screen-rubrics')).toBeVisible();
}

const card = (page: Page, id: string) => page.locator(`.rubric-card[data-rubric-id="${id}"]`);
const editor = (page: Page) => page.locator('.dlg--rubric');
const cat = (page: Page, i: number) => editor(page).locator(`.rubric-cat[data-cat="${i}"]`);
const level = (page: Page, c: number, l: number) =>
  cat(page, c).locator(`.rubric-level[data-level="${l}"]`);

async function rubricFiles(page: Page): Promise<Rubric[]> {
  return withMock(page, async (m) => (await m.readAllJson('rubrics')) as unknown as Rubric[]);
}

/** A PO exam that uses the rubric (step 22 writes these; here seeded). */
function poExam(id: string, rubricId: string) {
  return {
    [`${YEAR}/exams/${id}.json`]: {
      id,
      title: `PO ${id}`,
      naam: `PO ${id}`,
      subject: 'nat',
      kind: 'po',
      diagnostic: false,
      rubric_id: rubricId,
      jaarlaag: '3',
      schoolsoort: ['Havo'],
      questions: [],
      _meta: { rev: 1 },
    },
  };
}

test.describe('Rubrics tab (spec 4.13)', () => {
  test('teachers see the tab between Toetsen and Observaties; cards show chips and totals', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await login(page);
    const tabs = page.locator('.nav-btn:not(.hidden)');
    await expect(tabs).toContainText(['Toetsen', 'Rubrics', 'Observaties']);
    await rubrics(page);
    const c = card(page, ONDERZOEK);
    await expect(c.locator('.rubric-card-name')).toHaveText('Onderzoeksverslag');
    await expect(c).toContainText('Havo, Vwo · Natuurkunde · jaarlaag 3, 4');
    await expect(c.locator('.rubric-chip')).toHaveText([
      'Theorie 8',
      'Uitvoering 9',
      'Extra onderzoek 4 · bonus',
      'Samenwerken 3 · diag',
    ]);
    await expect(c.locator('.rubric-chip--bonus')).toHaveCount(1);
    await expect(c.locator('.rubric-summary')).toHaveText('4 categorieën · 17 punten · bonus 4');
    await expect(c.locator('.rubric-lock-pill')).toHaveCount(0);
    await expect(page.locator('.rubric-card')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('the admin has no Rubrics tab (decision 25)', async ({ page }) => {
    await login(page, 'nat', 'admin');
    await expect(page.locator('.nav-btn[data-screen="rubrics"]')).toBeHidden();
  });

  test('a rubric in use shows the lock pill and cannot be deleted', async ({ page }) => {
    await seedFiles(page, { ...poExam('po-a', ONDERZOEK), ...poExam('po-b', ONDERZOEK) });
    await login(page);
    await rubrics(page);
    const c = card(page, ONDERZOEK);
    await expect(c.locator('.rubric-lock-pill')).toHaveText("In gebruik bij 2 PO's");
    await expect(c.locator('[data-action="del-rubric"]')).toBeDisabled();
    await expect(
      card(page, 'rubric-practicum').locator('[data-action="del-rubric"]'),
    ).toBeEnabled();
  });

  test('an unused rubric is deleted after a confirm', async ({ page }) => {
    await login(page);
    await rubrics(page);
    await card(page, 'rubric-practicum').locator('[data-action="del-rubric"]').click();
    await page.locator('.dlg--confirm .btn--danger').click();
    await expect(card(page, 'rubric-practicum')).toHaveCount(0);
    expect(await readMockJson(page, 'rubrics/rubric-practicum.json')).toBeNull();
  });
});

test.describe('rubric editor', () => {
  test('a new rubric saves only when valid, then raises minAppVersion', async ({ page }) => {
    const errors = watchErrors(page);
    await seedFiles(page, {
      'school.json': { naam: 'School', schoolsoort: ['Havo', 'Vwo'], minAppVersion: '0.9.0' },
    });
    await login(page);
    await rubrics(page);
    await page.locator('#btn-add-rubric').click();
    await expect(editor(page).locator('.dlg-title')).toHaveText('Nieuwe rubric');
    const save = page.locator('#rubric-save');
    await expect(save).toBeDisabled();
    await expect(page.locator('#rubric-note')).toContainText('Geef de rubric een naam');

    await page.locator('#rubric-naam').fill('Werkstuk');
    await page.locator('#rubric-ss [data-ss="Havo"]').click();
    await page.locator('#rubric-jl [data-jl="3"]').click();
    await cat(page, 0).locator('.rubric-cat-name').fill('Inhoud');
    await expect(cat(page, 0).locator('.rubric-cat-error')).toContainText(
      'Niveau 1: uitleg ontbreekt',
    );
    await level(page, 0, 0).locator('[data-field="uitleg"]').fill('Zwak');
    await level(page, 0, 1).locator('[data-field="uitleg"]').fill('Goed');
    await expect(cat(page, 0).locator('.rubric-cat-error')).toHaveText('');
    await expect(page.locator('#rubric-total')).toHaveText('4 punten');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(editor(page)).toHaveCount(0);

    const saved = (await rubricFiles(page)).find((r) => r.naam === 'Werkstuk')!;
    expect(saved).toMatchObject({
      subject: 'nat',
      schoolsoort: ['Havo'],
      jaarlagen: ['3'],
      categories: [{ naam: 'Inhoud', max: 4, soort: 'normaal' }],
    });
    expect(saved.categories[0]!.niveaus).toEqual([
      { min: 0, max: 2, uitleg: 'Zwak' },
      { min: 3, max: 4, uitleg: 'Goed' },
    ]);
    expect(
      ((await readMockJson(page, 'school.json')) as { minAppVersion: string }).minAppVersion,
    ).toBe('0.12.0');
    await expect(page.locator('.rubric-card')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('levels are checked live: shared bounds, gaps in red, Opslaan blocked', async ({ page }) => {
    await login(page);
    await rubrics(page);
    await card(page, ONDERZOEK).locator('[data-action="edit-rubric"]').first().click();
    await expect(editor(page).locator('.dlg-title')).toHaveText('Rubric bewerken');
    await expect(page.locator('#rubric-total')).toHaveText('17 punten + 4 bonus');
    // Theorie 0-2, 3-5, 6-8: the bars span exactly their boxes.
    await expect(cat(page, 0).locator('.rubric-scale-n')).toHaveCount(9);
    await expect(cat(page, 0).locator('.rubric-bar')).toHaveText([
      '0–2  Onvoldoende',
      '3–5  Voldoende',
      '6–8  Goed',
    ]);
    await level(page, 0, 2).locator('[data-field="min"]').fill('3');
    await expect(cat(page, 0).locator('.rubric-cat-error')).toHaveText(
      'Twee niveaus beginnen bij 3',
    );
    await expect(level(page, 0, 2).locator('[data-field="min"]')).toHaveClass(/is-invalid/);
    await expect(page.locator('#rubric-save')).toBeDisabled();
    await level(page, 0, 2).locator('[data-field="min"]').fill('7');
    await expect(cat(page, 0).locator('.rubric-cat-error')).toHaveText('Niet gedekt: 6');
    await expect(cat(page, 0).locator('.rubric-scale-n--gap')).toHaveText(['6']);
    await expect(cat(page, 0)).toHaveClass(/is-invalid/);
    await level(page, 0, 2).locator('[data-field="min"]').fill('6');
    await expect(cat(page, 0).locator('.rubric-cat-error')).toHaveText('');
    await expect(page.locator('#rubric-save')).toBeEnabled();
    // The max is 1 to 100 (user, 2026-11-10).
    await cat(page, 0).locator('[data-field="cat-max"]').fill('101');
    await expect(cat(page, 0).locator('.rubric-cat-error')).toHaveText(
      'Het maximum moet een heel getal van 1 tot en met 100 zijn',
    );
    await expect(page.locator('#rubric-save')).toBeDisabled();
    await cat(page, 0).locator('[data-field="cat-max"]').fill('100');
    await expect(cat(page, 0).locator('.rubric-scale-n')).toHaveCount(101);
    await expect(cat(page, 0).locator('.rubric-cat-error')).toHaveText('Niet gedekt: 9–100');
  });

  test('levels: add up to five, remove down to two; soort changes the totals', async ({ page }) => {
    await login(page);
    await rubrics(page);
    await card(page, 'rubric-practicum').locator('.rubric-card-name').click();
    const add = cat(page, 0).locator('[data-action="add-level"]');
    await expect(add).toHaveText('+ Niveau (2 van 5)');
    await expect(cat(page, 0).locator('[data-action="del-level"]').first()).toBeDisabled();
    for (let i = 0; i < 3; i++) await add.click();
    await expect(add).toHaveText('+ Niveau (5 van 5)');
    await expect(add).toBeDisabled();
    await cat(page, 0).locator('[data-action="del-level"]').last().click();
    await expect(cat(page, 0).locator('.rubric-level')).toHaveCount(4);
    await expect(page.locator('#rubric-total')).toHaveText('15 punten');
    await cat(page, 2).locator('[data-soort="bonus"]').click();
    await expect(page.locator('#rubric-total')).toHaveText('10 punten + 5 bonus');
  });

  test('in use: max, soort and categories locked; names and levels editable (decision 20)', async ({
    page,
  }) => {
    await seedFiles(page, poExam('po-a', ONDERZOEK));
    await login(page);
    await rubrics(page);
    await card(page, ONDERZOEK).locator('.rubric-card-name').click();
    await expect(editor(page).locator('.rubric-lock-banner')).toHaveText(
      'In gebruik bij 1 PO: categorieën, maxima en soort liggen vast',
    );
    await expect(cat(page, 0).locator('[data-field="cat-max"]')).toBeDisabled();
    await expect(cat(page, 0).locator('[data-soort="bonus"]')).toBeDisabled();
    await expect(cat(page, 0).locator('[data-action="del-cat"]')).toBeDisabled();
    await expect(page.locator('#rubric-add-cat')).toBeDisabled();
    await cat(page, 0).locator('.rubric-cat-name').fill('Kennis');
    await level(page, 0, 0).locator('[data-field="titel"]').fill('Zwak');
    await page.locator('#rubric-save').click();
    await expect(editor(page)).toHaveCount(0);
    const saved = await readMockJson<Rubric>(page, `rubrics/${ONDERZOEK}.json`);
    expect(saved.categories[0]).toMatchObject({ naam: 'Kennis', max: 8, soort: 'normaal' });
    expect(saved.categories[0]!.niveaus[0]!.titel).toBe('Zwak');
  });

  test('Dupliceren opens a free copy that saves as a new rubric', async ({ page }) => {
    await seedFiles(page, poExam('po-a', ONDERZOEK));
    await login(page);
    await rubrics(page);
    await card(page, ONDERZOEK).locator('[data-action="dup-rubric"]').click();
    await expect(editor(page).locator('.dlg-title')).toHaveText('Nieuwe rubric');
    await expect(page.locator('#rubric-naam')).toHaveValue('Onderzoeksverslag (kopie)');
    await expect(editor(page).locator('.rubric-lock-banner')).toHaveCount(0);
    await expect(cat(page, 0).locator('[data-field="cat-max"]')).toBeEnabled();
    await cat(page, 0).locator('[data-field="cat-max"]').fill('10');
    await expect(cat(page, 0).locator('.rubric-cat-error')).toHaveText('Niet gedekt: 9, 10');
    await level(page, 0, 2).locator('[data-field="max"]').fill('10');
    await page.locator('#rubric-save').click();
    await expect(editor(page)).toHaveCount(0);
    const all = await rubricFiles(page);
    expect(all).toHaveLength(4);
    const copy = all.find((r) => r.naam === 'Onderzoeksverslag (kopie)')!;
    expect(copy.id).not.toBe(ONDERZOEK);
    expect(copy.categories[0]!.max).toBe(10);
    expect((await readMockJson<Rubric>(page, `rubrics/${ONDERZOEK}.json`)).categories[0]!.max).toBe(
      8,
    );
  });

  test('category and general observaties are PO observaties', async ({ page }) => {
    await login(page);
    await rubrics(page);
    await card(page, 'rubric-practicum').locator('.rubric-card-name').click();
    await cat(page, 1).locator('[data-action="add-obs"]').click();
    const pop = editor(page).locator('.rubric-obs-pop');
    // Three PO-only observaties and one of both toetstypes; no test observaties.
    await expect(pop.locator('[data-action="pick-obs"]')).toHaveCount(4);
    await pop.getByText('Bronnen ontbreken').click();
    await expect(cat(page, 1).locator('.rubric-obs-chip')).toHaveText(['📚Bronnen ontbreken×']);
    await editor(page).locator('[data-action="gen-obs"]', { hasText: 'Netjes gewerkt' }).click();
    await page.locator('#rubric-save').click();
    await expect(editor(page)).toHaveCount(0);
    const saved = await readMockJson<Rubric>(page, 'rubrics/rubric-practicum.json');
    expect(saved.categories[1]!.obs_ids).toEqual(['obs-po-bronnen']);
    expect(saved.obs_ids).toEqual(['obs-po-netjes']);
  });

  test('closing with changes asks first', async ({ page }) => {
    await login(page);
    await rubrics(page);
    await card(page, 'rubric-practicum').locator('.rubric-card-name').click();
    await page.locator('#rubric-naam').fill('Anders');
    await page.keyboard.press('Escape');
    await expect(page.locator('.dlg--confirm')).toBeVisible();
  });
});

test.describe('observatie toetstype (F-23)', () => {
  test('the Observaties tab filters on toetstype and marks PO observaties', async ({ page }) => {
    await login(page);
    await page.locator('.nav-btn[data-screen="observaties"]').click();
    const cards = page.locator('#obs-list .card');
    const all = await cards.count();
    await page.locator('#btn-filter-toetstype').click();
    await page.getByRole('radio', { name: 'PO', exact: true }).click();
    await expect(page.locator('#btn-filter-toetstype')).toHaveText('PO');
    await expect(cards).toHaveCount(4);
    await expect(page.locator('.obs-toetstype-badge')).toHaveText(['PO', 'PO', 'Toets + PO', 'PO']);
    await page.locator('#btn-filter-toetstype').click();
    await page.getByRole('radio', { name: 'Toets', exact: true }).click();
    await expect(cards).toHaveCount(all - 3);
  });

  test('the form sets toetstypes, never none; a rubric keeps its PO observatie on PO', async ({
    page,
  }) => {
    await login(page);
    await page.locator('.nav-btn[data-screen="observaties"]').click();
    await page.locator('#btn-add-obs').click();
    const tt = page.locator('#obs-tt-group');
    await expect(tt.locator('.selected')).toHaveText(['Toets']);
    await tt.locator('[data-tt="toets"]').click(); // the last one stays on
    await expect(tt.locator('.selected')).toHaveText(['Toets']);
    await tt.locator('[data-tt="po"]').click();
    await tt.locator('[data-tt="toets"]').click();
    await page.locator('#f-onam').fill('Bronvermelding');
    await page.locator('#obs-ss-group [data-ss="Havo"]').click();
    await page.locator('#obs-jl-group [data-jl="3"]').click();
    await page.locator('#f-osave').click();
    const saved = (await withMock(page, (m) => m.readAllJson('observaties'))) as {
      naam: string;
      toetstypes: string[];
    }[];
    expect(saved.find((o) => o.naam === 'Bronvermelding')?.toetstypes).toEqual(['po']);

    // obs-po-bronnen is in rubric-onderzoek: PO cannot be switched off.
    await page
      .locator('#obs-list .card', { hasText: 'Bronnen ontbreken' })
      .locator('[data-action="edit-obs"]')
      .click();
    await expect(page.locator('#obs-tt-group [data-tt="po"]')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(
      page
        .locator('#obs-list .card', { hasText: 'Bronnen ontbreken' })
        .locator('[data-action="del-obs"]'),
    ).toBeDisabled();
  });

  test('a test offers only observaties of toetstype Toets', async ({ page }) => {
    const obs = (id: string, naam: string, toetstypes: string[]) => ({
      [`observaties/${id}.json`]: {
        id,
        naam,
        icon: '🧪',
        schoolsoort: ['Havo', 'Vwo'],
        subjects: ['nat'],
        jaarlagen: ['3'],
        toetstypes,
        _meta: { rev: 1 },
      },
    });
    await seedFiles(page, {
      ...obs('obs-alleen-po', 'Alleen PO', ['po']),
      ...obs('obs-beide', 'Beide soorten', ['toets', 'po']),
    });
    await login(page);
    await page.locator('.nav-btn[data-screen="toetsen"]').click();
    const exams = (await withMock(page, (m, y) => m.readAllJson(`${y}/exams`), YEAR)) as {
      id: string;
      parent_id?: string;
      subject: string;
    }[];
    const exam = exams.find((e) => !e.parent_id && e.subject === 'nat')!;
    await expect(async () => {
      await page.locator(`[data-action="exam-menu"][data-id="${exam.id}"]`).first().click();
      await page.getByRole('menuitem', { name: 'Toets bewerken' }).click({ timeout: 1000 });
    }).toPass();
    const offered = page.locator('.obs-sel-btn');
    await expect(offered.filter({ hasText: 'Beide soorten' })).toHaveCount(1);
    await expect(offered.filter({ hasText: 'Alleen PO' })).toHaveCount(0);
  });
});
