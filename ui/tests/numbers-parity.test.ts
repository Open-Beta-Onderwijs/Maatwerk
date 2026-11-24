// SPDX-License-Identifier: AGPL-3.0-or-later

// Step 38: the Rust numbers (`maatwerk-cli numbers`, `maatwerk_core::numbers`) against the
// MockApi's mirror (`bridge/mock/mock-numbers.ts`, every number through the WASM grade rules),
// entry by entry, at any Cijfergemiddelden format. Runs only from
// `node tools/numbers-parity.mjs <tiny|school> [r-format [se-format]]`, which generates the
// fixture, runs the CLI and passes the manifest in MAATWERK_PARITY. Every difference is written
// to the manifest's `out` file and fails the test.
//
// Until the screens moved to Rust (step 38.5) this test also compared with the screens' old JS
// path: 0 differences on tiny and school (docs/phase-2/step-38-numbers.md).

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, readJson, type Manifest } from './numbers-compare';

const manifestPath = process.env.MAATWERK_PARITY;

describe.skipIf(!manifestPath)('Rust numbers = the MockApi mirror (step 38)', () => {
  it('has no differences', () => {
    const m = readJson(manifestPath!) as Manifest;
    const diffs = compare(m);
    fs.writeFileSync(
      m.out,
      ['| Where | MockApi (TS/WASM) | Rust |', '| --- | --- | --- |', ...diffs].join('\n') + '\n',
    );
    expect(diffs.length, `${diffs.length} differences, see ${m.out}`).toBe(0);
    // `school`: about 30 s.
  }, 600_000);
});
