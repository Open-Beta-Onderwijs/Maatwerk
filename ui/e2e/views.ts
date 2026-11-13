// SPDX-License-Identifier: AGPL-3.0-or-later

// Every screen and modal of the app, reachable on the mock build (tiny
// fixture). Used by the visual regression and the CSP walkthrough.

import { expect, type Page } from '@playwright/test';
import { examMenuItem, login, seedFiles } from './helpers';
import { poSeed } from './po-seed';

export interface View {
  /** Also the screenshot name. */
  name: string;
  /** Who logs in first: the nat teacher, the admin, or nobody (startup screen). */
  user: 'teacher' | 'admin' | 'none';
  /** What to compare: the whole page or the modal box. */
  target: 'page' | 'modal';
  /** Files to seed before the login (step 22: the PO views; the shared fixture has no PO). */
  seed?(page: Page): Promise<Record<string, unknown>>;
  open(page: Page): Promise<void>;
}

/** Nieuwe praktische opdracht, step 1 filled in (Havo + Vwo, jaarlaag 3, Onderzoeksverslag). */
async function poStep1(p: Page): Promise<void> {
  await screen(p, 'toetsen');
  await p.locator('#btn-add-po').click();
  const d = p.locator('.dlg--po');
  await d.locator('#po-naam').fill('PO Onderzoek valbeweging');
  await d.locator('.ss-btn[data-ss="Havo"]').click();
  await d.locator('.ss-btn[data-ss="Vwo"]').click();
  await d.locator('.jl-btn[data-jl="3"]').click();
  await d.locator('.per-btn[data-per="2"]').click();
  await d.locator('#po-rubric-host .csel-trigger').click();
  await d.locator('#po-rubric-host .csel-option[data-value="rubric-onderzoek"]').click();
}

export async function screen(page: Page, name: string) {
  await page.locator(`.nav-btn[data-screen="${name}"]`).click();
  await page.waitForTimeout(400);
}

async function examMenu(page: Page, item: string, kind = ':not([data-kind="summary"])') {
  await screen(page, 'toetsen');
  await page.locator(`[data-action="exam-menu"]${kind}`).first().click();
  await page.getByRole('menuitem', { name: item }).click();
}

const click =
  (screenName: string, selector: string, nth = 0) =>
  async (page: Page) => {
    await screen(page, screenName);
    await page.locator(selector).nth(nth).click();
  };

const OVERVIEW_TABS = [
  'resultaten',
  'cijferverdeling',
  'boxplots',
  'rtti-analyse',
  'vraaganalyse',
  'observaties',
];

export const VIEWS: View[] = [
  {
    name: 'startup',
    user: 'none',
    target: 'page',
    open: async (p) => {
      await p.goto('/');
      await p.locator('.subject-card[data-subject="nat"]').click();
    },
  },
  {
    // The splash alone (F-06): no script runs, as before the bundle loads.
    name: 'splash',
    user: 'none',
    target: 'page',
    open: async (p) => {
      await p.route('**/*.js', (r) => r.abort());
      await p.goto('/');
      await p.locator('#splash').waitFor();
    },
  },
  {
    name: 'login-start',
    user: 'none',
    target: 'page',
    open: async (p) => {
      await p.goto('/');
      await p.locator('.login[data-stage="start"]').waitFor();
    },
  },
  {
    name: 'login-pin',
    user: 'none',
    target: 'page',
    open: async (p) => {
      await p.goto('/');
      await p.locator('.subject-card[data-subject="nat"]').click();
      await p.locator('.user-badge[data-user-id="admin"]').click();
      await p.locator('#pin-new').waitFor();
    },
  },
  ...['leerlingen', 'groepen', 'toetsen', 'rubrics', 'observaties', 'opdrachten'].map(
    (name): View => ({
      name: `screen-${name}`,
      user: 'teacher',
      target: 'page',
      open: (p) => screen(p, name),
    }),
  ),
  ...['leerlingen', 'groepen', 'gebruikers', 'school'].map((name): View => ({
    name: `admin-${name}`,
    user: 'admin',
    target: 'page',
    open: (p) => screen(p, name),
  })),
  ...(
    [
      ['leerling-edit', click('leerlingen', '[data-action="edit-student"]')],
      ['leerling-csv-year', click('leerlingen', '#btn-import-students')],
      ['groep-edit', click('groepen', '[data-action="edit-group"]')],
      ['groep-csv-year', click('groepen', '#btn-import-groups')],
    ] as const
  ).map(([name, open]): View => ({
    name: `admin-modal-${name}`,
    user: 'admin',
    target: 'modal',
    open,
  })),
  {
    name: 'modal-gebruiker',
    user: 'admin',
    target: 'modal',
    open: click('gebruikers', '[data-action="edit-user"]', 1),
  },
  ...(
    [
      ['groep-leerlingen', click('groepen', '[data-action="open-group"]')],
      ['toets-new', click('toetsen', '#btn-add-exam')],
      ['toets-edit', (p: Page) => examMenu(p, 'Toets bewerken')],
      ['scores', (p: Page) => examMenu(p, 'Scores invoeren')],
      ['rapport', (p: Page) => examMenu(p, 'Rapport genereren')],
      ['opdrachten-genereren', (p: Page) => examMenu(p, 'Opdrachten genereren')],
      [
        'herkansing',
        (p: Page) => examMenu(p, 'Inhaal / herkansing toevoegen', '[data-kind="solo"]'),
      ],
      [
        'verzamelkaart',
        (p: Page) => examMenu(p, 'Verzamelkaart bewerken', '[data-kind="summary"]'),
      ],
      ['rtti-uitleg', click('toetsen', '#btn-toetsen-rtti-uitleg')],
      // Step 21: the rubric editor (fixture rubric with bonus and diagnostic categories).
      ['rubric-edit', click('rubrics', '.rubric-card-name')],
      ['rubric-new', click('rubrics', '#btn-add-rubric')],
      ['observatie-edit', click('observaties', '[data-action="edit-obs"]')],
      ['observatie-new', click('observaties', '#btn-add-obs')],
      ['opdracht-edit', click('opdrachten', '[data-action="edit-opdracht"]')],
    ] as const
  ).map(([name, open]): View => ({
    name: `modal-${name}`,
    user: 'teacher',
    target: 'modal',
    open,
  })),
  ...OVERVIEW_TABS.map((tab): View => ({
    name: `modal-overzicht-${tab}`,
    user: 'teacher',
    target: 'modal',
    open: async (p) => {
      await click('toetsen', '[data-action="exam-overview"]')(p);
      await p.locator(`.dlg [data-tab="${tab}"]`).click();
    },
  })),
  ...['cijferverloop', 'analyse'].map((tab): View => ({
    name: `modal-profiel-${tab}`,
    user: 'teacher',
    target: 'modal',
    open: async (p) => {
      await click('leerlingen', '[data-action="profile"]')(p);
      await p.locator(`.dlg [data-tab="${tab}"]`).click();
    },
  })),
  // Step 22: a PO on the Toetsen screen (seeded with grades), PO toevoegen and Projectgroepen.
  {
    name: 'screen-toetsen-po',
    user: 'teacher',
    target: 'page',
    seed: (p) => poSeed(p, { scores: true }),
    open: async (p) => {
      await screen(p, 'toetsen');
      await expect(p.locator('[data-exam-card="po-valbeweging"] .exam-stats b')).toBeVisible();
    },
  },
  { name: 'modal-po-new', user: 'teacher', target: 'modal', open: poStep1 },
  {
    name: 'modal-po-groepen',
    user: 'teacher',
    target: 'modal',
    seed: (p) => poSeed(p),
    open: async (p) => {
      await poStep1(p);
      await p.locator('#po-next').click();
      const d = p.locator('.dlg--po-groups');
      for (const id of ['900101', '900001'])
        await d.locator(`.po-stu[data-student="${id}"]`).click();
      await d.locator('.po-group-name').first().fill('Valtoren');
      await d.locator('#po-add-group').click();
      await d.locator('.po-stu[data-student="900002"]').click();
      await d.locator('#po-add-group').click();
    },
  },
  // Step 23: the PO score table and a projectgroep's grading (board 18).
  {
    name: 'modal-po-scores',
    user: 'teacher',
    target: 'modal',
    seed: (p) => poSeed(p, { grading: true }),
    open: async (p) => {
      await screen(p, 'toetsen');
      await examMenuItem(p, 'po-valbeweging', 'Scores invoeren');
      await expect(p.locator('.po-sc-row[data-student="900101"] .po-sc-grade')).toHaveText('8,6');
    },
  },
  {
    name: 'modal-po-grade',
    user: 'teacher',
    target: 'modal',
    seed: (p) => poSeed(p, { grading: true }),
    open: async (p) => {
      await screen(p, 'toetsen');
      await examMenuItem(p, 'po-valbeweging', 'Scores invoeren');
      await p.locator('[data-grade-group="pg-1"]').click();
      await expect(p.locator('.dlg--po-grade #po-gr-points')).toContainText('8,3');
    },
  },
  {
    name: 'exam-menu',
    user: 'teacher',
    target: 'page',
    open: click('toetsen', '[data-action="exam-menu"]'),
  },
  // The user menu (F-17, spec 3.6): a dropdown under the avatar.
  ...(['teacher', 'admin'] as const).map((user): View => ({
    name: `user-menu-${user}`,
    user,
    target: 'page',
    open: async (p) => {
      await p.locator('#user-badge-btn').click();
      await expect(p.locator('#user-menu')).toBeVisible();
    },
  })),
  {
    name: 'editor',
    user: 'teacher',
    target: 'page',
    open: async (p) => {
      await click('opdrachten', '[data-action="open-editor"]')(p);
      await expect(p.frameLocator('#editor-frame').locator('.cm-content')).toBeVisible();
    },
  },
];

/** Logs in as the view's user and opens it. */
export async function openView(page: Page, view: View): Promise<void> {
  if (view.seed) await seedFiles(page, await view.seed(page));
  if (view.user === 'teacher') await login(page);
  if (view.user === 'admin') await login(page, 'nat', 'admin');
  await view.open(page);
}
