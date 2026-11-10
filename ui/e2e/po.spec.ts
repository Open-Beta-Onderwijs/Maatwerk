// SPDX-License-Identifier: AGPL-3.0-or-later

// PO in Toetsen and projectgroepen (step 22; design spec 4.13, board 17; PLAN-2 decisions 16-19,
// 22).

import { expect, test, type Page } from '@playwright/test';
import { login, readMockJson, seedFiles, watchErrors, withMock, YEAR } from './helpers';
import { CLASS_3B, NEW_STUDENTS, PO_ID, poSeed, RUBRIC_ID } from './po-seed';

interface Projectgroep {
  id: string;
  naam?: string;
  student_ids: string[];
}

interface PoFile {
  id: string;
  title: string;
  kind: string;
  rubric_id: string;
  jaarlaag: string;
  schoolsoort: string[];
  type: string;
  weging: number;
  weging_se: number;
  parent_id?: string;
  description?: string;
  questions: unknown[];
  n_term?: number;
  projectgroepen: Projectgroep[];
  _meta: { rev: number };
}

const dlg = (page: Page) => page.locator('.dlg').last();

async function toetsen(page: Page) {
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await expect(page.locator('#screen-toetsen')).toBeVisible();
}

async function menu(page: Page, examId: string, item: string) {
  await expect(async () => {
    await page.locator(`[data-action="exam-menu"][data-id="${examId}"]`).first().click();
    await page.getByRole('menuitem', { name: item }).click({ timeout: 1000 });
  }).toPass();
}

async function pickRubric(page: Page, id: string) {
  await dlg(page).locator('#po-rubric-host .csel-trigger').click();
  await dlg(page).locator(`#po-rubric-host .csel-option[data-value="${id}"]`).click();
}

/** Step 1 filled in for jaarlaag 3, Havo + Vwo, the Onderzoeksverslag rubric. */
async function fillStep1(page: Page, naam = 'PO Valproef') {
  await page.locator('#btn-add-po').click();
  const d = dlg(page);
  await expect(d.locator('.dlg-title')).toHaveText('Nieuwe praktische opdracht');
  await d.locator('#po-naam').fill(naam);
  await d.locator('.ss-btn[data-ss="Havo"]').click();
  await d.locator('.ss-btn[data-ss="Vwo"]').click();
  await d.locator('.jl-btn[data-jl="3"]').click();
  await pickRubric(page, RUBRIC_ID);
}

async function poFiles(page: Page): Promise<PoFile[]> {
  return withMock(
    page,
    async (m, year) =>
      ((await m.readAllJson(`${year}/exams`)) as unknown as PoFile[]).filter(
        (e) => e.kind === 'po',
      ),
    YEAR,
  );
}

test.describe('PO toevoegen, step 1 (spec 4.13)', () => {
  test('the rubric list follows vak, schoolsoort and jaarlaag; the preview shows the formula', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await login(page);
    await toetsen(page);
    // "+ PO toevoegen" sits left of "+ Toets toevoegen".
    const add = page.locator('#screen-toetsen .header-actions .btn');
    await expect(add.nth(1)).toHaveText('+ PO toevoegen');
    await expect(add.nth(2)).toHaveText('+ Toets toevoegen');

    await page.locator('#btn-add-po').click();
    const d = dlg(page);
    await expect(d.locator('[data-tab]')).toHaveText(['1 · Gegevens', '2 · Projectgroepen']);
    // No Aantal vragen, no N-term.
    await expect(d.getByText('N-term')).toHaveCount(0);
    await expect(d.locator('#po-rubric-note')).toContainText('Er is nog geen passende rubric');

    const options = d.locator('#po-rubric-host .csel-option');
    await d.locator('.ss-btn[data-ss="Havo"]').click();
    await d.locator('.jl-btn[data-jl="3"]').click();
    await expect(options).toHaveText(['Onderzoeksverslag (17 + 4 bonus)', 'Practicum (15)']);
    await expect(d.locator('#po-rubric-note')).toHaveText(
      'Alleen rubrics voor Havo · Natuurkunde · jaarlaag 3',
    );
    // Vwo only: Practicum (Havo) is gone.
    await d.locator('.ss-btn[data-ss="Havo"]').click();
    await d.locator('.ss-btn[data-ss="Vwo"]').click();
    await expect(options).toHaveText(['Onderzoeksverslag (17 + 4 bonus)']);

    await pickRubric(page, RUBRIC_ID);
    const preview = d.locator('#po-preview');
    await expect(preview.locator('.rubric-chip')).toHaveText([
      'Theorie 8',
      'Uitvoering 9',
      'Extra onderzoek 4 · bonus',
      'Samenwerken 3 · diag',
    ]);
    await expect(preview).toContainText(
      'Cijfer = 10 × punten ÷ 17, minimaal 1,0 en hoogstens 10,0. Bonuspunten tellen mee in de punten, niet in het maximum.',
    );
    // Jaarlaag 5: the chosen rubric no longer fits and is cleared; Presentatie (Vwo 4-6) fits.
    await d.locator('.jl-btn[data-jl="5"]').click();
    await expect(options).toHaveText(['Presentatie (10)']);
    await expect(preview).toContainText('Kies een rubric');
    // Verder needs a name and a rubric.
    await d.locator('#po-next').click();
    await expect(page.locator('.toast').last()).toContainText('Geef de PO een naam');
    expect(errors).toEqual([]);
  });
});

test.describe('wiskunde (user 2026-11-10)', () => {
  test('a PO in jaarlaag 4-6 needs A/B/C/D, as a test', async ({ page }) => {
    const errors = watchErrors(page);
    const WI_TEACHER = 'gebr-1756713600003';
    await page.goto('/');
    await expect(page.locator('.subject-card').first()).toBeVisible();
    const user = await readMockJson<Record<string, unknown>>(page, `gebruikers/${WI_TEACHER}.json`);
    const levels = [
      { min: 0, max: 2, uitleg: 'a' },
      { min: 3, max: 5, uitleg: 'b' },
    ];
    await seedFiles(page, {
      [`gebruikers/${WI_TEACHER}.json`]: { ...user, actief: true },
      'rubrics/rubric-wi.json': {
        id: 'rubric-wi',
        naam: 'Modelleren',
        subject: 'wi',
        schoolsoort: ['Vwo'],
        jaarlagen: ['5'],
        obs_ids: [],
        categories: [
          { id: 'c1', naam: 'Model', max: 5, soort: 'normaal', obs_ids: [], niveaus: levels },
        ],
        _meta: { rev: 1 },
      },
    });
    await login(page, 'wi', WI_TEACHER);
    await toetsen(page);
    await page.locator('#btn-add-po').click();
    const d = dlg(page);
    const subs = d.locator('.sub-btn');
    await expect(subs).toHaveText(['A', 'B', 'C', 'D']);
    await d.locator('#po-naam').fill('PO Modelleren');
    await d.locator('.ss-btn[data-ss="Vwo"]').click();
    await d.locator('.jl-btn[data-jl="3"]').click();
    await expect(subs.first()).toBeDisabled();
    await d.locator('.jl-btn[data-jl="5"]').click();
    await expect(subs.first()).toBeEnabled();
    await pickRubric(page, 'rubric-wi');
    await d.locator('#po-next').click();
    await expect(page.locator('.toast').last()).toContainText('Selecteer een subcategorie');
    await subs.nth(1).click();
    await d.locator('#po-next').click();
    await dlg(page).locator('#po-groups-save').click();
    await expect(page.locator('.dlg')).toHaveCount(0);
    const [po] = await poFiles(page);
    expect(po).toMatchObject({ subject: 'wi', jaarlaag: '5', subcategory: 'wisb' });
    await expect(page.locator(`[data-exam-card="${po!.id}"] .test-badge--sub`)).toHaveText('B');
    expect(errors).toEqual([]);
  });
});

test.describe('projectgroepen (decisions 18, 19)', () => {
  test('a new PO with students of two classes in one projectgroep', async ({ page }) => {
    const errors = watchErrors(page);
    await seedFiles(page, await poSeed(page));
    await login(page);
    await toetsen(page);
    await fillStep1(page);
    await dlg(page).locator('#po-next').click();

    const d = dlg(page);
    await expect(d).toHaveClass(/dlg--po-groups/);
    await expect(d.locator('[data-tab="groepen"]')).toHaveAttribute('aria-selected', 'true');
    // Classes 3 nat cluster, 3a nat and 3b nat; 8 + 2 students.
    await expect(d.locator('.po-class-chip')).toHaveText([
      'Alle',
      '3 nat cluster',
      '3a nat',
      '3b nat',
    ]);
    await expect(d.locator('#po-free-count')).toHaveText('10 leerlingen');
    await expect(d.locator('#po-free-note')).toContainText('10 leerlingen nog niet ingedeeld');

    // Filter 3b and add Noor Bakker to the active (first) group; then a 3a student.
    await d.locator(`.po-class-chip[data-class="${CLASS_3B}"]`).click();
    await expect(d.locator('.po-stu')).toHaveCount(2);
    await d.locator(`.po-stu[data-student="${NEW_STUDENTS[0]}"]`).click();
    await d.locator('.po-class-chip[data-class=""]').click();
    await d.locator('.po-stu[data-student="900004"]').click();
    const first = d.locator('.po-group').first();
    await expect(first.locator('.po-group-count')).toHaveText('2 lln');
    await expect(first.locator('.po-tag')).toHaveText(['3b nat', '3 nat cluster']);
    await first.locator('.po-group-name').fill('Valtoren');
    await expect(d.locator('#po-active-name')).toHaveText('Valtoren');

    // An empty group is dropped on save; a group of one is fine.
    await d.locator('#po-add-group').click();
    await d.locator('.po-stu[data-student="900005"]').click();
    await expect(d.locator('.po-group').nth(1).locator('.po-group-count')).toHaveText('1 ll');
    await d.locator('#po-add-group').click();
    await expect(d.locator('.po-group')).toHaveCount(3);
    await expect(d.locator('#po-group-count')).toContainText('3 projectgroepen');
    // × takes a student out again.
    await d.locator('.po-group').nth(1).locator('.po-member-remove').click();
    await d.locator('.po-stu[data-student="900005"]').click(); // into the active (third) group
    await d.locator('#po-groups-save').click();

    await expect(page.locator('.dlg')).toHaveCount(0);
    const [po] = await poFiles(page);
    expect(po).toMatchObject({
      title: 'PO Valproef',
      kind: 'po',
      rubric_id: RUBRIC_ID,
      jaarlaag: '3',
      schoolsoort: ['Havo', 'Vwo'],
      questions: [],
    });
    expect(po!.n_term).toBeUndefined();
    expect(po!.projectgroepen.map((g) => [g.naam, g.student_ids])).toEqual([
      ['Valtoren', [NEW_STUDENTS[0], '900004']],
      [undefined, ['900005']],
    ]);
    const school = await readMockJson<{ minAppVersion: string }>(page, 'school.json');
    expect(school.minAppVersion).toBe('0.13.0');

    // The card: striped badge, kind pill, meta ending in the groups, the rubric line.
    const card = page.locator(`[data-exam-card="${po!.id}"]`);
    await expect(card.locator('.test-badge--po')).toBeVisible();
    await expect(card.locator('.exam-kind-pill')).toHaveText('Praktische opdracht');
    await expect(card.locator('.exam-line').first()).toHaveText(
      'Havo / Vwo · Weging 1 · 2 projectgroepen',
    );
    await expect(card.locator('.exam-line--nums')).toHaveText(
      'Rubric Onderzoeksverslag · 4 categorieën · 17 punten · bonus 4',
    );
    expect(errors).toEqual([]);
  });

  test('Willekeurig indelen, ← Gegevens keeps everything, drag and drop', async ({ page }) => {
    await seedFiles(page, await poSeed(page));
    await login(page);
    await toetsen(page);
    await fillStep1(page, 'PO Willekeurig');
    await dlg(page).locator('#po-next').click();
    const d = dlg(page);

    // Drag a student onto the group, and one back.
    await d.locator('.po-stu[data-student="900006"]').dragTo(d.locator('.po-group').first());
    await expect(d.locator('.po-group').first().locator('.po-member')).toHaveCount(1);
    await d
      .locator('.po-group .po-member[data-student="900006"]')
      .dragTo(d.locator('#po-free-list'));
    await expect(d.locator('.po-member')).toHaveCount(0);

    // 3b only: 2 students in groups of at most 3 -> one group of 2.
    await d.locator(`.po-class-chip[data-class="${CLASS_3B}"]`).click();
    await d.locator('#po-random').click();
    const r = page.locator('.dlg--po-random');
    await expect(r).toContainText('Verdeel de 2 leerlingen');
    await r.locator('[data-action="po-random-ok"]').click();
    // The empty first group made way.
    await expect(d.locator('.po-group')).toHaveCount(1);
    await expect(d.locator('.po-group .po-member')).toHaveCount(2);
    // The rest (8) in groups of at most 3: 3, 3, 2.
    await d.locator('.po-class-chip[data-class=""]').click();
    await d.locator('#po-random').click();
    await page.locator('.dlg--po-random [data-action="po-random-ok"]').click();
    await expect(d.locator('.po-group .po-group-count')).toHaveText([
      '2 lln',
      '3 lln',
      '3 lln',
      '2 lln',
    ]);
    await expect(d.locator('#po-free-note')).toHaveText('Iedereen is ingedeeld.');

    // Back to step 1 and forward again: fields and groups are kept.
    await d.locator('#po-back').click();
    await expect(dlg(page).locator('#po-naam')).toHaveValue('PO Willekeurig');
    await expect(dlg(page).locator('#po-rubric-host .csel-label')).toContainText(
      'Onderzoeksverslag',
    );
    await dlg(page).locator('#po-next').click();
    await expect(dlg(page).locator('.po-member')).toHaveCount(10);
    await dlg(page).locator('#po-groups-save').click();
    const [po] = await poFiles(page);
    expect(po!.projectgroepen.flatMap((g) => g.student_ids).sort()).toHaveLength(10);
  });
});

test.describe('a PO on the Toetsen screen', () => {
  test('grades from the category scores; the menu; Projectgroepen and PO bewerken', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await seedFiles(page, await poSeed(page, { scores: true }));
    await login(page);
    await toetsen(page);
    const card = page.locator(`[data-exam-card="${PO_ID}"]`);
    await expect(card.locator('.test-badge--se-po')).toHaveText('309');
    await expect(card.locator('.exam-kind-pill')).toHaveText('SE praktische opdracht');
    await expect(card.locator('.exam-line').first()).toHaveText(
      'Havo / Vwo · Periode 2 · Weging 2 · Weging SE 10 · 2 projectgroepen',
    );
    // 17/17 = 10,0 twice and 14/17 = 8,2 twice (decision 16): mean 9,1.
    await expect(card.locator('.exam-stats b')).toHaveText('9,1');
    // No overview for a PO yet.
    await expect(card.locator('.exam-card-btn')).toBeDisabled();

    // A re-render of the list can close the menu: open it again until its items are seen.
    const items = page.locator('.exam-menu-item');
    await expect(async () => {
      if (!(await page.locator('.exam-menu').isVisible()))
        await card.locator('[data-action="exam-menu"]').click();
      await expect(items).toHaveText(
        [
          'Scores invoeren',
          'Rapport genereren',
          'Opdrachten genereren',
          'Herkansing toevoegen',
          'Projectgroepen',
          'PO bewerken',
          'PO verwijderen',
        ],
        { timeout: 1000 },
      );
      await expect(items.nth(0)).toHaveAttribute('aria-disabled', 'true', { timeout: 1000 });
      // It has scores: it cannot be deleted.
      await expect(items.nth(6)).toHaveAttribute('aria-disabled', 'true', { timeout: 1000 });
    }).toPass();
    await page.keyboard.press('Escape');

    // Projectgroepen: moving a student who has scores asks first (decision 19).
    await menu(page, PO_ID, 'Projectgroepen');
    const d = dlg(page);
    await expect(d.locator('.dlg-title')).toHaveText('Projectgroepen');
    await expect(d.locator('#po-back')).toHaveCount(0);
    await d.locator('.po-member[data-student="900002"]').dragTo(d.locator('.po-group').first());
    await d.locator('#po-groups-save').click();
    const confirm = page.locator('.dlg--confirm');
    await expect(confirm).toContainText('Eén leerling wisselt van projectgroep');
    await confirm.locator('.btn--primary').click();
    await expect(page.locator('.dlg')).toHaveCount(0);
    const po = await readMockJson<PoFile>(page, `${YEAR}/exams/${PO_ID}.json`);
    expect(po.projectgroepen.map((g) => g.student_ids)).toEqual([
      ['900001', '900101', '900002'],
      ['900003'],
    ]);

    // A student out of every group loses the PO's scores, after a confirm (user 2026-11-10).
    await menu(page, PO_ID, 'Projectgroepen');
    const g = dlg(page);
    await g.locator('.po-member[data-student="900003"] .po-member-remove').click();
    await g.locator('#po-groups-save').click();
    const ask = page.locator('.dlg--confirm');
    await expect(ask).toContainText('Eén leerling zit in geen projectgroep meer');
    await expect(ask).toContainText('Olivia ter Østergaard');
    await ask.locator('.btn--danger').click();
    await expect(page.locator('.dlg')).toHaveCount(0);
    type Rec = { scores?: Record<string, unknown> };
    const gone = await readMockJson<Rec>(page, `${YEAR}/scores/nat/900003.json`);
    expect(gone.scores?.[PO_ID]).toBeUndefined();
    expect(Object.keys(gone.scores ?? {}).length).toBeGreaterThan(0); // its tests stay
    const kept = await readMockJson<Rec>(page, `${YEAR}/scores/nat/900002.json`);
    expect(kept.scores?.[PO_ID]).toBeDefined();

    // PO bewerken: the rubric is locked once there are scores.
    await menu(page, PO_ID, 'PO bewerken');
    const e = dlg(page);
    await expect(e.locator('.dlg-title')).toHaveText('PO bewerken');
    await expect(e.locator('#po-rubric-host')).toHaveClass(/csel--disabled|csel/);
    await expect(e.locator('#po-rubric-host .csel-trigger')).toBeDisabled();
    await e.locator('#po-naam').fill('PO Valbeweging');
    await e.locator('#po-save').click();
    await expect(card.locator('.exam-title-link')).toHaveText('PO Valbeweging');
    expect(errors).toEqual([]);
  });

  test('a PO herkansing has the same rubric and copies of the groups (decision 22)', async ({
    page,
  }) => {
    await seedFiles(page, await poSeed(page, { po: true }));
    await login(page);
    await toetsen(page);
    await menu(page, PO_ID, 'Herkansing toevoegen');
    const d = dlg(page);
    await expect(d.locator('.dlg-title')).toHaveText('Herkansing toevoegen');
    await expect(d.locator('.dlg-subtitle')).toContainText('PO Onderzoek valbeweging');
    await expect(d.locator('.po-group')).toHaveCount(2);
    await expect(d.locator('.po-group-name').first()).toHaveValue('Valtoren');
    // Only one student makes the herkansing in the first group.
    await d.locator('.po-group').first().locator('.po-member-remove').first().click();
    await d.locator('#po-groups-save').click();
    await expect(page.locator('.dlg')).toHaveCount(0);

    const resit = (await poFiles(page)).find((e) => e.parent_id === PO_ID)!;
    expect(resit).toMatchObject({
      title: 'PO Onderzoek valbeweging — HERKANSING',
      description: 'HERKANSING',
      rubric_id: RUBRIC_ID,
      questions: [],
    });
    expect(resit.projectgroepen.map((g) => g.student_ids)).toEqual([
      ['900101'],
      ['900002', '900003'],
    ]);
    expect(resit.projectgroepen.map((g) => g.id)).not.toContain('pg-1');
    // The original is untouched.
    const original = await readMockJson<PoFile>(page, `${YEAR}/exams/${PO_ID}.json`);
    expect(original.projectgroepen[0]!.student_ids).toEqual(['900001', '900101']);
    // Summary card with 2 attempts; an attempt has no "Herkansing toevoegen".
    await expect(
      page.locator(`[data-action="exam-attempts"][data-examid="${PO_ID}"]`),
    ).toContainText('2 pogingen');
    await page.locator(`[data-action="exam-menu"][data-id="${resit.id}"]`).click();
    await expect(page.getByRole('menuitem', { name: 'Herkansing toevoegen' })).toHaveCount(0);
  });
});
