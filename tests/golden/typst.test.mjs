// SPDX-License-Identifier: AGPL-3.0-or-later
// Typst goldens (tests/golden/typst/<case>/): structure and PNG hashes. They were rendered by the
// reference app (the harness went at 1.0, PLAN-2 decision 88); the Rust tests compare the port
// with them.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { REFERENCE_COMMIT } from '../support/golden.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'typst');
const cases = fs.readdirSync(DIR).filter((d) => fs.statSync(path.join(DIR, d)).isDirectory()).sort();
const load = (id) => JSON.parse(fs.readFileSync(path.join(DIR, id, 'case.json'), 'utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// A Maatwerk-only output (step 24: the PO rapport) has no reference render: its channel is the
// bridge method, and it is a golden from the start (`port.blessed`, after the user's check).
const nativeOnly = (c) => !c.call.channel.startsWith('app:');

test('there are Typst goldens for paths A-D', () => {
  const paths = new Set(cases.map((id) => load(id).path));
  assert.deepEqual([...paths].sort(), ['A', 'B', 'C', 'D']);
});

for (const id of cases) {
  test(`typst ${id}: structure and PNG hashes`, () => {
    const c = load(id);
    assert.equal(c.format, 1);
    assert.equal(c.id, id);
    if (nativeOnly(c)) assert.equal(typeof c.port?.blessed, 'string', 'a Maatwerk-only golden is blessed');
    else assert.equal(c.reference.commit, REFERENCE_COMMIT);
    const pngs = fs.readdirSync(path.join(DIR, id)).filter((f) => f.endsWith('.png')).sort();
    assert.deepEqual(pngs, (c.png ?? []).map((p) => p.file));
    for (const p of c.png ?? []) assert.equal(sha256(fs.readFileSync(path.join(DIR, id, p.file))), p.sha256, p.file);
    if (c.result.success) {
      const pages = c.pdf?.pageCount ?? c.svg?.length;
      assert.ok(pages > 0);
      if (c.pdf) assert.equal(c.pdf.pages.length, c.pdf.pageCount);
      if (c.png) assert.equal(c.png.length, pages);
    } else {
      assert.equal(typeof c.result.error, 'string');
      assert.ok(!/[A-Z]:\\Users/i.test(c.result.error), 'absolute paths are normalised');
    }
  });

}
