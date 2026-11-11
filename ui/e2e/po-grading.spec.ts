// SPDX-License-Identifier: AGPL-3.0-or-later

// PO beoordelen (step 23; design spec 4.13, board 18; PLAN-2 decisions 17, 19, 24; grade rules
// decision 28): the score table grouped by projectgroep and the projectgroep's grading dialog.

import { expect, test, type Page } from '@playwright/test';
import {
  examMenuItem,
  login,
  readMockJson,
  seedFiles,
  watchErrors,
  withMock,
  YEAR,
} from './helpers';
import { PO_ID, poSeed } from './po-seed';

interface PoEntry {
  projectgroep?: string;
  categoryObs?: Record<string, string[]>;
  categoryComments?: Record<string, string>;
  comment?: string;
  groupLines?: { label: string; value: number }[];
  ownLines?: { label: string; value: number }[];
}

interface Rec {
  scores?: Record<string, Record<string, unknown>>;
  observations?: Record<string, string[]>;
  po?: Record<string, PoEntry>;
}

const dlg = (page: Page) => page.locator('.dlg').last();
const record = (page: Page, id: string) => readMockJson<Rec>(page, `${YEAR}/scores/nat/${id}.json`);

async function openTable(page: Page) {
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await expect(page.locator('#screen-toetsen')).toBeVisible();
  await examMenuItem(page, PO_ID, 'Scores invoeren');
  await expect(page.locator('.dlg--po-scores')).toBeVisible();
}

const row = (page: Page, id: string) => page.locator(`.po-sc-row[data-student="${id}"]`);

test.describe('the PO score table (step 23a, board 18)', () => {
  test('grouped by projectgroep, with points, lines, grades and statuses', async ({ page }) => {
    const errors = watchErrors(page);
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    const t = page.locator('.dlg--po-scores');
    await expect(t.locator('.dlg-title')).toHaveText('Scores invoeren');
    await expect(t.locator('.dlg-subtitle')).toContainText('PO Onderzoek valbeweging');
    await expect(t.locator('th.po-sc-cat')).toHaveText([
      'Theorie (8)',
      'Uitvoering (9)',
      'Extra onderzoek (4)',
      'Samenwerken (3)',
    ]);
    // Valtoren: every normal category scored; Projectgroep 2 only Theorie (no `po` entry yet).
    const heads = t.locator('.po-sc-ghead');
    await expect(heads.nth(0)).toContainText('Valtoren');
    await expect(heads.nth(0).locator('.po-sc-status')).toHaveText('Beoordeeld');
    await expect(heads.nth(1)).toContainText('Projectgroep 2');
    await expect(heads.nth(1).locator('.po-sc-status')).toHaveText('Bezig');
    // 15/17 = 8,8; group −0,5; Noor Bakker's own +0,3 (decision 28).
    const noor = row(page, '900101');
    await expect(noor.locator('.po-sc-cell')).toHaveText(['6', '7', '2', '3']);
    await expect(noor.locator('.po-sc-pts')).toHaveText('15 / 17');
    await expect(noor.locator('.po-sc-adj')).toHaveText(['−0,5', '+0,3']);
    await expect(noor.locator('.po-sc-adj').nth(1)).toHaveAttribute('title', 'Extra meting: +0,3');
    await expect(noor.locator('.po-sc-grade')).toHaveText('8,6');
    await expect(row(page, '900001').locator('.po-sc-grade')).toHaveText('8,3');
    // 4/17 = 2,4.
    await expect(row(page, '900002').locator('.po-sc-grade')).toHaveText('2,4');
    await expect(row(page, '900002').locator('.po-sc-cell')).toHaveText(['4', '—', '—', '—']);
    // Unplaced students are listed, without a grade.
    const free = t.locator('.po-sc-free');
    await expect(free.locator('.po-sc-gname')).toHaveText('Niet ingedeeld');
    await expect(free.locator('.po-sc-row[data-student="900102"] .po-sc-grade')).toHaveText('—');
    await expect(free.locator('[data-grade-group]')).toHaveCount(0);

    // Header: Projectgroepen and PO bewerken stack on the table.
    await t.locator('#po-sc-groups').click();
    await expect(dlg(page).locator('.dlg-title')).toHaveText('Projectgroepen');
    // Members stored in another order than shown are no change: Escape closes without asking.
    await page.keyboard.press('Escape');
    await expect(page.locator('.dlg--confirm')).toHaveCount(0);
    await expect(dlg(page).locator('.dlg-title')).toHaveText('Scores invoeren');
    await t.locator('#po-sc-edit').click();
    await expect(dlg(page).locator('.dlg-title')).toHaveText('PO bewerken');
    await page.keyboard.press('Escape');
    await expect(page.locator('.dlg')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('a PO without projectgroepen says what to do', async ({ page }) => {
    const files = await poSeed(page, { po: true });
    const exam = files[`${YEAR}/exams/${PO_ID}.json`] as Record<string, unknown>;
    files[`${YEAR}/exams/${PO_ID}.json`] = { ...exam, projectgroepen: [] };
    await seedFiles(page, files);
    await login(page);
    await openTable(page);
    await expect(page.locator('.po-sc-note')).toContainText('Nog geen projectgroepen');
  });
});

test.describe('projectgroep beoordelen (step 23b, board 18)', () => {
  test('grading writes the group into every member file, own lines apart', async ({ page }) => {
    const errors = watchErrors(page);
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    await page.locator('[data-grade-group="pg-2"]').click();
    const d = page.locator('.dlg--po-grade');
    await expect(d.locator('.dlg-title')).toHaveText('Projectgroep 2 beoordelen');
    await expect(d.locator('.dlg-subtitle')).toHaveText(
      "PO Onderzoek valbeweging · Marie-Claire 't Hart (3a nat), Olivia ter Østergaard (3a nat)",
    );

    // Theorie 4: the level 3–5 is highlighted (decision 24); Uitvoering is not scored yet.
    const theorie = d.locator('.po-gr-cat[data-cat="cat-theorie"]');
    await expect(theorie.locator('.po-gr-v')).toHaveText('4');
    await expect(
      theorie.locator('.po-gr-level[aria-current="true"] .po-gr-level-range'),
    ).toHaveText('3–5');
    const uitvoering = d.locator('.po-gr-cat[data-cat="cat-uitvoering"]');
    await expect(uitvoering).toHaveClass(/po-gr-cat--empty/);
    await expect(uitvoering.locator('.po-gr-v')).toHaveText('—');
    await uitvoering.locator('input[type=range]').fill('7');
    await expect(uitvoering.locator('.po-gr-v')).toHaveText('7');
    await expect(uitvoering.locator('.po-gr-level[aria-current="true"]')).toHaveCount(1);
    // 11/17 = 6,5.
    await expect(d.locator('#po-gr-points')).toHaveText('Punten 11 / 17 → projectgroep 6,5');
    await expect(d.locator('#po-gr-status')).toHaveText(
      '● Wijzigingen worden automatisch opgeslagen',
    );

    await theorie.locator('[data-cat-obs="obs-po-bronnen"]').click();
    await expect(theorie.locator('[data-cat-obs="obs-po-bronnen"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await uitvoering.locator('[data-cat-comment]').fill('Meer metingen.');
    await d.locator('[data-gen-obs="obs-po-netjes"]').click();
    await d.locator('#po-gr-overall').fill('Mooi werk.');

    // A group line +0,5 (7,0), an invalid one (not saved), an own line −1 for 't Hart (6,0).
    await d.locator('[data-add-line="group"]').click();
    let line = d.locator('[data-line="group"][data-i="0"]');
    await line.locator('.po-gr-line-label').fill('Mooie poster');
    await line.locator('.po-gr-line-value').fill('0,5');
    await d.locator('[data-add-line="group"]').click();
    line = d.locator('[data-line="group"][data-i="1"]');
    await line.locator('.po-gr-line-value').fill('0,25');
    await expect(line.locator('.po-gr-line-value')).toHaveAttribute('aria-invalid', 'true');
    await d.locator('[data-add-line="own"][data-member="900002"]').click();
    await d
      .locator('[data-line="own"][data-member="900002"][data-i="0"] .po-gr-line-value')
      .fill('-1');
    await expect(d.locator('#po-gr-points')).toHaveText('Punten 11 / 17 → projectgroep 7,0');
    await expect(d.locator('.po-gr-grade')).toHaveText(['Marie-Claire 6,0', 'Olivia 7,0']);

    await d.locator('#po-gr-done').click();
    await expect(d).toHaveCount(0);
    // The table refreshed.
    await expect(row(page, '900002').locator('.po-sc-grade')).toHaveText('6,0');
    await expect(row(page, '900003').locator('.po-sc-grade')).toHaveText('7,0');
    await expect(row(page, '900003').locator('.po-sc-adj')).toHaveText(['+0,5', '']);
    await expect(page.locator('.po-sc-ghead').nth(1).locator('.po-sc-status')).toHaveText(
      'Beoordeeld',
    );

    for (const id of ['900002', '900003']) {
      const rec = await record(page, id);
      expect(rec.scores?.[PO_ID]).toEqual({ 'cat-theorie': 4, 'cat-uitvoering': 7 });
      expect(rec.observations?.[PO_ID]).toEqual(['obs-po-netjes']);
      expect(rec.po?.[PO_ID]).toEqual({
        projectgroep: 'pg-2',
        categoryObs: { 'cat-theorie': ['obs-po-bronnen'] },
        categoryComments: { 'cat-uitvoering': 'Meer metingen.' },
        comment: 'Mooi werk.',
        groupLines: [{ label: 'Mooie poster', value: 0.5 }],
        ownLines: id === '900002' ? [{ label: '', value: -1 }] : [],
      });
    }
    // Other tests in the files stay; the first grading raised the minimum version (0.14).
    expect(Object.keys((await record(page, '900002')).scores ?? {}).length).toBeGreaterThan(1);
    const school = await readMockJson<{ minAppVersion: string }>(page, 'school.json');
    expect(school.minAppVersion).toBe('0.14.0');
    expect(errors).toEqual([]);
  });

  test('Vorige/Volgende save first; autosave every 10 s; clearing a score', async ({ page }) => {
    const errors = watchErrors(page);
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    await page.clock.install();
    await row(page, '900001').dblclick();
    const d = page.locator('.dlg--po-grade');
    await expect(d.locator('.dlg-title')).toHaveText('Valtoren beoordelen');
    await expect(d.locator('#po-gr-prev')).toBeDisabled();
    // Existing grading is loaded: lines, comment, observaties.
    await expect(d.locator('[data-line="group"] .po-gr-line-value')).toHaveValue('−0,5');
    await expect(
      d.locator('[data-line="own"][data-member="900101"] .po-gr-line-label'),
    ).toHaveValue('Extra meting');
    await expect(d.locator('#po-gr-overall')).toHaveValue('Goed onderzoek.');
    await expect(d.locator('[data-gen-obs="obs-po-netjes"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Autosave: nothing written before 10 s, then both member files.
    const extra = d.locator('.po-gr-cat[data-cat="cat-extra"]');
    await extra.locator('.po-gr-clear').click();
    await expect(extra.locator('.po-gr-v')).toHaveText('—');
    await page.clock.runFor(5_000);
    expect((await record(page, '900001')).scores?.[PO_ID]?.['cat-extra']).toBe(2);
    await page.clock.runFor(6_000);
    await expect(d.locator('#po-gr-status')).toContainText('● Automatisch opgeslagen');
    for (const id of ['900001', '900101'])
      expect((await record(page, id)).scores?.[PO_ID]).toEqual({
        'cat-theorie': 6,
        'cat-uitvoering': 7,
        'cat-samen': 3,
      });
    // Own lines stay each member's own.
    expect((await record(page, '900101')).po?.[PO_ID]?.ownLines).toEqual([
      { label: 'Extra meting', value: 0.3 },
    ]);

    // Volgende saves and opens the next projectgroep.
    await d.locator('.po-gr-cat[data-cat="cat-samen"] input[type=range]').fill('1');
    await d.locator('#po-gr-next').click();
    await expect(d.locator('.dlg-title')).toHaveText('Projectgroep 2 beoordelen');
    await expect(d.locator('#po-gr-next')).toBeDisabled();
    expect((await record(page, '900001')).scores?.[PO_ID]?.['cat-samen']).toBe(1);
    await d.locator('#po-gr-prev').click();
    await expect(d.locator('.dlg-title')).toHaveText('Valtoren beoordelen');
    await expect(d.locator('.po-gr-cat[data-cat="cat-samen"] .po-gr-v')).toHaveText('1');
    expect(errors).toEqual([]);
  });

  test('a student who changes projectgroep takes the new group grading, keeps own lines', async ({
    page,
  }) => {
    // Decision 19.
    const errors = watchErrors(page);
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await page.locator('.nav-btn[data-screen="toetsen"]').click();
    await examMenuItem(page, PO_ID, 'Projectgroepen');
    const g = dlg(page);
    // 't Hart (Projectgroep 2) to Valtoren; Noor Bakker (Valtoren, own +0,3) to Projectgroep 2.
    await g.locator('.po-member[data-student="900002"]').dragTo(g.locator('.po-group').first());
    await g.locator('.po-member[data-student="900101"]').dragTo(g.locator('.po-group').nth(1));
    await g.locator('#po-groups-save').click();
    const confirm = page.locator('.dlg--confirm');
    await expect(confirm).toContainText('2 leerlingen wisselen van projectgroep');
    await confirm.locator('.btn--primary').click();
    await expect(page.locator('.dlg')).toHaveCount(0);

    const hart = await record(page, '900002');
    expect(hart.scores?.[PO_ID]).toEqual({
      'cat-theorie': 6,
      'cat-uitvoering': 7,
      'cat-extra': 2,
      'cat-samen': 3,
    });
    expect(hart.observations?.[PO_ID]).toEqual(['obs-po-netjes']);
    expect(hart.po?.[PO_ID]?.projectgroep).toBe('pg-1');
    expect(hart.po?.[PO_ID]?.groupLines).toEqual([{ label: 'Te laat ingeleverd', value: -0.5 }]);
    expect(hart.po?.[PO_ID]?.ownLines).toEqual([]);
    // Projectgroep 2 had only unstamped scores (Theorie 4): Noor takes those, keeps her +0,3.
    const noor = await record(page, '900101');
    expect(noor.scores?.[PO_ID]).toEqual({ 'cat-theorie': 4 });
    expect(noor.observations?.[PO_ID]).toBeUndefined();
    expect(noor.po?.[PO_ID]).toEqual({
      projectgroep: 'pg-2',
      groupLines: [],
      ownLines: [{ label: 'Extra meting', value: 0.3 }],
    });
    // The table agrees: 't Hart 8,3 (8,8 − 0,5), Noor 2,4 + 0,3 = 2,7.
    await examMenuItem(page, PO_ID, 'Scores invoeren');
    await expect(row(page, '900002').locator('.po-sc-grade')).toHaveText('8,3');
    await expect(row(page, '900101').locator('.po-sc-grade')).toHaveText('2,7');
    expect(errors).toEqual([]);
  });

  test('opdrachten genereren follows the general and category observaties', async ({ page }) => {
    const errors = watchErrors(page);
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await page.locator('.nav-btn[data-screen="toetsen"]').click();
    await examMenuItem(page, PO_ID, 'Opdrachten genereren');
    const obs = page.locator('.og-obs-list .og-obs');
    // The rubric's general (Planning, Netjes) and category observaties (Bronnen, Samen).
    await expect(obs.locator('.og-obs-name')).toHaveText([
      /Planning niet gehaald/,
      /Netjes gewerkt/,
      /Bronnen ontbreken/,
      /Goed samengewerkt/,
    ]);
    // Valtoren has Netjes (general) and Bronnen (Theorie).
    await expect(obs.nth(1).locator('.og-obs-head .muted')).toHaveText('2 leerlingen');
    await expect(obs.nth(2).locator('.og-obs-head .muted')).toHaveText('2 leerlingen');
    await expect(obs.nth(3).locator('.og-obs-head .muted')).toHaveText('0 leerlingen');
    expect(errors).toEqual([]);
  });

  test('stored lines survive an edit elsewhere; 0 on an empty slider; Escape saves', async ({
    page,
  }) => {
    // Review 23 M2 and m2: an own line that does not count (0,25) and one stored as text stay
    // as they are when only the comment changes.
    const files = await poSeed(page, { grading: true });
    const rel = (id: string) => `${YEAR}/scores/nat/${id}.json`;
    const odd = [
      { label: 'Raar', value: 0.25 },
      { label: 'Tekst', value: '0.2' },
    ];
    (files[rel('900001')] as Rec).po![PO_ID]!.ownLines = odd as never;
    await seedFiles(page, files);
    await login(page);
    await openTable(page);
    // The text line counts in the grade (8,8 − 0,5 + 0,2 = 8,5), as the grade rules read it.
    await expect(row(page, '900001').locator('.po-sc-adj')).toHaveText(['−0,5', '+0,2']);
    await expect(row(page, '900001').locator('.po-sc-grade')).toHaveText('8,5');
    await page.locator('[data-grade-group="pg-2"]').click();
    const d = page.locator('.dlg--po-grade');
    // Uitvoering is empty: a click on its slider at 0 scores 0.
    const uitvoering = d.locator('.po-gr-cat[data-cat="cat-uitvoering"]');
    const box = (await uitvoering.locator('input[type=range]').boundingBox())!;
    await page.mouse.click(box.x + 3, box.y + box.height / 2);
    await expect(uitvoering.locator('.po-gr-v')).toHaveText('0');
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);
    await expect(row(page, '900002').locator('.po-sc-cell').nth(1)).toHaveText('0');
    expect((await record(page, '900002')).scores?.[PO_ID]?.['cat-uitvoering']).toBe(0);

    await page.locator('[data-grade-group="pg-1"]').click();
    const values = d.locator('[data-line="own"][data-member="900001"] .po-gr-line-value');
    await expect(values.nth(0)).toHaveValue('+0,25');
    await expect(values.nth(1)).toHaveValue('+0,2');
    await expect(values.nth(0)).toHaveAttribute('aria-invalid', 'true');
    await d.locator('#po-gr-overall').fill('Alleen het commentaar.');
    await d.locator('#po-gr-done').click();
    await expect(d).toHaveCount(0);
    const rec = await record(page, '900001');
    expect(rec.po?.[PO_ID]?.comment).toBe('Alleen het commentaar.');
    expect(rec.po?.[PO_ID]?.ownLines).toEqual(odd);
  });

  test('a colleague who changes the group while grading stops the saving (review 23 M1)', async ({
    page,
  }) => {
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    await page.locator('[data-grade-group="pg-1"]').click();
    const d = page.locator('.dlg--po-grade');
    await d.locator('#po-gr-overall').fill('Mijn versie.');
    const examRel = `${YEAR}/exams/${PO_ID}.json`;
    const exam = await readMockJson<{ projectgroepen: { id: string; student_ids: string[] }[] }>(
      page,
      examRel,
    );
    exam.projectgroepen[0]!.student_ids = ['900001'];
    exam.projectgroepen[1]!.student_ids.push('900101');
    await withMock(page, (m, [p, data]) => m.externalWrite(p as string, data as never), [
      examRel,
      exam,
    ]);
    const notice = page.locator('#reload-notice');
    await expect(notice).toContainText(
      'De leerlingen van deze projectgroep zijn intussen gewijzigd',
    );
    await notice.locator('[data-action="ok"]').click();
    await expect(page.locator('.dlg--po-grade .dlg-subtitle')).not.toContainText('Noor Bakker');
    // Nothing of "Mijn versie." was written.
    for (const id of ['900001', '900101'])
      expect((await record(page, id)).po?.[PO_ID]?.comment).toBe('Goed onderzoek.');
  });

  test('a colleague who changed a member file meanwhile is a conflict, not overwritten', async ({
    page,
  }) => {
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    await page.locator('[data-grade-group="pg-1"]').click();
    const d = page.locator('.dlg--po-grade');
    await expect(d.locator('.dlg-title')).toHaveText('Valtoren beoordelen');
    await d.locator('#po-gr-overall').fill('Mijn versie.');
    // A colleague's save lands in Noor Bakker's file (the second member).
    const rel = `${YEAR}/scores/nat/900101.json`;
    const other = await record(page, '900101');
    other.po![PO_ID]!.comment = 'Versie van een collega.';
    await withMock(page, (m, [p, data]) => m.externalWrite(p as string, data as never), [
      rel,
      other,
    ]);
    await d.locator('#po-gr-next').click();
    const notice = page.locator('#reload-notice');
    await expect(notice).toContainText('Noor Bakker is intussen door een collega beoordeeld');
    await expect(d.locator('#po-gr-status')).toHaveText(
      'Niet opgeslagen: gewijzigd door een collega',
    );
    expect((await record(page, '900101')).po?.[PO_ID]?.comment).toBe('Versie van een collega.');
    // Nothing was written: the first member's file is unchanged too.
    expect((await record(page, '900001')).po?.[PO_ID]?.comment).toBe('Goed onderzoek.');
    await notice.locator('[data-action="ok"]').click();
    await expect(page.locator('#po-gr-overall')).toHaveValue('Versie van een collega.');
  });
});
