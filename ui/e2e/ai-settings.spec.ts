// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 32c (spec 4.8.1, board 62): AI-instellingen from the editor's gear and the user menu,
// the first-use notice, the "?" install help, and the school switch, against MockAi.

import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { login, openOpdrachtEditor, seedFiles, TEACHER, watchErrors, withMock } from './helpers';

const SHOTS = process.env.AI_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openEditor(page: Page): Promise<FrameLocator> {
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await openOpdrachtEditor(page);
  const frame = page.frameLocator('#editor-frame');
  await expect(frame.locator('.cm-content')).toBeVisible();
  return frame;
}

async function noticeSeen(page: Page) {
  await withMock(
    page,
    (m, g) => m.ai.saveSettings(g, { enabled: true, timeLimitMinutes: 5, noticeSeen: true }),
    TEACHER,
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
});

test('first-use notice once; Begrepen opens the chat and is remembered', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  const frame = await openEditor(page);
  const claude = frame.getByRole('button', { name: 'Claude Code', exact: true });
  await claude.click();
  const notice = page.getByRole('dialog', { name: 'Voordat je de AI-assistent gebruikt' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('WORDT NOOIT VERSTUURD');
  await expect(notice).toContainText('Namen, cijfers en scores van leerlingen');
  await shot(page, '10-notice');
  // Closing without Begrepen: no chat.
  await page.keyboard.press('Escape');
  await expect(notice).toBeHidden();
  await expect(frame.getByRole('region', { name: 'AI-assistent' })).toBeHidden();
  await claude.click();
  await notice.getByRole('button', { name: 'Begrepen' }).click();
  await expect(
    frame.getByRole('heading', { name: 'Waar kan Claude Code mee helpen?' }),
  ).toBeVisible();
  // Remembered: closing and opening again asks nothing.
  await claude.click();
  await claude.click();
  await expect(notice).toBeHidden();
  const seen = await withMock(
    page,
    async (m, g) => (await m.ai.detect(g, false)).settings,
    TEACHER,
  );
  expect(seen.noticeSeen).toBe(true);
  expect(errors).toEqual([]);
});

test('AI-instellingen from the gear: edit, Standaard herstellen, own CLI, save', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  await noticeSeen(page);
  await withMock(page, (m) => {
    m.ai.installed = ['claude', 'vibe'];
  });
  const frame = await openEditor(page);
  await frame.getByRole('button', { name: 'Claude Code', exact: true }).click();
  await frame.getByRole('button', { name: 'AI-instellingen' }).click();
  const dlg = page.getByRole('dialog', { name: 'AI-instellingen' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('switch', { name: 'AI-assistent tonen' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(dlg).toContainText('Niet gevonden: Codex, Gemini CLI, Antigravity, GitHub Copilot');
  const card = dlg.locator('.ais-card[data-key="claude"]');
  await card.locator('.ais-card__head').click();
  await expect(card.locator('.ais-tag')).toHaveText('standaard');
  await card.getByLabel('ARGUMENTEN').fill('-p {prompt} --model sonnet');
  await expect(card.locator('.ais-tag')).toHaveText('aangepast');
  await shot(page, '11-settings');
  await card.getByRole('button', { name: 'Standaard herstellen' }).click();
  await expect(card.locator('.ais-tag')).toHaveText('standaard');
  await card.getByLabel('ARGUMENTEN').fill('-p {prompt} --model sonnet');

  // Install help.
  await dlg.getByRole('button', { name: 'Installatiehulp' }).click();
  await expect(dlg.locator('.ais-install__card')).toHaveCount(4);

  // An own CLI with a bad placeholder is refused, then fixed.
  await dlg.getByRole('button', { name: 'Eigen CLI toevoegen' }).click();
  const own = dlg.locator('.ais-card[data-key="custom-eigen-cli"]');
  await own.getByLabel('NAAM').fill('Aider');
  await own.getByLabel('OPDRACHT').fill('aider');
  await own.getByLabel('ARGUMENTEN').fill('--message {vraag}');
  await dlg.getByRole('button', { name: 'Opslaan' }).click();
  await expect(dlg.getByRole('alert')).toHaveText('Onbekende plaatshouder {vraag}.');
  await own.getByLabel('ARGUMENTEN').fill('--message-file {request}');
  await dlg.getByLabel('Tijdslimiet', { exact: false }).fill('8');
  await shot(page, '12-settings-own');
  await dlg.getByRole('button', { name: 'Opslaan' }).click();
  await expect(dlg).toBeHidden();

  const saved = await withMock(
    page,
    async (m, g) => (await m.ai.detect(g, false)).settings,
    TEACHER,
  );
  expect(saved.timeLimitMinutes).toBe(8);
  expect(saved.noticeSeen).toBe(true);
  expect(saved.overrides).toEqual({ claude: { args: '-p {prompt} --model sonnet' } });
  expect(saved.custom).toEqual([
    {
      key: 'custom-eigen-cli',
      name: 'Aider',
      command: 'aider',
      args: '--message-file {request}',
      argsNext: '',
    },
  ]);
  // The chat stays open on the same provider.
  await expect(
    frame.getByRole('heading', { name: 'Waar kan Claude Code mee helpen?' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('switching the assistant off in AI-instellingen removes the rail', async ({ page }) => {
  await login(page);
  await noticeSeen(page);
  const frame = await openEditor(page);
  await frame.getByRole('button', { name: 'Claude Code', exact: true }).click();
  await frame.getByRole('button', { name: 'AI-instellingen' }).click();
  const dlg = page.getByRole('dialog', { name: 'AI-instellingen' });
  await dlg.getByRole('switch', { name: 'AI-assistent tonen' }).click();
  await dlg.getByRole('button', { name: 'Opslaan' }).click();
  await expect(frame.locator('#ai-rail')).toBeHidden();
  await expect(frame.getByRole('region', { name: 'AI-assistent' })).toBeHidden();
});

test('no CLI found: the "?" opens the install help; Opnieuw zoeken finds one', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await noticeSeen(page);
  await withMock(page, (m) => {
    m.ai.installed = [];
  });
  const frame = await openEditor(page);
  await frame.getByRole('button', { name: 'AI-assistent instellen' }).click();
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  await expect(panel.getByRole('heading', { name: 'Geen AI-programma gevonden' })).toBeVisible();
  await expect(panel.locator('.ais-install__card')).toHaveCount(6);
  await shot(page, '13-install-help');
  await withMock(page, (m) => {
    m.ai.installed = ['claude'];
  });
  await panel.getByRole('button', { name: 'Opnieuw zoeken' }).click();
  await expect(frame.getByRole('button', { name: 'Claude Code', exact: true })).toBeVisible();
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test('AI-assistent verbergen in the install help hides the rail', async ({ page }) => {
  await login(page);
  await withMock(page, (m) => {
    m.ai.installed = [];
  });
  const frame = await openEditor(page);
  await frame.getByRole('button', { name: 'AI-assistent instellen' }).click();
  await frame.getByRole('button', { name: 'AI-assistent verbergen' }).click();
  await expect(frame.locator('#ai-rail')).toBeHidden();
  const s = await withMock(page, async (m, g) => (await m.ai.detect(g, false)).settings, TEACHER);
  expect(s.enabled).toBe(false);
});

test('off by the school: no rail; the user menu item only explains', async ({ page }) => {
  await seedFiles(page, { 'instellingen.json': { ai: { enabled: false } } });
  await login(page);
  await page.locator('#user-badge-btn').click();
  const item = page.locator('#acc-ai');
  await expect(item).toContainText('Uitgeschakeld door je school');
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await shot(page, '14-menu-school-off');
  await item.click({ force: true });
  await expect(page.getByRole('dialog', { name: 'AI-instellingen' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const frame = await openEditor(page);
  await expect(frame.locator('.svg-page').first()).toBeVisible();
  await expect(frame.locator('#ai-rail')).toBeHidden();
});

test('the user menu opens AI-instellingen when the school allows it', async ({ page }) => {
  await login(page);
  await page.locator('#user-badge-btn').click();
  await expect(page.locator('#acc-ai .user-menu__sub')).toBeHidden();
  await page.locator('#acc-ai').click();
  await expect(page.getByRole('dialog', { name: 'AI-instellingen' })).toBeVisible();
});

// Decision 74 (board 63): Opdracht toevoegen "met AI" sends the description at once.
test('Opdracht toevoegen met AI: saved, the editor opens and sends the message', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  await noticeSeen(page);
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('#btn-add-opdracht').click();
  const dlg = page.getByRole('dialog', { name: 'Opdracht toevoegen' });
  await dlg.locator('#f-opnam').fill('Wet van Ohm');
  await dlg
    .getByRole('group', { name: 'Schoolsoort' })
    .getByRole('button', { name: 'Havo' })
    .click();
  await dlg
    .getByRole('group', { name: 'Vakken' })
    .getByRole('button', { name: 'Natuurkunde' })
    .click();
  await dlg.getByRole('group', { name: 'Jaarlagen' }).getByRole('button', { name: '4' }).click();
  const sw = dlg.getByRole('switch', { name: 'Eerste versie laten maken met AI' });
  await sw.click();
  await expect(dlg.locator('#f-opsave')).toHaveText('Opslaan en AI starten');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await dlg.locator('#op-ai-text').fill('Drie opgaven over R = U / I met antwoordmodel.');
  await shot(page, '15-opdracht-met-ai');
  await dlg.locator('#f-opsave').click();
  const frame = page.frameLocator('#editor-frame');
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  await expect(panel.locator('.ai-bubble').first()).toContainText('Drie opgaven over R = U / I');
  await expect(panel.getByText('Voorstel', { exact: false }).first()).toBeVisible();
  const sent = await withMock(page, (m) => m.ai.calls.filter((c) => c.method === 'send').length);
  expect(sent).toBe(1);
  expect(errors).toEqual([]);
});

// Decision 75 (board 63): a failed batch offers "Laat AI dit oplossen", filled, not sent.
test('Laat AI dit oplossen: the editor opens with the input filled and the error attached', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await login(page);
  await noticeSeen(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await expect(async () => {
    await page.locator('[data-action="exam-menu"]:not([data-kind="summary"])').first().click();
    await page.getByRole('menuitem', { name: 'Opdrachten genereren' }).click({ timeout: 1000 });
  }).toPass();
  await page.locator('[data-action="og-key"]').click();
  await expect(page.locator('.og-result .rapport-pdf-frame')).toBeVisible();
  const first = await withMock(page, (m) => {
    const jobs = m.calls.filter((c) => c[0] === 'renderAssignmentBatch').at(-1)?.[1] as {
      opdrachtId: string;
    }[];
    m.batchFailures = [jobs[0]!.opdrachtId];
    return jobs[0]!.opdrachtId;
  });
  await page.locator('[data-action="og-back"]').click();
  await page.locator('[data-action="og-key"]').click();
  const card = page.locator(`.og-fail__card[data-opdracht="${first}"]`);
  await expect(card).toContainText('error: unknown variable: oeps');
  await shot(page, '16-generate-failed');
  await card.getByRole('button', { name: 'Laat AI dit oplossen' }).click();
  const frame = page.frameLocator('#editor-frame');
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  await expect(panel.getByRole('textbox', { name: 'Bericht' })).toHaveValue(
    /^Los de fouten en waarschuwingen in deze opdracht op/,
  );
  await expect(panel).toContainText('Foutmelding genereren.txt');
  const sent = await withMock(page, (m) => m.ai.calls.filter((c) => c.method === 'send').length);
  expect(sent).toBe(0);
  await shot(page, '17-fix-prefilled');
  expect(errors).toEqual([]);
});

// Review 32 M3: a run of a closed editor is stopped (it keeps nothing).
test('closing the editor stops its AI run', async ({ page }) => {
  await login(page);
  await noticeSeen(page);
  const frame = await openEditor(page);
  await frame.getByRole('button', { name: 'Claude Code', exact: true }).click();
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  await withMock(page, (m) => {
    m.ai.stepDelayMs = 800;
  });
  await panel.getByRole('textbox', { name: 'Bericht' }).fill('Langzaam');
  await panel.getByRole('button', { name: 'Versturen' }).click();
  await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();
  await frame.getByRole('button', { name: /Terug naar opdrachten/ }).click();
  await expect(page.locator('#editor-overlay')).toBeHidden();
  const stops = await withMock(page, (m) => m.ai.calls.filter((c) => c.method === 'stop').length);
  expect(stops).toBe(1);
});
