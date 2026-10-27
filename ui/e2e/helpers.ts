// SPDX-License-Identifier: AGPL-3.0-or-later

// Shared steps for the Playwright tests on the mock build (tiny fixture).

import { expect, type Page } from '@playwright/test';
import type { MockApi } from '../src/bridge/mock/mock-api';

export const TEACHER = 'gebr-1756713600001'; // Docent van Natuur, nat + schk
export const YEAR = '2025-2026';

/** Collects console errors and page errors of the page and its frames. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
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

/** Opens the app and logs in (default: the nat teacher). */
export async function login(page: Page, subject = 'nat', userId = TEACHER): Promise<void> {
  await page.goto('/');
  await page.locator(`.subject-card[data-subject="${subject}"]`).click();
  await page.locator(`.user-badge[data-user-id="${userId}"]`).click();
  await expect(page.locator('#topbar')).toBeVisible();
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
