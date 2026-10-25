// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowed } from './spdx.mjs';

const allowed = new Set(['MIT', 'Apache-2.0', 'Apache-2.0 WITH LLVM-exception']);

test('single identifiers', () => {
  assert.equal(isAllowed('MIT', allowed), true);
  assert.equal(isAllowed('GPL-2.0-only', allowed), false);
});

test('OR needs one allowed alternative', () => {
  assert.equal(isAllowed('Apache-2.0 OR MIT', allowed), true);
  assert.equal(isAllowed('LicenseRef-Proprietary OR MIT', allowed), true);
});

test('AND needs every operand allowed', () => {
  assert.equal(isAllowed('MIT AND Apache-2.0', allowed), true);
  assert.equal(isAllowed('MIT AND LicenseRef-Proprietary', allowed), false);
});

test('AND binds tighter than OR, and parens are respected', () => {
  assert.equal(isAllowed('LicenseRef-Proprietary AND (MIT OR Apache-2.0)', allowed), false);
  assert.equal(isAllowed('LicenseRef-Proprietary AND MIT OR Apache-2.0', allowed), true);
  assert.equal(isAllowed('(MIT OR LicenseRef-X) AND Apache-2.0', allowed), true);
});

test('WITH exceptions are matched as a whole', () => {
  assert.equal(isAllowed('Apache-2.0 WITH LLVM-exception', allowed), true);
  assert.equal(isAllowed('MIT WITH Some-exception', allowed), false);
});

test('malformed or missing expressions are rejected', () => {
  for (const bad of ['', '   ', '(MIT', 'MIT)', 'MIT OR', 'AND MIT', 'MIT MIT', undefined, 42]) {
    assert.equal(isAllowed(bad, allowed), false, String(bad));
  }
});
