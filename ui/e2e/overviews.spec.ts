// SPDX-License-Identifier: AGPL-3.0-or-later

// The overview modals of step 29 (design spec 3.10, 4.5, 4.6; boards 45, 46): tabs, the grade
// tooltip, the resit dot and the Stapgrootte toggle.

import { expect, test, type Page } from '@playwright/test';
import { login, seedFiles } from './helpers';
import { poSeed } from './po-seed';
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
