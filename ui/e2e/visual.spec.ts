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

// Light/blauw (the default, no suffix), dark, and yellow (the contrast edge
// case: dark text on the accent). Set through the dev theme menu's storage key.
const LOOKS = [
  { suffix: '', look: null },
  { suffix: '--dark', look: { theme: 'dark', accent: 'blauw' } },
  { suffix: '--geel', look: { theme: 'light', accent: 'geel' } },
] as const;

for (const { suffix, look } of LOOKS) {
  for (const view of VIEWS) {
    test(`${view.name}${suffix}`, async ({ page }) => {
      if (look)
        await page.addInitScript(
          (v) => localStorage.setItem('maatwerk.dev.look', v),
          JSON.stringify(look),
        );
      await openView(page, view);
      await page.waitForTimeout(SETTLE);
      const opts = { animations: 'disabled' as const, maxDiffPixels: 0 };
      const file = `${view.name}${suffix}.png`;
      if (view.target === 'modal')
        await expect(page.locator('.dlg').last()).toHaveScreenshot(file, opts);
      else await expect(page).toHaveScreenshot(file, { ...opts, fullPage: true });
    });
  }
}
