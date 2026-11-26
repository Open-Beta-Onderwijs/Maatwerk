// SPDX-License-Identifier: AGPL-3.0-or-later
// Golden file format for logic suites (docs/testing.md, "Golden format"). The goldens were
// captured from the reference app by a harness that went at 1.0 (PLAN-2 decision 88); they stay
// as regression tests (decision 9). This module only reads them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The reference commit every logic golden and reference Typst golden was captured at. */
export const REFERENCE_COMMIT = '0e30a70cbe4e9286bd54efa5722fb7532c1be308';
export const LOGIC_DIR = path.join(REPO_ROOT, 'tests', 'golden', 'logic');
export const FORMAT = 1;

/**
 * JSON cannot hold undefined, NaN, Infinity or -0, and the reference returns
 * all of them. They are written as tagged objects: {"$undefined": true},
 * {"$number": "NaN" | "Infinity" | "-Infinity" | "-0"}. Errors thrown by the
 * reference become {"$throws": "<message>"}.
 */
export function encode(v) {
  if (v === undefined) return { $undefined: true };
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { $number: 'NaN' };
    if (v === Infinity) return { $number: 'Infinity' };
    if (v === -Infinity) return { $number: '-Infinity' };
    if (Object.is(v, -0)) return { $number: '-0' };
    return v;
  }
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(encode);
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [encode(k), encode(x)]) };
  if (v instanceof Set) return { $set: [...v].map(encode) };
  const out = {};
  for (const k of Object.keys(v)) {
    if (typeof v[k] === 'function') continue;
    out[k] = encode(v[k]);
  }
  return out;
}

/** Inverse of encode() for the tagged values ($map/$set/$throws are left as they are). */
export function decode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === '$undefined') return undefined;
  if (keys.length === 1 && keys[0] === '$number')
    return Number(v.$number === '-0' ? '-0' : v.$number);
  const out = {};
  for (const k of keys) out[k] = decode(v[k]);
  return out;
}

/** Runs fn and returns its (awaited) result, or {$throws} when it throws. */
export async function capture(fn) {
  try {
    return await fn();
  } catch (e) {
    return { $throws: `${e?.constructor?.name ?? 'Error'}: ${e?.message ?? e}` };
  }
}

export const goldenPath = (name) => path.join(LOGIC_DIR, `${name}.json`);
export const readGolden = (name) => JSON.parse(fs.readFileSync(goldenPath(name), 'utf8'));
