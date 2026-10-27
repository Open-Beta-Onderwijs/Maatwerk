// SPDX-License-Identifier: AGPL-3.0-or-later

// The mock build carries the strict CSP (ui/vite/csp.ts). Opening every screen
// and modal must not trigger a single violation (an inline style attribute,
// an inline script, a remote load) and must not log errors.

import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';
import { VIEWS, openView } from './views';

for (const view of VIEWS) {
  test(`no CSP violation or error: ${view.name}`, async ({ page }) => {
    const errors = watchErrors(page);
    await openView(page, view);
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
  });
}
