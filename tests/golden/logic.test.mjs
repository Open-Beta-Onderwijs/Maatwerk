// SPDX-License-Identifier: AGPL-3.0-or-later
// Logic goldens: their structure. They were captured from the reference app (the harness went at
// 1.0, PLAN-2 decision 88) and are checked against the port by the Vitest and Rust tests.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { FORMAT, LOGIC_DIR, REFERENCE_COMMIT, readGolden } from '../support/golden.mjs';

const names = fs
  .readdirSync(LOGIC_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

test('the logic goldens are there', () => {
  assert.ok(names.length >= 11, names.join(', '));
});

for (const name of names) {
  test(`golden ${name}: well-formed`, () => {
    const g = readGolden(name);
    assert.equal(g.format, FORMAT);
    assert.equal(g.suite, name);
    assert.equal(g.reference.commit, REFERENCE_COMMIT);
    assert.ok(g.reference.code.length > 0, 'cites reference code');
    for (const ref of g.reference.code) assert.match(ref, /^renderer\/[\w/.-]+\.js:\d+-\d+ \S/);
    assert.ok(g.cases.length > 0);
    const ids = new Set();
    for (const c of g.cases) {
      assert.ok(!ids.has(c.id), `duplicate case ${c.id}`);
      ids.add(c.id);
      assert.equal(typeof c.rule, 'string');
      assert.ok('input' in c && 'output' in c, `${c.id}: input and output`);
    }
  });
}
