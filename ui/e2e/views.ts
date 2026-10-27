// SPDX-License-Identifier: AGPL-3.0-or-later

// Every screen and modal of the app, reachable on the mock build (tiny
// fixture). Used by the visual regression and the CSP walkthrough.

import { expect, type Page } from '@playwright/test';
import { login } from './helpers';

export interface View {
  /** Also the screenshot name. */
  name: string;
  /** Who logs in first: the nat teacher, the admin, or nobody (startup screen). */
  user: 'teacher' | 'admin' | 'none';
  /** What to compare: the whole page or the modal box. */
  target: 'page' | 'modal';
  open(page: Page): Promise<void>;
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
  ...['leerlingen', 'groepen', 'toetsen', 'observaties', 'opdrachten'].map((name): View => ({
    name: `screen-${name}`,
    user: 'teacher',
    target: 'page',
    open: (p) => screen(p, name),
  })),
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
      await p.locator(`#modal-box [data-tab="${tab}"]`).click();
    },
  })),
  ...['cijferverloop', 'analyse'].map((tab): View => ({
    name: `modal-profiel-${tab}`,
    user: 'teacher',
    target: 'modal',
    open: async (p) => {
      await click('leerlingen', '[data-action="profile"]')(p);
      await p.locator(`#modal-box [data-tab="${tab}"]`).click();
    },
  })),
  {
    name: 'exam-menu',
    user: 'teacher',
    target: 'page',
    open: click('toetsen', '[data-action="exam-menu"]'),
  },
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
  if (view.user === 'teacher') await login(page);
  if (view.user === 'admin') await login(page, 'nat', 'admin');
  await view.open(page);
}
