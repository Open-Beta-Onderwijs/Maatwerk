// SPDX-License-Identifier: AGPL-3.0-or-later

// Visual regression of every screen and modal on the mock build (tiny
// fixture), for refactors that must not change the look (Step 3a: inline
// styles -> CSS classes). Local tool (Playwright project "visual"), not run in
// CI: the baseline images are machine-specific and not committed.
//
//   npm run test:visual -- --update-snapshots   # baseline before the change
//   npm run test:visual                         # compare after the change

import { expect, test } from '@playwright/test';
import { VIEWS, openView } from './views';

const SETTLE = 1300; // Chart.js animations last 1000 ms

// Tall window: modals show most of their content without scrolling.
test.use({ viewport: { width: 1280, height: 2000 } });

for (const view of VIEWS) {
  test(view.name, async ({ page }) => {
    await openView(page, view);
    await page.waitForTimeout(SETTLE);
    const opts = { animations: 'disabled' as const, maxDiffPixels: 0 };
    if (view.target === 'modal')
      await expect(page.locator('#modal-box')).toHaveScreenshot(`${view.name}.png`, opts);
    else await expect(page).toHaveScreenshot(`${view.name}.png`, { ...opts, fullPage: true });
  });
}
