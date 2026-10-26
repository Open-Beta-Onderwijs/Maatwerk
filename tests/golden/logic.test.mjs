// SPDX-License-Identifier: AGPL-3.0-or-later
// Logic goldens: structure is checked everywhere (CI has no `_reference/`);
// with `_reference/` present the reference is re-run and must match byte for byte.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { FORMAT, LOGIC_DIR, goldenPath, readGolden } from '../reference-harness/golden.mjs';
import { REFERENCE_COMMIT, referenceAvailable } from '../reference-harness/reference.mjs';
import { runSuite, suiteNames } from '../reference-harness/regen.mjs';

const names = suiteNames();

test('every suite has a golden and every golden has a suite', () => {
  const files = fs
    .readdirSync(LOGIC_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
  assert.deepEqual(files, names);
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

  test(
    `golden ${name}: matches the reference`,
    { skip: referenceAvailable() ? false : '_reference/ not available' },
    () => {
      assert.equal(runSuite(name), fs.readFileSync(goldenPath(name), 'utf8'));
    },
  );
}
