// SPDX-License-Identifier: AGPL-3.0-or-later

// Loads the Step 2 logic goldens (tests/golden/logic, docs/testing.md "Golden
// format") for Vitest. Inputs are decoded to JS values; outputs stay encoded
// and are compared with encode(actual), so NaN, -0, undefined and thrown
// errors are compared exactly.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Same codec the harness wrote the goldens with.
import { capture, decode, encode } from '../../tests/reference-harness/golden.mjs';

export { decode, encode };

export interface GoldenCase {
  id: string;
  rule: string;
  input: unknown;
  output: unknown;
}

export interface Golden {
  suite: string;
  cases: GoldenCase[];
}

export function loadGolden(suite: string): Golden {
  const file = fileURLToPath(new URL(`../../tests/golden/logic/${suite}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8')) as Golden;
}

/** The case with this id; throws when missing so a renamed case fails loudly. */
export function goldenCase(golden: Golden, id: string): GoldenCase {
  const c = golden.cases.find((x) => x.id === id);
  if (!c) throw new Error(`${golden.suite}: no case ${id}`);
  return c;
}

/** Cases whose id matches the pattern. */
export function casesMatching(golden: Golden, pattern: RegExp): GoldenCase[] {
  return golden.cases.filter((c) => pattern.test(c.id));
}

/** Decoded input of a case. */
export function inputOf<T = Record<string, unknown>>(c: GoldenCase): T {
  return decode(c.input) as T;
}

/** Runs fn like the harness did (thrown errors become {$throws}) and encodes the result. */
export async function run(fn: () => unknown): Promise<unknown> {
  return encode(await capture(fn));
}
