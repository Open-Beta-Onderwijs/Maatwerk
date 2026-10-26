// SPDX-License-Identifier: AGPL-3.0-or-later
// Smoke tests for the harness itself. Skipped when `_reference/` is absent (CI).

import { setupEnvironment, freezeClock } from './environment.mjs';
setupEnvironment();
freezeClock();

import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFunction, bindFunctions } from './extract.mjs';
import { referenceAvailable } from './reference.mjs';
import { openReference } from './session.mjs';

const skip = referenceAvailable() ? false : '_reference/ not available';

test('reference Store loads every fixture and grades every score record', { skip }, async () => {
  for (const fixture of ['tiny', 'school']) {
    const s = await openReference({ fixture, subject: 'nat' });
    try {
      const year = '2025-2026';
      const exams = s.Store.getExamsSync(year);
      assert.ok(exams.length > 0, `${fixture}: exams loaded`);
      assert.ok(s.Store.getStudentsSync(year).length > 0, `${fixture}: students loaded`);
      let graded = 0;
      for (const st of s.Store.getStudentsSync(year)) {
        const rec = await s.Store.getStudentScores(st.id, year);
        for (const exam of exams) {
          if (s.Store.examResults(rec, exam)?.grade != null) graded++;
        }
      }
      assert.ok(graded > 0, `${fixture}: some grades computed`);
    } finally {
      s.dispose();
    }
  }
});

test('inner functions can be extracted and run', { skip }, () => {
  const { fns } = bindFunctions([
    extractFunction('renderer/screens/scores.js', 'normalizeScore'),
    extractFunction('renderer/screens/scores.js', 'parseScoreNum'),
    extractFunction('renderer/screens/scores.js', 'scoreCellText'),
  ]);
  assert.deepEqual(fns.normalizeScore(' n ', { max_points: 2 }), { cell: 'N', value: null });
});

test('clock is frozen', () => {
  assert.equal(new Date().toISOString(), new Date(Date.now()).toISOString());
  assert.equal(new Date().getFullYear(), 2026);
});

test(
  'directory order is pinned: reversed raw listings give identical goldens',
  { skip },
  async () => {
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const { goldenPath } = await import('./golden.mjs');
    const { fileURLToPath } = await import('node:url');
    const script = fileURLToPath(new URL('./run-suite.mjs', import.meta.url));
    for (const name of ['opdrachten', 'csv', 'averages']) {
      const out = execFileSync(process.execPath, [script, name], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, TZ: 'Europe/Amsterdam', MAATWERK_READDIR_REVERSE: '1' },
      });
      assert.equal(out, fs.readFileSync(goldenPath(name), 'utf8'), name);
    }
  },
);
