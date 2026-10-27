// SPDX-License-Identifier: AGPL-3.0-or-later

// Runs the ported Store (src/store.js) on a MockApi, like the reference harness
// runs the reference Store on a real folder (tests/reference-harness/session.mjs).
// Used to check the Store against the goldens whose `data` case holds the
// scenario's data folder.

import { vi } from 'vitest';
import { MockApi, type MockSeed } from '../src/bridge/mock/mock-api';

/** The Store's public surface as the tests use it (it is untyped legacy JS). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LegacyStore = Record<string, (...args: any[]) => any>;

export interface StoreSession {
  Store: LegacyStore;
  api: MockApi;
}

/** files: relPath -> file content, as stored in a golden `data` case. */
export async function openStore({
  files,
  subject = 'nat',
  user = 'gebr-1756713600001',
}: {
  files: Record<string, string>;
  subject?: string | null;
  user?: string;
}): Promise<StoreSession> {
  const seed: MockSeed = {
    files: Object.fromEntries(Object.entries(files).map(([rel, text]) => [rel, { text }])),
    dirs: [],
  };
  const api = new MockApi(seed);
  const g = globalThis as unknown as { window?: { maatwerk?: MockApi } };
  g.window ??= {};
  g.window.maatwerk = api;
  vi.resetModules(); // a fresh Store (module state) per session
  const { Store } = (await import('../src/store.js')) as unknown as { Store: LegacyStore };
  await Store.preload!();
  Store.setActiveUser!(
    user === 'admin' ? { id: 'admin', isAdmin: true } : { id: user, isAdmin: false },
  );
  if (subject !== undefined) await Store.initSubject!(subject);
  return { Store, api };
}
