// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MaatwerkApi } from './api';

/**
 * Creates the backend for this build and installs it as `window.maatwerk`
 * (the legacy screens call it as a global). `vite --mode mock` selects the
 * in-memory MockApi; every other mode the Tauri backend. The mode is a
 * build-time constant, so the mock is not bundled into the app.
 */
export async function installBridge(): Promise<MaatwerkApi> {
  let api: MaatwerkApi;
  if (import.meta.env.MODE === 'mock') {
    const { createMockFromFixtures } = await import('./mock/from-fixtures');
    const mock = createMockFromFixtures();
    (window as unknown as { __maatwerkMock: unknown }).__maatwerkMock = mock;
    api = mock;
  } else {
    const { createTauriApi } = await import('./tauri-api');
    api = createTauriApi();
  }
  window.maatwerk = api;
  return api;
}
