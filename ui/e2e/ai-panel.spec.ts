// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 32b (spec 4.8.1, boards 59-61): the AI rail and chat panel in the editor against the
// scripted fake CLI (MockAi): starters, chips, a run with its status card, the diff card with
// Toepassen and Ongedaan maken, Voorstel bekijken, Stop, and the time-out card.

import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { TEACHER, login, watchErrors, withMock } from './helpers';

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
  // The first-use notice is ai-settings.spec's (step 32c).
  await withMock(
    page,
    (m, g) => m.ai.saveSettings(g, { enabled: true, timeLimitMinutes: 5, noticeSeen: true }),
    TEACHER,
  );
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

test('the panel resizes from 380 px up, saved per user; the input grows to 7 lines', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const frame = await openClaude(page);
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  const handle = frame.getByRole('separator', { name: 'Breedte AI-assistent' });
  await expect(handle).toHaveAttribute('aria-valuenow', '380');
  await handle.focus();
  await page.keyboard.press('ArrowRight'); // narrower: not under 380
  await expect(handle).toHaveAttribute('aria-valuenow', '380');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '420');

  // Drag 200 px to the left: wider.
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 200, y, { steps: 5 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '620');
  expect(Math.round((await panel.boundingBox())!.width)).toBe(620);

  // Saved in the user's file.
  await expect
    .poll(async () =>
      withMock(
        page,
        (m, rel) =>
          (JSON.parse(m.peek(rel) ?? '{}') as { preferences?: { aiPanelWidth?: number } })
            .preferences?.aiPanelWidth,
        `gebruikers/${TEACHER}.json`,
      ),
    )
    .toBe(620);

  // The input grows with its text up to 7 lines, then scrolls.
  const input = panel.getByRole('textbox', { name: 'Bericht' });
  const height = async () => (await input.boundingBox())!.height;
  await input.fill('regel');
  const one = await height();
  await input.fill(Array.from({ length: 5 }, (_, i) => `regel ${i + 1}`).join('\n'));
  const five = await height();
  // Two lines at least (rows=2), five lines for five.
  expect(five).toBeGreaterThan(one * 1.8);
  await input.fill(Array.from({ length: 12 }, (_, i) => `regel ${i + 1}`).join('\n'));
  const twelve = await height();
  expect(twelve).toBeGreaterThan(five);
  expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
  const lines = await input.evaluate((el) => {
    const cs = getComputedStyle(el);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return Math.round((el.clientHeight - pad) / parseFloat(cs.lineHeight));
  });
  expect(lines).toBe(7);

  // Double click: back to 380 px.
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '380');
  expect(errors).toEqual([]);
});

test('a follow-up message shows its status card at once; long step titles are cut off', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const frame = await openClaude(page);
  await withMock(page, (m) => {
    m.ai.stepDelayMs = 300;
  });
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  const input = panel.getByRole('textbox', { name: 'Bericht' });
  await input.fill('Voeg een regel toe');
  await panel.getByRole('button', { name: 'Versturen' }).click();
  await expect(panel.locator('.ai-diff-card')).toContainText('Voorstel');

  const long = `Uitvoeren: typst compile C:/Users/${'heel-lange-mapnaam-'.repeat(8)}/opdracht.typ`;
  await withMock(
    page,
    (m, title) => {
      m.ai.nextTurn = {
        events: [
          { kind: 'step', step: 'command', title, detail: null },
          { kind: 'stepOutput', text: 'error: niet gevonden', error: true },
          { kind: 'step', step: 'check', title: 'Opdracht controleren', detail: null },
          { kind: 'text', text: 'Klaar.' },
        ],
      };
    },
    long,
  );
  await input.fill('En nog een regel');
  await panel.getByRole('button', { name: 'Versturen' }).click();
  const status = panel.locator('.ai-status-card');
  await expect(status).toBeInViewport();
  await status.getByRole('button', { name: 'Volledig transcript' }).click();
  const title = status.locator('.ai-step-title', { hasText: 'Uitvoeren' });
  await expect(title).toHaveAttribute('title', long);
  // Cut off, and nothing in the chat scrolls sideways.
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const messages = panel.locator('.ai-messages');
  expect(await messages.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(panel.locator('.ai-diff-card')).toContainText('Voorstel');
  expect(errors).toEqual([]);
});

test('the answer is rendered as Markdown; HTML in it stays text', async ({ page }) => {
  const errors = watchErrors(page);
  const frame = await openClaude(page);
  await withMock(page, (m) => {
    m.ai.nextTurn = {
      answer: [
        '## Wat ik deed',
        '',
        'Ik heb **twee** dingen aangepast:',
        '',
        '1. `opgave_punten` verhoogd',
        '2. een *nieuwe* vraag',
        '',
        '```typst',
        '#vraag[Leg uit.]',
        '```',
        '',
        '<img src=x onerror="document.title=1">',
      ].join('\n'),
    };
  });
  const panel = frame.getByRole('region', { name: 'AI-assistent' });
  await panel.getByRole('textbox', { name: 'Bericht' }).fill('Pas iets aan');
  await panel.getByRole('button', { name: 'Versturen' }).click();
  const answer = panel.locator('.ai-msg.is-ai .ai-md');
  await expect(answer.locator('h5')).toHaveText('Wat ik deed');
  await expect(answer.locator('strong')).toHaveText('twee');
  await expect(answer.locator('ol > li')).toHaveCount(2);
  await expect(answer.locator('li code')).toHaveText('opgave_punten');
  await expect(answer.locator('em')).toHaveText('nieuwe');
  await expect(answer.locator('pre code')).toHaveText('#vraag[Leg uit.]');
  await expect(answer.locator('img')).toHaveCount(0);
  await expect(answer).toContainText('<img src=x');
  await shot(page, '06-markdown');
  expect(errors).toEqual([]);
});

test('diff card: applied keeps Bekijken (read-only); older proposals get a status line; reopen and undo', async ({
  page,
}) => {
  const errors = watchErrors(page);
  let frame = await openClaude(page);
  let panel = frame.getByRole('region', { name: 'AI-assistent' });
  const send = async (text: string) => {
    await panel.getByRole('textbox', { name: 'Bericht' }).fill(text);
    await panel.getByRole('button', { name: 'Versturen' }).click();
    await expect(panel.locator('.ai-status-card')).toHaveCount(0);
  };
  const card = () => panel.locator('.ai-diff-card');
  const statuses = () => panel.locator('.ai-proposal-status');

  // 1. Applied: files, Ongedaan maken and a read-only Bekijken.
  await send('Eerste');
  await card().getByRole('button', { name: 'Toepassen' }).click();
  await expect(card()).toContainText('Toegepast: 1 wijziging');
  await expect(card().getByRole('button', { name: 'Ongedaan maken' })).toBeVisible();
  await expect(card()).toContainText('opdracht.typ');
  await card().getByRole('button', { name: 'Bekijken' }).click();
  const dialog = frame.getByRole('dialog', { name: 'Voorstel van Claude Code' });
  await expect(dialog).toContainText('Toegepast');
  await expect(dialog.getByRole('button', { name: /^Toepassen/ })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Sluiten' }).click();
  await expect(dialog).toHaveCount(0);

  // 2. A follow-up: the applied one becomes a status line, the new one has the card.
  await send('Tweede');
  await expect(statuses()).toHaveText(['Voorstel toegepast']);
  await expect(card()).toHaveCount(1);
  await expect(card().getByRole('button', { name: 'Toepassen' })).toBeVisible();

  // 3. Not applied, then replaced.
  await send('Derde');
  await expect(statuses()).toHaveText([
    'Voorstel toegepast',
    'Voorstel vervangen door een nieuwer voorstel',
  ]);

  // 4. Apply the newest, reopen: "Toegepast" with Bekijken, no Ongedaan maken.
  await card().getByRole('button', { name: 'Toepassen' }).click();
  await expect(card()).toContainText('Toegepast: 1 wijziging');
  const reopen = async () => {
    await frame.locator('#btn-app-title').click();
    frame = await openEditor(page);
    await frame.getByRole('button', { name: /^Claude Code/ }).click();
    panel = frame.getByRole('region', { name: 'AI-assistent' });
  };
  await reopen();
  await expect(card().locator('.ai-diff-applied-text')).toHaveText('Toegepast');
  await expect(card().getByRole('button', { name: 'Bekijken' })).toBeVisible();
  await expect(card().getByRole('button', { name: 'Ongedaan maken' })).toHaveCount(0);
  await expect(statuses()).toHaveCount(2);

  // 5. Undo clears the history's "applied": after reopening the card offers Toepassen again.
  await send('Vierde');
  await card().getByRole('button', { name: 'Toepassen' }).click();
  await card().getByRole('button', { name: 'Ongedaan maken' }).click();
  await expect(card().getByRole('button', { name: 'Toepassen' })).toBeVisible();
  await reopen();
  await expect(card().getByRole('button', { name: 'Toepassen' })).toBeVisible();
  expect(errors).toEqual([]);
});
