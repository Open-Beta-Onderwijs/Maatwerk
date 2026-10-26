// SPDX-License-Identifier: AGPL-3.0-or-later
// The generator must be deterministic: same name, byte-identical tree.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generate, treeHash } from './generate.mjs';

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
