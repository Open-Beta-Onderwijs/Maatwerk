// SPDX-License-Identifier: AGPL-3.0-or-later
// The generator must be deterministic: same name, byte-identical tree.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { exportOpdrachten } from './export-opdrachten.mjs';
import { generate, treeHash } from './generate.mjs';
import { PO_OBSERVATIES, RUBRICS } from './rubrics.mjs';

test('the rubrics name only PO observaties of the fixture', () => {
  assert.equal(RUBRICS.length, 3);
  const po = new Set(PO_OBSERVATIES.map((o) => o.id));
  for (const r of RUBRICS)
    for (const id of [...r.obs_ids, ...r.categories.flatMap((c) => c.obs_ids)])
      assert.ok(po.has(id), `${r.id} names ${id}`);
});

test('the Rust opdracht fixtures match the tiny fixture (node tools/fixtures/export-opdrachten.mjs)', () => {
  assert.deepEqual(exportOpdrachten(undefined, { check: true }), []);
});

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

for (const name of Object.keys(manifest)) {
  test(`fixture '${name}' matches tools/fixtures/manifest.json`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `maatwerk-fx-${name}-`));
    try {
      generate(name, dir);
      assert.deepEqual(treeHash(dir), manifest[name]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
