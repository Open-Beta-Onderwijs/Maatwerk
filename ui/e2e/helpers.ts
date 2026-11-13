// SPDX-License-Identifier: AGPL-3.0-or-later

// Shared steps for the Playwright tests on the mock build (tiny fixture).

import { expect, type Page } from '@playwright/test';
import type { MockApi } from '../src/bridge/mock/mock-api';

export const TEACHER = 'gebr-1756713600001'; // Docent van Natuur, nat + schk
export const YEAR = '2025-2026';
/** The PIN the tests choose at a user's first login (Step 7b). */
export const PIN = '12345';

/** Collects console errors and page errors of the page and its frames. */
const WEBKIT_SELECT_CSP =
  "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not " +
  'appear in the style-src directive of the Content Security Policy.';

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  const webkit = page.context().browser()?.browserType().name() === 'webkit';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Playwright's WebKit reports a style-src-attr violation for every native <select> (its own
    // inner styles; no source sample). The app's code is checked for inline styles in Chromium.
    if (webkit && m.text() === WEBKIT_SELECT_CSP) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Replaces fixture files (relPath -> JSON value) before the app starts. */
export async function seedFiles(page: Page, files: Record<string, unknown>): Promise<void> {
  await page.addInitScript((f) => {
    (window as unknown as { __maatwerkMockFiles: unknown }).__maatwerkMockFiles = f;
  }, files);
}

/** Runs fn(mock, arg) in the page on its MockApi (no eval: works under the strict CSP). */
export async function withMock<R, A = undefined>(
  page: Page,
  fn: (mock: MockApi, arg: A) => R | Promise<R>,
  arg?: A,
): Promise<R> {
  // The bridge installs the mock asynchronously after the page loads.
  const handle = await page.waitForFunction(
    () => (window as unknown as { __maatwerkMock?: MockApi }).__maatwerkMock,
  );
  return handle.evaluate(fn as never, arg as never) as Promise<R>;
}

/** Fixture file as JSON, read through the MockApi. */
export function readMockJson<T = unknown>(page: Page, relPath: string): Promise<T> {
  return withMock(page, (m, p) => JSON.parse(m.peek(p) ?? 'null'), relPath) as Promise<T>;
}

/**
 * The PIN step after a badge click: chooses `pin` at the first login (and
 * confirms the admin's recovery codes) or types it at a later one.
 */
export async function enterPin(page: Page, pin = PIN): Promise<void> {
  const first = page.locator('#pin-new');
  const again = page.locator('#pin-input');
  await expect(first.or(again)).toBeVisible();
  if (await first.isVisible()) {
    await first.fill(pin);
    await page.locator('#pin-repeat').fill(pin);
    await page.locator('#pin-ok').click();
    const codes = page.locator('#codes-kept');
    // The badge in the top bar appears once the login is complete.
    await expect(codes.or(page.locator('#user-badge-btn:not(.hidden)'))).toBeVisible();
    if (await codes.isVisible()) {
      await codes.check();
      await page.locator('#codes-done').click();
    }
  } else {
    await again.fill(pin);
    await page.locator('#pin-ok').click();
  }
}

/**
 * Chooses a vak on the login screen. The last vak is chosen already after a
 * logout, and clicking a chosen tile again goes back (spec 4.2), so a chosen
 * tile is left alone.
 */
export async function chooseVak(page: Page, subject: string): Promise<void> {
  const tile = page.locator(`.subject-card[data-subject="${subject}"]`);
  await expect(tile).toBeVisible();
  if ((await tile.getAttribute('aria-pressed')) !== 'true') await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
}

/** Opens the app and logs in (default: the nat teacher). */
export async function login(page: Page, subject = 'nat', userId = TEACHER): Promise<void> {
  await page.goto('/');
  await chooseVak(page, subject);
  await page.locator(`.user-badge[data-user-id="${userId}"]`).click();
  await enterPin(page);
  await expect(page.locator('#topbar')).toBeVisible();
}

/** "Uitloggen" in the user menu behind the top-bar avatar (opened unless it is open). */
export async function logout(page: Page): Promise<void> {
  if (!(await page.locator('#user-menu').isVisible()))
    await page.locator('#user-badge-btn').click();
  await page.locator('#acc-logout').click();
}

/**
 * Opens an exam's menu on the Toetsen screen and picks an item. The exam list
 * re-renders once its statistics are loaded, which can detach an open menu, so
 * this retries until the click lands (backlog: wait for a "list rendered" signal).
 */
export async function examMenuItem(page: Page, examId: string, item: string): Promise<void> {
  await expect(async () => {
    await page.locator(`[data-action="exam-menu"][data-id="${examId}"]`).click();
    await page.getByRole('menuitem', { name: item }).click({ timeout: 1000 });
  }).toPass();
}
