// SPDX-License-Identifier: AGPL-3.0-or-later
// Loads the reference renderer `Store` (`_reference/renderer/store.js`, a classic
// script) with `window.rtti` wired to the real main-process handlers.

import vm from 'node:vm';
import { REF_DIR, readRef } from './reference.mjs';
import path from 'node:path';

/**
 * Returns a fresh { Store, qKind } bound to `rtti`. Every call evaluates
 * store.js again, so caches never leak between scenarios.
 */
export function loadStore(rtti) {
  globalThis.window = { rtti };
  const src = `(function () {\n${readRef('renderer/store.js')}\nreturn { Store, qKind };\n})()`;
  // Line offset -1 keeps stack traces aligned with the reference file.
  return vm.runInThisContext(src, {
    filename: path.join(REF_DIR, 'renderer', 'store.js'),
    lineOffset: -1,
  });
}
