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
import { PO_ID, poSeed, RUBRIC_ID } from './po-seed';

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

/** What is drawn at a point of the dialog body: its class list, for the cover checks. */
const classesAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px!, py!);
      return `${el?.className ?? ''} ${el?.closest('table') ? 'in-table' : ''}`;
    },
    [x, y],
  );

test.describe('the PO score table (step 23a, board 18)', () => {
  test('a white cover over the rows above the sticky head, the whole width (step 37)', async ({
    page,
  }) => {
    const files = await poSeed(page, { grading: true });
    // A new rubric with a long category name (the mock refuses to change one a PO uses).
    const rubric = await readMockJson<{ categories: Record<string, unknown>[] }>(
      page,
      `rubrics/${RUBRIC_ID}.json`,
    );
    const long = {
      ...rubric.categories[0],
      id: 'cat-lang',
      naam: 'Een heel erg lange categorienaam die niet in de kop past',
      obs_ids: [],
    };
    const examRel = `${YEAR}/exams/${PO_ID}.json`;
    await seedFiles(page, {
      'rubrics/rubric-lang.json': {
        ...rubric,
        id: 'rubric-lang',
        categories: [...rubric.categories, long],
      },
      ...files,
      [examRel]: { ...(files[examRel] as object), rubric_id: 'rubric-lang' },
    });
    await login(page);
    await page.setViewportSize({ width: 900, height: 700 });
    await openTable(page);
    const body = page.locator('.dlg--po-scores .dlg-body');
    await body.evaluate((b) => {
      b.scrollTop = 80;
      b.scrollLeft = 200;
    });
    const box = (await body.boundingBox())!;
    // The strip above the head, at the left edge, the middle and the right edge of the body.
    for (const x of [box.x + 4, box.x + box.width / 2, box.x + box.width - 20]) {
      expect(await classesAt(page, x, box.y + 4)).toContain('po-sc-cover');
    }
    // A long name ends in "…" (the full name in the tooltip): no label runs out of the head.
    await expect(page.locator('th.po-sc-cat').last()).toHaveAttribute(
      'title',
      'Een heel erg lange categorienaam die niet in de kop past (8)',
    );
    const head = (await page.locator('.po-sc-table thead').boundingBox())!;
    for (const label of await page.locator('.po-sc-slant > span').all()) {
      const l = (await label.boundingBox())!;
      expect(l.y).toBeGreaterThanOrEqual(head.y - 1);
    }
  });

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
  test('quitting the app right after an edit saves it first (review 23 m4)', async ({ page }) => {
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    await page.locator('[data-grade-group="pg-2"]').click();
    const d = page.locator('.dlg--po-grade');
    const uitvoering = d.locator('.po-gr-cat[data-cat="cat-uitvoering"]');
    await uitvoering.locator('input[type=range]').fill('7');
    await expect(uitvoering.locator('.po-gr-v')).toHaveText('7');
    // Within the 10 s autosave: nothing on disk yet.
    expect((await record(page, '900002')).scores?.[PO_ID]?.['cat-uitvoering']).toBeUndefined();
    await withMock(page, (m) => m.requestClose());
    // The window would close now: both members hold the edit, and the message is gone.
    for (const id of ['900002', '900003'])
      expect((await record(page, id)).scores?.[PO_ID]?.['cat-uitvoering']).toBe(7);
    expect(await withMock(page, (m) => m.closed)).toBe(true);
    await expect(page.locator('.busy-overlay')).toHaveCount(0);
  });

  test('the score table footer follows the grading save (review 23 n3)', async ({ page }) => {
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    const footer = page.locator('.dlg--po-scores .po-sc-saved');
    await expect(footer).toHaveText('● Alles opgeslagen');
    await page.locator('[data-grade-group="pg-2"]').click();
    const d = page.locator('.dlg--po-grade');
    await d.locator('.po-gr-cat[data-cat="cat-uitvoering"] input[type=range]').fill('6');
    await withMock(page, (m) => m.slowWrites(600));
    await d.locator('#po-gr-done').click();
    await expect(footer).toHaveText('Opslaan…');
    await expect(footer).toHaveAttribute('data-kind', 'busy');
    await expect(footer).toContainText('● Automatisch opgeslagen');
    await expect(footer).toHaveAttribute('data-kind', 'ok');
  });

  test('the closing message shows while the saves run (step 37)', async ({ page }) => {
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    await page.locator('[data-grade-group="pg-2"]').click();
    const d = page.locator('.dlg--po-grade');
    await d.locator('.po-gr-cat[data-cat="cat-uitvoering"] input[type=range]').fill('5');
    // Slow writes, so the message can be seen.
    await withMock(page, (m) => {
      m.slowWrites(600);
      void m.requestClose();
    });
    await expect(page.locator('.busy-overlay')).toHaveText('Gegevens opslaan, dan afsluiten…');
    await expect(page.locator('.busy-overlay')).toHaveCount(0);
    await expect.poll(() => withMock(page, (m) => m.closed)).toBe(true);
  });

  test('a failed save on closing asks first; Terug keeps the window open (review 37 M1)', async ({
    page,
  }) => {
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    await page.locator('[data-grade-group="pg-2"]').click();
    const d = page.locator('.dlg--po-grade');
    await d.locator('.po-gr-cat[data-cat="cat-uitvoering"] input[type=range]').fill('4');
    await withMock(page, (m) => {
      m.fail('writeJson', '/scores/');
      void m.requestClose();
    });
    const ask = page.locator('.dlg--confirm');
    await expect(ask).toContainText('Niet alles is opgeslagen');
    await ask.locator('[data-action="cancel"]').click();
    await expect(ask).toHaveCount(0);
    expect(await withMock(page, (m) => m.closed)).toBe(false);
    // Asked again, "Toch afsluiten" closes.
    await withMock(page, (m) => void m.requestClose());
    await expect(ask).toBeVisible();
    await ask.locator('[data-action="ok"]').click();
    await expect.poll(() => withMock(page, (m) => m.closed)).toBe(true);
  });

  test('the slider labels line up with the slider positions, also for 20 points (step 37)', async ({
    page,
  }) => {
    const files = await poSeed(page, { grading: true });
    const rubric = await readMockJson<{ categories: Record<string, unknown>[] }>(
      page,
      `rubrics/${RUBRIC_ID}.json`,
    );
    const twenty = {
      ...rubric.categories[0],
      id: 'cat-twintig',
      naam: 'Twintig',
      max: 20,
      obs_ids: [],
      niveaus: [
        { min: 0, max: 6, titel: 'Laag', uitleg: 'Onvoldoende.' },
        { min: 7, max: 13, titel: 'Midden', uitleg: 'Voldoende.' },
        { min: 14, max: 20, titel: 'Hoog', uitleg: 'Goed.' },
      ],
    };
    const examRel = `${YEAR}/exams/${PO_ID}.json`;
    await seedFiles(page, {
      'rubrics/rubric-twintig.json': {
        ...rubric,
        id: 'rubric-twintig',
        categories: [...rubric.categories, twenty],
      },
      ...files,
      [examRel]: { ...(files[examRel] as object), rubric_id: 'rubric-twintig' },
    });
    await login(page);
    await openTable(page);
    await page.locator('[data-grade-group="pg-2"]').click();
    const cat = page.locator('.dlg--po-grade .po-gr-cat[data-cat="cat-twintig"]');
    await cat.locator('.po-gr-ticks').scrollIntoViewIfNeeded();
    const slider = (await cat.locator('input[type=range]').boundingBox())!;
    // A click under the middle of a label sets exactly that value.
    for (const t of [20, 0, 1, 5, 9, 10, 11, 12, 15, 19]) {
      const label = (await cat
        .locator('.po-gr-ticks > span', { hasText: new RegExp(`^${t}$`) })
        .boundingBox())!;
      await page.mouse.click(label.x + label.width / 2, slider.y + slider.height / 2);
      await expect(cat.locator('.po-gr-v')).toHaveText(String(t));
    }
  });

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
    // The login (step 35) raised it past the grading guard's 0.14.0 already.
    expect(school.minAppVersion).toBe('0.26.0');
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
    // Closing saves without waiting (onClose), so the write may land after the dialog is gone.
    await expect
      .poll(async () => (await record(page, '900001')).po?.[PO_ID]?.comment)
      .toBe('Alleen het commentaar.');
    const rec = await record(page, '900001');
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

  test('a colleague who writes between the check and the write: partly written, reported, reloaded (review 23 m1)', async ({
    page,
  }) => {
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await openTable(page);
    await page.locator('[data-grade-group="pg-1"]').click();
    const d = page.locator('.dlg--po-grade');
    await d.locator('#po-gr-overall').fill('Mijn versie.');
    // The colleague's save lands in D'Angelo O'Neill's file (written second) just as this dialog
    // writes it: after the pre-check, so Noor Bakker's file is already written.
    const rel = `${YEAR}/scores/nat/900001.json`;
    const other = await record(page, '900001');
    other.po![PO_ID]!.comment = 'Versie van een collega.';
    await withMock(
      page,
      (m, [p, data]) =>
        m.beforeWrite(p as string, () => m.externalWrite(p as string, data as never)),
      [rel, other],
    );
    await d.locator('#po-gr-next').click();
    const notice = page.locator('#reload-notice');
    await expect(notice).toContainText("D'Angelo O'Neill is intussen door een collega beoordeeld");
    // The group is partly written: the colleague's file stays as the colleague left it.
    expect((await record(page, '900101')).po?.[PO_ID]?.comment).toBe('Mijn versie.');
    expect((await record(page, '900001')).po?.[PO_ID]?.comment).toBe('Versie van een collega.');
    // The reload starts from the colleague's version (review 23 m1).
    await notice.locator('[data-action="ok"]').click();
    await expect(page.locator('#po-gr-overall')).toHaveValue('Versie van een collega.');
  });

  test('a member without a score file is graded; it is created (review 23 m9)', async ({
    page,
  }) => {
    const files = await poSeed(page, { grading: true });
    const examRel = `${YEAR}/exams/${PO_ID}.json`;
    const exam = files[examRel] as { projectgroepen: unknown[] };
    // Daan Visser (900102) has no score file at all.
    files[examRel] = {
      ...exam,
      projectgroepen: [
        ...exam.projectgroepen,
        { id: 'pg-3', naam: 'Alleen Daan', student_ids: ['900102'] },
      ],
    };
    await seedFiles(page, files);
    await login(page);
    await openTable(page);
    expect(await record(page, '900102')).toBeNull();
    await page.locator('[data-grade-group="pg-3"]').click();
    const d = page.locator('.dlg--po-grade');
    await d.locator('.po-gr-cat[data-cat="cat-theorie"] input[type=range]').fill('5');
    await d.locator('#po-gr-done').click();
    await expect(d).toHaveCount(0);
    await expect
      .poll(async () => (await record(page, '900102'))?.scores?.[PO_ID]?.['cat-theorie'])
      .toBe(5);
    expect((await record(page, '900102')).po?.[PO_ID]?.projectgroep).toBe('pg-3');
  });

  test('a PO without a rubric cannot be graded and says why (review 23 m9)', async ({ page }) => {
    const files = await poSeed(page, { grading: true });
    const examRel = `${YEAR}/exams/${PO_ID}.json`;
    files[examRel] = { ...(files[examRel] as object), rubric_id: null };
    await seedFiles(page, files);
    await login(page);
    await openTable(page);
    await expect(page.locator('.po-sc-note')).toContainText('Deze PO heeft geen rubric');
    await expect(page.locator('[data-grade-group]')).toHaveCount(0);
  });
});
