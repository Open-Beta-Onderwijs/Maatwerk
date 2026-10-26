// SPDX-License-Identifier: AGPL-3.0-or-later
// Golden file format for logic suites (docs/testing.md, "Golden format").

import fs from 'node:fs';
import path from 'node:path';
import { REFERENCE_COMMIT, REPO_ROOT } from './reference.mjs';

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

/** Collects cases for one suite. */
export class Suite {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.refs = new Set();
    this.cases = [];
  }
  ref(...refs) {
    for (const r of refs.flat()) this.refs.add(r);
  }
  /** id: unique within the suite; rule: business-rules.md / quirks.md pointer. */
  add(id, rule, input, output) {
    if (this.cases.some((c) => c.id === id)) throw new Error(`${this.name}: duplicate case ${id}`);
    this.cases.push({ id, rule, input: encode(input), output: encode(output) });
  }
  toJSON() {
    return {
      format: FORMAT,
      suite: this.name,
      description: this.description,
      reference: { commit: REFERENCE_COMMIT, code: [...this.refs].sort() },
      cases: this.cases,
    };
  }
}

export const serialize = (suite) => `${JSON.stringify(suite.toJSON(), null, 2)}\n`;
export const goldenPath = (name) => path.join(LOGIC_DIR, `${name}.json`);
export const readGolden = (name) => JSON.parse(fs.readFileSync(goldenPath(name), 'utf8'));
