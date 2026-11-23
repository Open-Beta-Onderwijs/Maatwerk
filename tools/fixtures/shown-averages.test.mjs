// SPDX-License-Identifier: AGPL-3.0-or-later
// The Cijfergemiddelden test set is generated, never edited by hand.

import assert from 'node:assert/strict';
import test from 'node:test';
import { shownAverages } from './shown-averages.mjs';

test('crates/maatwerk-grades/tests/data/shown_averages.json is up to date (node tools/fixtures/shown-averages.mjs)', () => {
  assert.equal(shownAverages({ check: true }), true);
});
