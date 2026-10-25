// SPDX-License-Identifier: AGPL-3.0-or-later
// One-call setup: reference main process + Store on a generated fixture folder.

import fs from 'node:fs';
import path from 'node:path';
import { generate } from '../../tools/fixtures/generate.mjs';
import { startMainProcess } from './main-process.mjs';
import { requireReference } from './reference.mjs';
import { loadStore } from './store.mjs';

/**
 * fixture: 'tiny' | 'school' | null (empty data folder) | (dataDir) => void.
 * subject: active subject for initSubject (null = admin view).
 * main: options for startMainProcess (e.g. onWrite).
 * Returns { mp, Store, qKind, dataDir, dispose }.
 */
export async function openReference({
  fixture = 'tiny',
  subject = 'nat',
  user = 'gebr-1756713600001',
  main = {},
} = {}) {
  requireReference();
  const mp = startMainProcess(main);
  try {
    if (typeof fixture === 'string') {
      fs.rmSync(mp.dataDir, { recursive: true, force: true });
      generate(fixture, mp.dataDir);
    } else if (typeof fixture === 'function') {
      fixture(mp.dataDir);
    }
    const { Store, qKind } = loadStore(mp.rtti);
    await Store.preload();
    Store.setActiveUser?.(
      user === 'admin' ? { id: 'admin', isAdmin: true } : { id: user, isAdmin: false },
    );
    if (subject !== undefined) await Store.initSubject(subject);
    return { mp, Store, qKind, dataDir: mp.dataDir, dispose: mp.dispose };
  } catch (e) {
    mp.dispose();
    throw e;
  }
}

export const dataPath = (session, rel) => path.join(session.dataDir, ...rel.split('/'));
