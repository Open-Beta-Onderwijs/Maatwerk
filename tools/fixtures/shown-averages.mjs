// SPDX-License-Identifier: AGPL-3.0-or-later
// Test set for "Shown averages" (Cijfergemiddelden, step 38, decisions 91-93; spec in
// docs/phase-2/step-19-grade-rules.md section 3). Writes
// crates/maatwerk-grades/tests/data/shown_averages.json.
//
// The expected values use exact integer arithmetic, never floating point: a grade is an integer
// number of tenths (10..100), a weight an integer number of tenths (0..50), so a weighted average
// is exactly N / R with N = sum(gradeTenths * weightTenths) and R = 10 * sum(weightTenths).
// Rounded to d decimals: afkappen = floor(N * 10^d / R), afronden (half-up) =
// floor((2 * N * 10^d + R) / (2 * R)).
//
// Every case also records which formats a naive float implementation gets wrong ("trap"):
// avg = sum(w * g) / sum(w) in doubles, in the crate's summing order, then Math.round or
// Math.floor of avg * 10^d. And the generator asserts that the planned implementation (snap to
// billionths first, as `round_to` in crates/maatwerk-grades/src/round.rs, then integers) matches
// the exact value on every case.
//
// Usage: node tools/fixtures/shown-averages.mjs [--check]. Deterministic (fixed seed).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../crates/maatwerk-grades/tests/data/shown_averages.json',
);

/** The six formats: a = afronden, k = afkappen; the digit is the number of decimals. */
const FORMATS = ['a0', 'a1', 'a2', 'k0', 'k1', 'k2'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

/** Integer k as a decimal string with d decimals: (550, 2) -> "5.50". */
function fixed(k, d) {
  if (d === 0) return String(k);
  const s = String(k).padStart(d + 1, '0');
  return `${s.slice(0, -d)}.${s.slice(-d)}`;
}

/** Exact shown value as an integer of 10^-d units. */
function exactUnits(N, R, method, d) {
  const q = N * 10 ** d;
  return method === 'a' ? Math.floor((2 * q + R) / (2 * R)) : Math.floor(q / R);
}

/** The weighted average in doubles, summed in the crate's order (`averages.rs` `weighted`). */
function floatAverage(gT, wT) {
  let total = 0;
  let weights = 0;
  for (let i = 0; i < gT.length; i++) {
    const g = gT[i] / 10;
    const w = wT[i] / 10;
    if (w === 0) continue;
    total += w * g;
    weights += w;
  }
  return weights > 0 ? total / weights : null;
}

/** The naive float formatting: what a careless implementation does. */
function naiveUnits(avg, method, d) {
  const x = avg * 10 ** d;
  return method === 'a' ? Math.round(x) : Math.floor(x);
}

/** The planned implementation: snap to billionths (as `round_to`), then integer arithmetic. */
function nanoUnits(avg, method, d) {
  const n = Math.round(avg * 1e9);
  const unit = 1e9 / 10 ** d;
  return method === 'a' ? Math.floor((n + unit / 2) / unit) : Math.floor(n / unit);
}

let nanoMismatches = 0;

/** One case: grades and weights in tenths -> the JSON object. */
function makeCase(gT, wT, name) {
  const g = gT.map((x) => x / 10);
  const w = wT.map((x) => x / 10);
  const N = gT.reduce((s, x, i) => s + x * wT[i], 0);
  const W = wT.reduce((s, x) => s + x, 0);
  const c = name ? { name, g, w } : { g, w };
  if (W === 0) {
    c.exact = null;
    for (const f of FORMATS) c[f] = null;
    return c;
  }
  const R = 10 * W;
  const k = gcd(N, R);
  c.exact = `${N / k}/${R / k}`;
  const avg = floatAverage(gT, wT);
  const trap = [];
  for (const f of FORMATS) {
    const method = f[0];
    const d = Number(f[1]);
    const units = exactUnits(N, R, method, d);
    c[f] = fixed(units, d);
    if (naiveUnits(avg, method, d) !== units) trap.push(f);
    if (nanoUnits(avg, method, d) !== units) nanoMismatches++;
  }
  if (trap.length) c.trap = trap;
  return c;
}

const t = (x) => Math.round(x * 10); // a grade or weight written as a decimal -> tenths

/** Hand-picked edge cases: [name, grades, weights]. */
const EDGE = [
  ['5,3 + 5,7 = exactly 5,5', [5.3, 5.7], [1, 1]],
  ['5,4 + 5,5 + 5,6 = exactly 5,5', [5.4, 5.5, 5.6], [1, 1, 1]],
  ['5,45 from 5,4 + 5,5', [5.4, 5.5], [1, 1]],
  ['5,55 from 5,5 + 5,6', [5.5, 5.6], [1, 1]],
  ['8,65 from 8,6 + 8,7 (doubles give 8,6499...)', [8.6, 8.7], [1, 1]],
  ['1,05 from 1,0 + 1,1', [1.0, 1.1], [1, 1]],
  ['9,95 from 9,9 + 10,0: afronden 1 gives 10,0', [9.9, 10.0], [1, 1]],
  ['one third: 7,0 7,0 8,0 = 7,333...', [7.0, 7.0, 8.0], [1, 1, 1]],
  ['two thirds: 6,0 7,0 7,0 = 6,666...', [6.0, 7.0, 7.0], [1, 1, 1]],
  ['three decimals 5,125: 5,1 (w3) + 5,2 (w1)', [5.1, 5.2], [3, 1]],
  ['three decimals 6,375: 6,3 (w1) + 6,4 (w3)', [6.3, 6.4], [1, 3]],
  ['three decimals 5,625: 5,6 (w3) + 5,7 (w1)', [5.6, 5.7], [3, 1]],
  ['three decimals 5,875: 5,8 (w1) + 5,9 (w3)', [5.8, 5.9], [1, 3]],
  [
    'just under a half: 5,5 x9 + 5,4 = 5,49',
    [5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.4],
    Array(10).fill(1),
  ],
  [
    'just over a half: 5,5 x9 + 5,6 = 5,51',
    [5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.6],
    Array(10).fill(1),
  ],
  ['5,498 from 5,5 (w4,9) + 5,4 (w0,1)', [5.5, 5.4], [4.9, 0.1]],
  ['one grade 5,5', [5.5], [1]],
  ['one grade 5,4', [5.4], [1]],
  ['one grade 10,0', [10.0], [1]],
  ['one grade 1,0', [1.0], [1]],
  ['all grades 1,0', [1.0, 1.0, 1.0], [1, 2, 3]],
  ['all grades 10,0', [10.0, 10.0, 10.0], [1, 2, 3]],
  ['weight 0 falls out: 3,0 (w0) + 6,0 (w1)', [3.0, 6.0], [0, 1]],
  ['all weights 0: no average', [6.0, 7.0], [0, 0]],
  ['6,0 (w1) + 7,0 (w3) = 6,75 (spec)', [6.0, 7.0], [1, 3]],
  ['6,0 (w1) + 8,0 (w2) + 3,0 (w0) = 7,333 (spec)', [6.0, 8.0, 3.0], [1, 2, 0]],
  ['half weights: 6,0 (w0,5) + 7,0 (w1,5) = 6,75', [6.0, 7.0], [0.5, 1.5]],
  ['tenth weights: 4,0 (w0,1) + 7,0 (w0,2) = exactly 6,0', [4.0, 7.0], [0.1, 0.2]],
  ['tenth weights: 5,0 (w0,1) + 6,0 (w0,2) = 5,666...', [5.0, 6.0], [0.1, 0.2]],
  ['tenth weights: 5,1 (w0,3) + 5,9 (w0,3) = exactly 5,5', [5.1, 5.9], [0.3, 0.3]],
  ['tenth weights: 5,2 (w0,7) + 5,9 (w0,1)... = 5,2875', [5.2, 5.9], [0.7, 0.1]],
  ['5,9: afkappen 0 gives 5 (a fail)', [5.9], [1]],
  ['6,95 from 6,9 + 7,0', [6.9, 7.0], [1, 1]],
  ['4,45 from 4,4 + 4,5', [4.4, 4.5], [1, 1]],
  [
    'eight grades, mixed weights = exactly 5,5',
    [4.0, 7.0, 5.0, 6.0, 5.5, 5.5, 3.0, 8.0],
    [1, 1, 2, 2, 3, 1, 1, 1],
  ],
].map(([name, g, w]) => makeCase(g.map(t), w.map(t), name));

/** Every unordered pair of grades with weight 1: every x,x5 there is. */
const PAIRS = [];
for (let a = 10; a <= 100; a++)
  for (let b = a; b <= 100; b++) PAIRS.push(makeCase([a, b], [10, 10]));

/** Random weighted averages: 2-8 grades, realistic weights plus some tenths. */
const rand = mulberry32(20261123);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const WEIGHT_POOL = [0, 5, 10, 10, 10, 10, 15, 20, 20, 25, 30, 40, 50, 1, 2, 3, 7];
const RANDOM = [];
for (let i = 0; i < 3000; i++) {
  const n = 2 + Math.floor(rand() * 7);
  const gT = Array.from({ length: n }, () => 10 + Math.floor(rand() * 91));
  const wT = Array.from({ length: n }, () => pick(WEIGHT_POOL));
  RANDOM.push(makeCase(gT, wT));
}

/**
 * Groups (decision 92): each student's shown value under the format, then the mean of the shown
 * values at afronden 1 and % onvoldoende (shown below 5,5) at afronden 0. Students without an
 * average are left out.
 */
const GROUPS = [];
for (let i = 0; i < 200; i++) {
  const size = 5 + Math.floor(rand() * 26);
  const students = [];
  for (let s = 0; s < size; s++) {
    const n = 1 + Math.floor(rand() * 4);
    // Grades around the pass mark, so % onvoldoende moves with the format.
    const gT = Array.from({ length: n }, () => 40 + Math.floor(rand() * 41));
    const wT = Array.from({ length: n }, () => pick([10, 10, 10, 20, 30, 5]));
    students.push({ gT, wT });
  }
  const group = {
    students: students.map(({ gT, wT }) => ({
      g: gT.map((x) => x / 10),
      w: wT.map((x) => x / 10),
    })),
  };
  for (const f of FORMATS) {
    const method = f[0];
    const d = Number(f[1]);
    const shown = students.map(({ gT, wT }) => {
      const N = gT.reduce((s, x, j) => s + x * wT[j], 0);
      const R = 10 * wT.reduce((s, x) => s + x, 0);
      return exactUnits(N, R, method, d); // in 10^-d units
    });
    const n = shown.length;
    const sum = shown.reduce((s, x) => s + x, 0);
    // mean = sum / (n * 10^d); afronden 1: floor((2 * sum * 10 + n * 10^d) / (2 * n * 10^d)).
    const scale = 10 ** d;
    const mean = Math.floor((2 * sum * 10 + n * scale) / (2 * n * scale));
    const fails = shown.filter((x) => x * 10 < 55 * scale).length;
    const pct = Math.floor((2 * 100 * fails + n) / (2 * n));
    group[f] = { shown: shown.map((x) => fixed(x, d)), mean: fixed(mean, 1), onvoldoende: pct };
  }
  GROUPS.push(group);
}

if (nanoMismatches)
  throw new Error(`the billionths method differs from exact on ${nanoMismatches} values`);

function render() {
  const all = [...EDGE, ...PAIRS, ...RANDOM];
  const traps = Object.fromEntries(
    FORMATS.map((f) => [f, all.filter((c) => c.trap?.includes(f)).length]),
  );
  const lines = (xs) => xs.map((x) => `    ${JSON.stringify(x)}`).join(',\n');
  const header = {
    about:
      'Shown averages (step 38, decisions 91-93, docs/phase-2/step-19-grade-rules.md). Generated by ' +
      'tools/fixtures/shown-averages.mjs with exact integer arithmetic; do not edit. Formats: a = afronden ' +
      '(half-up), k = afkappen (towards zero), digit = decimals. Values use a decimal point; the UI shows a ' +
      'comma. "exact" is the reduced fraction; null = no average (all weights 0). "trap" lists the formats a ' +
      'naive double implementation (Math.round/floor of avg * 10^d) gets wrong. Groups: shown values per ' +
      'student, their mean at afronden 1 and % onvoldoende (shown < 5.5) at afronden 0.',
    formats: FORMATS,
    counts: {
      edge: EDGE.length,
      pairs: PAIRS.length,
      random: RANDOM.length,
      groups: GROUPS.length,
    },
    naiveTraps: traps,
  };
  const head = JSON.stringify(header, null, 2).slice(0, -2);
  return `${head},\n  "edge": [\n${lines(EDGE)}\n  ],\n  "pairs": [\n${lines(PAIRS)}\n  ],\n  "random": [\n${lines(RANDOM)}\n  ],\n  "groups": [\n${lines(GROUPS)}\n  ]\n}\n`;
}

export function shownAverages({ check = false } = {}) {
  const text = render();
  if (check) return fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const ok = shownAverages({ check });
  if (check && !ok) {
    console.error('shown_averages.json is out of date: run node tools/fixtures/shown-averages.mjs');
    process.exit(1);
  }
}
