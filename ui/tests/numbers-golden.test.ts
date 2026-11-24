// SPDX-License-Identifier: AGPL-3.0-or-later

// Review 38 M2: the MockApi mirror (every e2e and visual test runs on it) against the committed
// Rust output in crates/maatwerk-core/tests/fixtures/numbers. `numbers_golden.rs` checks Rust
// against the same files, so a drift on either side fails a normal test run.
// Regenerate with `node tools/numbers-golden.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFormats } from '../src/domain/numbers';
import { compare } from './numbers-compare';

const GOLDEN = path.resolve(__dirname, '../../crates/maatwerk-core/tests/fixtures/numbers');
const format = (code: string) => ({
  methode: code[0] === 'a' ? 'afronden' : 'afkappen',
  decimalen: Number(code[1]),
});

const cases = fs.readdirSync(path.join(GOLDEN, 'expected'));

describe('MockApi numbers = the committed Rust golden', () => {
  it('has cases', () => expect(cases.length).toBeGreaterThanOrEqual(2));

  it.each(cases)('format %s', (name) => {
    const [r, se] = name.split('-') as [string, string];
    const dir = path.join(GOLDEN, 'expected', name);
    const files = fs.readdirSync(dir).map((f) => ({
      year: f.slice(0, 9),
      vak: f.slice(10, -'.json'.length),
      rust: path.join(dir, f),
    }));
    const formats = readFormats({ gemiddelden: { r: format(r), se: format(se) } });
    const diffs = compare({ data: path.join(GOLDEN, 'data'), cases: files }, formats);
    expect(diffs).toEqual([]);
  });
});
