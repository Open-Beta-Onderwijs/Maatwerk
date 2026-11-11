// SPDX-License-Identifier: AGPL-3.0-or-later

// Playwright smoke tests run the mock build (MockApi, strict CSP) in Chromium (WebView2 on
// Windows) and WebKit (step 16: the engine of WKWebView on macOS and WebKitGTK on Linux).
// `npm run test:e2e` / `npm run test:e2e:webkit` build it first.

import { defineConfig, devices } from '@playwright/test';

/** Committed baselines of the CI visual projects, one folder per project and OS. */
const CI_BASELINES = '{testDir}/visual-baselines/{projectName}-{platform}/{arg}{ext}';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry on CI only: a crashed browser on a busy runner (WebKit "Target crashed", run
  // 42796057189) should not fail the run. A test that passes only on the retry is still
  // reported as flaky, and a real failure fails twice.
  retries: process.env.CI ? 1 : 0,
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
    // Playwright's WebKit is close to, not the same as, the app's WebView on macOS and Linux:
    // it catches engine differences (CSS, events, canvas, workers), not the OS integration.
    {
      name: 'webkit',
      testIgnore: 'visual.spec.ts',
      use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 },
    },
    // Local visual regression (npm run test:visual); not part of test:e2e or CI.
    { name: 'visual', testMatch: 'visual.spec.ts', use: { ...devices['Desktop Chrome'] } },
    // CI visual regression (step 16b, user decision 2026-11-06): the light look of every view,
    // baselines per CI platform committed in e2e/visual-baselines/ (docs/testing.md).
    {
      name: 'visual-ci-chromium',
      testMatch: 'visual.spec.ts',
      snapshotPathTemplate: CI_BASELINES,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual-ci-webkit',
      testMatch: 'visual.spec.ts',
      snapshotPathTemplate: CI_BASELINES,
      use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: 'npx vite preview --outDir dist-mock --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Never reuse: a preview left running may serve an older dist-mock (review 3a n6).
    reuseExistingServer: false,
  },
});
