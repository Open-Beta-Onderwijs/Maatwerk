// SPDX-License-Identifier: AGPL-3.0-or-later

// The overview modals of step 29 (design spec 3.10, 4.5, 4.6; boards 45, 46): tabs, the grade
// tooltip, the resit dot and the Stapgrootte toggle.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { login, seedFiles } from './helpers';
import { PO_ID, poSeed } from './po-seed';
import { screen } from './views';

async function openGroupOverview(page: Page, withPo = false) {
  await page.goto('/');
  if (withPo) await seedFiles(page, await poSeed(page, { grading: true }));
  await login(page);
  await screen(page, 'groepen');
  await page.getByRole('button', { name: '3a nat', exact: true }).click();
  const d = page.locator('.dlg').last();
  await expect(d.locator('.gl-table')).toBeVisible();
  return d;
}

test.describe('group overview (board 45)', () => {
  test('has five tabs, each rendered when opened', async ({ page }) => {
    const d = await openGroupOverview(page);
    await expect(d.locator('[role="tab"]')).toHaveText([
      'Resultaten',
      'Cijferverdeling',
      'Boxplot',
      'RTTI-analyse',
      'Observaties',
    ]);
    const columns = await d.locator('.gl-table thead th.gl-col:not(.gl-col--jaar)').count();
    expect(columns).toBeGreaterThan(0);
    await expect(d.locator('.ov-foot__label')).toHaveText(['GEMIDDELDE', 'STANDAARDDEVIATIE']);

    await d.locator('[data-tab="cijferverdeling"]').click();
    await expect(d.locator('#gl-tab-cijferverdeling .ov-hist')).toHaveCount(columns);
    // Step 1: ten bins with a count above every bar, the 5,5 line in every card.
    const first = d.locator('#gl-tab-cijferverdeling .ov-hist').first();
    await expect(first.locator('.ov-hist__n')).toHaveCount(10);
    await expect(first.locator('.ov-hist__labels span').first()).toHaveText('<1,5');
    await expect(first.locator('.ov-hist__pass')).toBeAttached();

    await d.locator('[data-tab="boxplot"]').click();
    await expect(d.locator('#gl-tab-boxplot .ov-box__row')).toHaveCount(columns);
    await expect(d.locator('#gl-tab-boxplot .ov-box__dot').first()).toBeVisible();

    await d.locator('[data-tab="rtti"]').click();
    await expect(d.locator('#gl-tab-rtti .ov-rline svg')).toBeVisible();
    await expect(d.locator('#gl-tab-rtti .ov-rtti-legend')).toContainText('T1 training');
    await expect(d.locator('#gl-tab-rtti .ov-rtti-legend')).toContainText('T2 transfer');
    await expect(d.locator('#gl-tab-rtti .ov-rcard').first()).toBeVisible();

    await d.locator('[data-tab="observaties"]').click();
    await expect(d.locator('#gl-tab-observaties .ov-heat')).toBeVisible();
    await expect(d.locator('#gl-tab-observaties .ov-heat__tot').first()).toHaveText(/^\d+×$/);
  });

  test('a grade tooltip lists the observaties of that cell', async ({ page }) => {
    const d = await openGroupOverview(page);
    const cell = d.locator('td.gl-cell:has(.ov-grade__pill--obs)').first();
    await cell.hover();
    const tip = page.locator('.ov-tip');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.ov-tip__head')).toHaveText(/^\d+ .+: \d+,\d$/);
    await expect(tip.locator('.ov-tip__obs').first()).toBeVisible();
    // Leaving the table hides it.
    await d.locator('.dlg-title, h2').first().hover();
    await expect(tip).toBeHidden();
  });

  test('the resit dot sits right of the pill without moving it', async ({ page }) => {
    const d = await openGroupOverview(page);
    const dot = d.locator('.gl-cell .ov-dot').first();
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute('title', /^(Herkansing|Inhaal) \(poging \d\)$/);
    // Pills in the column stay aligned: the one with a dot has the same x as the others.
    const cell = d.locator('td.gl-cell:has(.ov-dot)').first();
    const col = await cell.evaluate((td) => (td as HTMLTableCellElement).cellIndex);
    const xs = await d
      .locator(`.gl-table tbody tr td:nth-child(${col + 1}) .ov-pill`)
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
    await cell.hover();
    await expect(page.locator('.ov-tip')).toContainText(/(Herkansing|Inhaal) \(poging \d\)/);
  });

  test('a PO column shows the PO grade with its projectgroep in the tooltip', async ({ page }) => {
    const d = await openGroupOverview(page, true);
    const head = d.locator('.gl-table thead th.gl-col', {
      has: page.locator('.test-badge--se-po, .test-badge--po'),
    });
    await expect(head).toHaveCount(1);
    const col = await head.evaluate((th) => (th as HTMLTableCellElement).cellIndex);
    await d.locator(`.gl-table tbody tr:first-child td:nth-child(${col + 1})`).hover();
    await expect(page.locator('.ov-tip')).toContainText(
      /Praktische opdracht · projectgroep|Niet ingedeeld in een projectgroep/,
    );
  });
});

async function openExamOverview(page: Page, summary = false) {
  await page.goto('/');
  await login(page);
  await screen(page, 'toetsen');
  await page
    .locator(`[data-action="${summary ? 'exam-overview-best' : 'exam-overview'}"]`)
    .first()
    .click();
  const d = page.locator('.dlg').last();
  await expect(d.locator('.xo-table')).toBeVisible();
  return d;
}

test.describe('exam overview (board 46)', () => {
  test('one table with a heading, GEMIDDELDE and STANDAARDDEVIATIE per group', async ({ page }) => {
    const d = await openExamOverview(page);
    const sections = d.locator('.xo-table tbody.xo-section');
    const n = await sections.count();
    expect(n).toBeGreaterThan(1);
    await expect(sections.first().locator('.ov-section__head')).toHaveText(
      /^Groep .+ · \d+ leerlingen?$/,
    );
    await expect(d.locator('.xo-table .ov-foot--mean')).toHaveCount(n);
    await expect(d.locator('.xo-table .ov-foot--sd')).toHaveCount(n);
    await expect(d.locator('.xo-table thead th.xo-col-rtti')).toHaveText(['R', 'T1', 'T2', 'I']);
    await expect(d.locator('.xo-summary')).toContainText(/\d+ leerlingen · .*onvoldoende/);
  });

  test('the name column is 360px wide, narrower in a narrow window so the table fits', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const d = await openExamOverview(page);
    await expectNameColumn(d, '.xo-table', 900);
  });

  test('the Stapgrootte toggle switches Alle leerlingen between 18 and 10 bins', async ({
    page,
  }) => {
    const d = await openExamOverview(page);
    await d.locator('[data-tab="cijferverdeling"]').click();
    const all = d.locator('.xo-hist-all');
    await expect(all.locator('.ov-hist__n')).toHaveCount(18);
    await expect(all.locator('.hist-bin-btn[data-bin="0.5"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await all.locator('.hist-bin-btn[data-bin="1"]').click();
    await expect(all.locator('.ov-hist__n')).toHaveCount(10);
    await expect(all.locator('.hist-bin-btn[data-bin="1"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Group cards keep step 1.
    const cards = d.locator('#tab-cijferverdeling .ov-grid .ov-hist');
    await expect(cards.first().locator('.ov-hist__n')).toHaveCount(10);
  });

  test('every tab renders: boxplot, vraaganalyse, RTTI with the verloop, observaties', async ({
    page,
  }) => {
    const d = await openExamOverview(page);
    await d.locator('[data-tab="boxplots"]').click();
    await expect(d.locator('#tab-boxplots .ov-box__row').first()).toContainText('Alle leerlingen');
    await d.locator('[data-tab="vraaganalyse"]').click();
    await expect(d.locator('#tab-vraaganalyse .xo-q').first()).toBeVisible();
    await d.locator('[data-tab="rtti-analyse"]').click();
    await expect(d.locator('#tab-rtti-analyse .ov-rcard').first()).toContainText('Alle leerlingen');
    await expect(d.locator('#tab-rtti-analyse .ov-rline__hl')).toBeAttached();
    // RTTI per cijfergroep: a card per category, a bar per grade group (user 2026-11-15).
    await expect(d.locator('#tab-rtti-analyse .ov-card__h3').last()).toHaveText(
      'RTTI per cijfergroep',
    );
    await expect(d.locator('#tab-rtti-analyse .ov-grid--4 .xo-gg')).toHaveCount(4);
    await expect(
      d.locator('#tab-rtti-analyse .ov-grid--4 .xo-gg').first().locator('.ov-hist__col'),
    ).toHaveCount(6);
    await d.locator('[data-tab="observaties"]').click();
    await expect(d.locator('#tab-observaties .ov-card__h3')).toContainText([
      'Observaties, alle leerlingen',
      'Observaties per groep',
      'Observaties per cijfergroep',
    ]);
  });

  test('the verzameloverzicht shows the resit dot and disables the last three tabs', async ({
    page,
  }) => {
    const d = await openExamOverview(page, true);
    await expect(d.locator('.xo-table thead th.xo-col-dot')).toHaveCount(1);
    const dot = d.locator('.xo-table .ov-dot').first();
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute('title', /^(Herkansing|Inhaal) \(poging \d\)$/);
    for (const tab of ['vraaganalyse', 'rtti-analyse', 'observaties'])
      await expect(d.locator(`[data-tab="${tab}"]`)).toBeDisabled();
    await expect(d.locator('[data-tab="vraaganalyse"]')).toHaveAttribute(
      'title',
      /alleen beschikbaar voor individuele toetsen/,
    );
  });
});

/**
 * The name column of `table` (user 2026-11-15): 360px in a 1280px window; in a narrow one it takes the
 * room left, so the table fills the pane without scrolling; back to 360px when wide again.
 * `narrow` leaves margin for wider fonts (Linux WebKit): the exam table needs more room.
 */
async function expectNameColumn(d: Locator, table: string, narrow: number) {
  const page = d.page();
  const th = d.locator(`${table} thead th.ov-name-th`);
  const width = async () => Math.round((await th.boundingBox())!.width);
  const fill = () =>
    d.locator(table).evaluate((t: HTMLElement) => {
      const pane = t.closest<HTMLElement>('.tab-pane')!;
      return { over: pane.scrollWidth - pane.clientWidth, gap: pane.clientWidth - t.offsetWidth };
    });
  expect(await width()).toBe(360);
  await page.setViewportSize({ width: narrow, height: 800 });
  await expect.poll(width).toBeLessThan(360);
  const f = await fill();
  expect(f.over).toBe(0);
  expect(f.gap).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(width).toBe(360);
}

async function openPoOverview(page: Page) {
  await page.goto('/');
  await seedFiles(page, await poSeed(page, { grading: true }));
  await login(page);
  await screen(page, 'toetsen');
  await page.locator(`[data-exam-card="${PO_ID}"] .tcard-title`).click();
  const d = page.locator('.modal-po-overview');
  await expect(d.locator('.po-ov-table')).toBeVisible();
  return d;
}

test.describe('PO overview (board 43)', () => {
  test('Resultaten per klas and per projectgroep, with the grade build-up', async ({ page }) => {
    const d = await openPoOverview(page);
    await expect(d.locator('.dlg-badge')).toHaveText('SE · praktische opdracht');
    await expect(d.locator('.dlg-subtitle')).toContainText(
      'rubric Onderzoeksverslag · 4 categorieën · 17 punten · bonus 4 · 2 projectgroepen · 4 leerlingen',
    );
    await expect(d.locator('[role="tab"]')).toHaveText([
      'Resultaten',
      'Cijferverdeling',
      'Boxplot',
      'Categorieën',
      'Observaties',
    ]);
    // Per klas: unplaced students have a dashed chip and no grade.
    await expect(d.locator('.po-ov-chip--none').first()).toHaveText('niet ingedeeld');
    await expect(d.locator('.po-ov-view.selected')).toHaveText('Per klas');

    await d.getByRole('button', { name: 'Per projectgroep' }).click();
    const heads = d.locator('.ov-section__head');
    await expect(heads.first()).toContainText(
      'Valtoren · projectgroepcijfer 8,8 · Te laat ingeleverd −0,5 · 2 leerlingen',
    );
    await expect(heads.last()).toContainText('Niet ingedeeld · geen cijfer, geen rapport');

    // Noor Bakker (900101): 8,8 − 0,5 + 0,3 = 8,6.
    const row = d.locator('.ov-row', { hasText: 'Noor Bakker' });
    await row.locator('[data-tip$="|cijfer"]').hover();
    const tip = page.locator('.ov-tip');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.ov-tip__head')).toHaveText('Noor Bakker: 8,6');
    await expect(tip).toContainText('Projectgroep Valtoren 8,8 · groep −0,5 · persoonlijk +0,3');
    await expect(tip).toContainText('Theorie: ');
    // No column per category: the scores are in the tooltip, under the observaties.
    await expect(d.locator('.po-ov-table thead th')).toHaveText([
      'Naam',
      'Klas',
      'Punten/ 17',
      'Bonus / malus',
      'Cijfer',
    ]);
    await expect(tip.locator('.ov-tip__rows')).toContainText('Theorie6 / 8');
    await expect(tip.locator('.ov-tip__rows')).toContainText('Samenwerken (diagnostisch)3 / 3');
  });

  test('the name column is 360px wide, narrower in a narrow window so the table fits', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const d = await openPoOverview(page);
    await expectNameColumn(d, '.po-ov-table', 800);
  });

  test('every tab renders: verdeling, boxplot, categorieën, observaties', async ({ page }) => {
    const d = await openPoOverview(page);
    await d.locator('[data-tab="cijferverdeling"]').click();
    await expect(d.locator('#tab-cijferverdeling .ov-hist').first()).toBeVisible();
    await d.locator('#tab-cijferverdeling .hist-bin-btn[data-bin="1"]').click();
    await expect(d.locator('#tab-cijferverdeling .po-ov-hist-all .ov-hist__n')).toHaveCount(10);
    await d.locator('[data-tab="boxplot"]').click();
    await expect(d.locator('#tab-boxplot .ov-box__row').first()).toContainText('Alle leerlingen');
    await d.locator('[data-tab="categorieen"]').click();
    await expect(d.locator('#tab-categorieen .ov-intro')).toContainText('4 ingedeelde leerlingen');
    await expect(d.locator('#tab-categorieen .po-ov-cat__name')).toHaveText([
      'Theorie',
      'Uitvoering',
      'Extra onderzoek',
      'Samenwerken',
    ]);
    await expect(d.locator('#tab-categorieen tfoot')).toContainText('TOTAAL PUNTEN');
    await d.locator('[data-tab="observaties"]').click();
    await expect(d.locator('#tab-observaties .po-ov-obs__title').last()).toHaveText(
      'Algemene observaties',
    );
    await expect(d.locator('#tab-observaties .po-ov-obs__groups').first()).toHaveText(
      /^\d van 2 groepen$/,
    );
  });
});

test.describe('student profile (board 44)', () => {
  async function openProfile(page: Page) {
    await page.goto('/');
    await seedFiles(page, await poSeed(page, { grading: true }));
    await login(page);
    await screen(page, 'leerlingen');
    await page.locator('[data-action="profile"]').first().click();
    const d = page.locator('.modal-profile');
    await expect(d.locator('.pf-bars__slot').first()).toBeVisible();
    return d;
  }

  test('Cijferverloop: bars per test, a PO tooltip with its build-up, the comparisons', async ({
    page,
  }) => {
    const d = await openProfile(page);
    await expect(d.locator('.dlg-title')).toHaveText("D'Angelo O'Neill");
    await expect(d.locator('.dlg-badge')).toHaveText('3a');
    await expect(d.locator('.pf-bars__year')).toContainText(['2025-2026 · jaarlaag 3']);
    // No toetsgemiddelde in the bar chart: one bar per test.
    const slots = d.locator('.pf-bars__slot');
    await expect(d.locator('.pf-bar')).toHaveCount(await slots.count());
    // The PO (309): Valtoren 8,8 with the group line −0,5.
    const po = d.locator('.pf-bars__badges .test-badge--se-po');
    const i = await d
      .locator('.pf-bars__badge')
      .evaluateAll(
        (els, el) => els.findIndex((e) => e.contains(el as Node)),
        await po.elementHandle(),
      );
    await slots.nth(i).hover();
    const tip = page.locator('.ov-tip');
    await expect(tip.locator('.ov-tip__head')).toHaveText('309 PO Onderzoek valbeweging');
    await expect(tip).toContainText('Cijfer 8,3 · projectgroep Valtoren 8,8 · groep −0,5');
    await expect(tip.locator('.ov-tip__rows')).toContainText('Theorie6 / 8');
    await expect(tip.locator('.ov-tip__rows')).toContainText('Samenwerken (diagnostisch)3 / 3');
    // Bovenbouw has no tests for a jaarlaag-3 student.
    await d.locator('.pf-tog[data-bouw="bovenbouw"]').click();
    await expect(d.locator('.pf-bars-host')).toContainText('Geen cijfers in deze bouw.');
    // Per test: the student against the test average ± SD; per year against the jaarlaag.
    await expect(d.locator('.pf-tests-host .pf-dumb__sd').first()).toBeAttached();
    await expect(d.locator('.pf-years-host .pf-dumb__title')).toContainText([
      '2025-2026 · jaarlaag 3',
    ]);
  });

  test('Analyse: an RTTI card per test without the PO, Gemiddeld, observaties', async ({
    page,
  }) => {
    const d = await openProfile(page);
    await d.locator('[data-tab="analyse"]').click();
    await expect(d.locator('.pf-rcard--avg .ov-card__title')).toHaveText(
      'Gemiddeld 2025-2026 · jaarlaag 3',
    );
    await expect(d.locator('#tab-analyse .ov-note')).toContainText(
      '309 PO Onderzoek valbeweging is een praktische opdracht',
    );
    await expect(d.locator('#tab-analyse .test-badge--se-po')).toHaveCount(0);
    await d.locator('.pf-tog[data-rtti="se"]').click();
    await expect(d.locator('.pf-rcard--avg .ov-card__title')).toHaveText('Gemiddeld examendossier');
    await expect(d.locator('#tab-analyse .ov-heat')).toBeVisible();
  });
});
