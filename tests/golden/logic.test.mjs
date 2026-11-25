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

// The `data` cases hold the reference's v1 folders converted once to the current format (step
// 39b, user's OK): what the app reads, no converter in the tests.
test('the golden data folders are in the current format', () => {
  for (const name of names) {
    const data = readGolden(name).cases.find((c) => c.id === 'data');
    if (!data) continue;
    for (const [rel, text] of Object.entries(data.input.files)) {
      if (!rel.endsWith('.json')) continue;
      const v = JSON.parse(text);
      if (rel === 'config.json') assert.equal(v.schema_version, 3, `${name}: ${rel}`);
      if (/\/students-[^/]+\.json$/.test(rel)) assert.ok(Array.isArray(v.students), rel);
      if (/\/scores\//.test(rel)) {
        assert.equal(typeof v.student_id, 'string', `${name}: ${rel}`);
        for (const qs of Object.values(v.scores ?? {}))
          assert.ok(!Object.values(qs).includes(null), `${name}: ${rel} has null, not "N"`);
      }
      assert.ok(!rel.startsWith('templates/RTTI'), `${name}: ${rel} is v1`);
      assert.ok(!/^opdrachten\/[^/]+\.json$/.test(rel), `${name}: ${rel} is v1`);
    }
  }
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
