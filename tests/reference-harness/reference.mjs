// SPDX-License-Identifier: AGPL-3.0-or-later
// Locates the read-only reference checkout (`_reference/`) and pins its commit.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Commit the goldens were captured from (docs/reference/VERSION.md). */
export const REFERENCE_COMMIT = '0e30a70cbe4e9286bd54efa5722fb7532c1be308';

export const REF_DIR = path.resolve(
  process.env.MAATWERK_REFERENCE ?? path.join(REPO_ROOT, '_reference'),
);

export function referenceAvailable() {
  return (
    fs.existsSync(path.join(REF_DIR, 'main.js')) &&
    fs.existsSync(path.join(REF_DIR, 'renderer', 'store.js'))
  );
}

/** Throws unless `_reference/` exists and is checked out at REFERENCE_COMMIT. */
export function requireReference() {
  if (!referenceAvailable()) {
    throw new Error(`reference checkout not found at ${REF_DIR} (see docs/reference/VERSION.md)`);
  }
  const head = execFileSync('git', ['-C', REF_DIR, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (head !== REFERENCE_COMMIT) {
    throw new Error(
      `_reference is at ${head}, goldens need ${REFERENCE_COMMIT}: git -C _reference checkout ${REFERENCE_COMMIT.slice(0, 7)}`,
    );
  }
  return REF_DIR;
}

export const refPath = (rel) => path.join(REF_DIR, rel);
export const readRef = (rel) => fs.readFileSync(refPath(rel), 'utf8');
