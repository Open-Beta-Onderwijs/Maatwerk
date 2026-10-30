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
    // Test hooks: Playwright reaches the mock as window.__maatwerkMock and can
    // replace fixture files before the app starts (window.__maatwerkMockFiles,
    // relPath -> JSON value) and the data folder status
    // (window.__maatwerkMockFolderStatus). Data only: the strict CSP forbids eval.
    const hooks = window as unknown as {
      __maatwerkMock: unknown;
      __maatwerkMockFiles?: Record<string, unknown>;
      __maatwerkMockFolderStatus?: typeof mock.folderStatus;
    };
    hooks.__maatwerkMock = mock;
    if (hooks.__maatwerkMockFolderStatus) mock.folderStatus = hooks.__maatwerkMockFolderStatus;
    for (const [relPath, data] of Object.entries(hooks.__maatwerkMockFiles ?? {})) {
      await mock.writeJson(relPath, data);
    }
    mock.calls.length = 0;
    api = mock;
  } else {
    const { createTauriApi } = await import('./tauri-api');
    api = createTauriApi();
  }
  window.maatwerk = api;
  return api;
}
