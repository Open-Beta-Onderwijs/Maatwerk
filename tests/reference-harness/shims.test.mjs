// SPDX-License-Identifier: AGPL-3.0-or-later
// tools/reference-shims/*.cjs must hold the reference code unchanged.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SHIM_DIR, shimSources, verbatimBlocks } from './make-shims.mjs';
import { readRef, referenceAvailable } from './reference.mjs';

const skip = referenceAvailable() ? false : '_reference/ not available';

test('shims are exactly what make-shims.mjs generates', { skip }, () => {
  for (const [name, text] of Object.entries(shimSources())) {
    assert.equal(fs.readFileSync(path.join(SHIM_DIR, name), 'utf8'), text, name);
  }
});

test('every @verbatim block equals the cited reference lines', { skip }, () => {
  let blocks = 0;
  for (const name of fs.readdirSync(SHIM_DIR).filter((f) => f.endsWith('.cjs'))) {
    for (const b of verbatimBlocks(fs.readFileSync(path.join(SHIM_DIR, name), 'utf8'))) {
      const lines = readRef(b.file).split(/\r?\n/).slice(b.a - 1, b.b);
      assert.equal(b.text, lines.join('\n'), `${name}: ${b.file}:${b.a}-${b.b}`);
      blocks++;
    }
  }
  assert.equal(blocks, 5);
});
