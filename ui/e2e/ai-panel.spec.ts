// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 32b (spec 4.8.1, boards 59-61): the AI rail and chat panel in the editor against the
// scripted fake CLI (MockAi): starters, chips, a run with its status card, the diff card with
// Toepassen and Ongedaan maken, Voorstel bekijken, Stop, and the time-out card.

import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { login, watchErrors, withMock } from './helpers';

const SHOTS = process.env.AI_SHOTS;

async function openEditor(page: Page): Promise<FrameLocator> {
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('[data-action="open-editor"]').first().click();
  const frame = page.frameLocator('#editor-frame');
  await expect(frame.locator('.cm-content')).toBeVisible();
  await expect(frame.locator('.svg-page').first()).toBeVisible();
  return frame;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openClaude(page: Page): Promise<FrameLocator> {
  await page.setViewportSize({ width: 1600, height: 900 });
  await login(page);
  const frame = await openEditor(page);
  await frame.getByRole('button', { name: 'Claude Code', exact: true }).click();
  await expect(
    frame.getByRole('heading', { name: 'Waar kan Claude Code mee helpen?' }),
  ).toBeVisible();
  return frame;
}

test('rail, empty chat with starters, chips and footer; a starter fills the input', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const frame = await openClaude(page);
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  await expect(panel.getByRole('button', { name: /Antwoorden en punten aanvullen/ })).toBeVisible();
  // The fixture opdracht compiles: no Fouten oplossen.
  await expect(panel.getByRole('button', { name: /Fouten oplossen/ })).toHaveCount(0);
  const chips = panel.getByRole('group', { name: 'Context die wordt meegestuurd' });
  await expect(chips.getByRole('button', { name: 'Opdrachtinstructies AI' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(chips.getByRole('button', { name: 'Afbeeldingen' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(panel).toContainText('Alleen deze opdracht en de gekozen context worden verstuurd');
  await shot(page, '01-empty');

  // Afbeeldingen shows the warning.
  await chips.getByRole('button', { name: 'Afbeeldingen' }).click();
  await expect(panel.getByRole('alert')).toContainText('Afbeeldingen kunnen leerlingen tonen');

  // The syllabus listbox.
  await chips.getByRole('button', { name: /^Syllabus:/ }).click();
  const list = panel.getByRole('listbox', { name: 'Syllabus' });
  await expect(list.getByRole('option')).toHaveCount(2);
  await shot(page, '02-syllabus');
  await list.getByRole('option', { name: /Geen/ }).click();
  await expect(chips.getByRole('button', { name: /^Syllabus: Geen/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await panel.getByRole('button', { name: /Nieuwe opgave toevoegen/ }).click();
  await expect(panel.getByRole('textbox', { name: 'Bericht' })).toHaveValue(
    'Voeg een nieuwe opgave toe over ',
  );
  // Clicking the open provider closes the panel.
  await frame.getByRole('button', { name: 'Claude Code', exact: true }).click();
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test('a run: status card, proposal, Toepassen as one change, Ongedaan maken', async ({ page }) => {
  const errors = watchErrors(page);
  const frame = await openClaude(page);
  await withMock(page, (m) => {
    m.ai.stepDelayMs = 150;
  });
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  const before = await frame.locator('.cm-content').innerText();
  await panel.getByRole('textbox', { name: 'Bericht' }).fill('Voeg een regel toe');
  await panel.getByRole('button', { name: 'Versturen' }).click();
  await expect(panel.locator('.ai-status-card')).toBeVisible();
  await expect(frame.locator('#editor-status')).toHaveText('Claude Code is bezig');
  await expect(frame.locator('#ai-copy-bar')).toContainText('werkt op een kopie');
  await shot(page, '03-running');

  const card = panel.locator('.ai-diff-card');
  await expect(card).toContainText('Voorstel');
  await expect(card).toContainText('1 wijziging · 1 bestand');
  await expect(frame.locator('#ai-copy-bar')).toBeHidden();
  await expect(panel.getByRole('button', { name: /Klaar in/ })).toBeVisible();
  await shot(page, '04-proposal');

  await card.getByRole('button', { name: 'Toepassen' }).click();
  await expect(card).toContainText('Toegepast: 1 wijziging');
  await expect(frame.locator('.cm-content')).toContainText('Voorgesteld door de AI (mock)');
  await shot(page, '05-applied');
  await card.getByRole('button', { name: 'Ongedaan maken' }).click();
  await expect(frame.locator('.cm-content')).not.toContainText('Voorgesteld door de AI');
  expect(await frame.locator('.cm-content').innerText()).toBe(before);
  await expect(card.getByRole('button', { name: 'Toepassen' })).toBeVisible();

  // The transcript after the run.
  await panel.getByRole('button', { name: /Klaar in/ }).click();
  await expect(panel.locator('.ai-transcript')).toContainText('Transcript · claude');
  expect(errors).toEqual([]);
});

test('Voorstel bekijken: hunks with checkboxes, preview, Toepassen (n)', async ({ page }) => {
  const errors = watchErrors(page);
  const frame = await openClaude(page);
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  await panel.getByRole('textbox', { name: 'Bericht' }).fill('Iets');
  await panel.getByRole('button', { name: 'Versturen' }).click();
  await panel.locator('.ai-diff-card').getByRole('button', { name: 'Bekijken' }).click();
  const dialog = frame.getByRole('dialog', { name: 'Voorstel van Claude Code' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('1 van 1 gekozen');
  await expect(dialog.getByRole('img', { name: 'Pagina 1' })).toBeVisible();
  await shot(page, '06-review');
  await dialog.getByRole('button', { name: 'Niets' }).click();
  await expect(dialog.getByRole('button', { name: 'Toepassen', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Wijziging 1 toepassen' }).click();
  await dialog.getByRole('button', { name: 'Toepassen (1)' }).click();
  await expect(dialog).toBeHidden();
  await expect(frame.locator('.cm-content')).toContainText('Voorgesteld door de AI (mock)');
  expect(errors).toEqual([]);
});

test('Stop keeps nothing; a time-out shows its card', async ({ page }) => {
  const frame = await openClaude(page);
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  await withMock(page, (m) => {
    m.ai.stepDelayMs = 800;
  });
  await panel.getByRole('textbox', { name: 'Bericht' }).fill('Langzaam');
  await panel.getByRole('button', { name: 'Versturen' }).click();
  await expect(panel.getByRole('textbox', { name: 'Bericht' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('alert')).toContainText('Je hebt de AI gestopt na');
  await expect(panel.locator('.ai-diff-card')).toHaveCount(0);
  await shot(page, '07-stopped');

  await withMock(page, (m) => {
    m.ai.stepDelayMs = 0;
    m.ai.nextTurn = { outcome: 'timedOut', append: '' };
  });
  await panel.getByRole('textbox', { name: 'Bericht' }).fill('Nog eens');
  await panel.getByRole('button', { name: 'Versturen' }).click();
  await expect(panel.getByRole('alert').last()).toContainText('Gestopt na 5 minuten');
});
