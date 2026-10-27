// SPDX-License-Identifier: AGPL-3.0-or-later

// Playwright smoke tests run the mock build (MockApi, strict CSP) in Chromium.
// `npm run test:e2e` builds it first.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: 'visual.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // Local visual regression (npm run test:visual); not part of test:e2e or CI.
    { name: 'visual', testMatch: 'visual.spec.ts', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx vite preview --outDir dist-mock --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Never reuse: a preview left running may serve an older dist-mock (review 3a n6).
    reuseExistingServer: false,
  },
});
