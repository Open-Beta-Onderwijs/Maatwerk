// SPDX-License-Identifier: AGPL-3.0-or-later

// Store.generation (Step 7c): kept screens render again only when it grows, so
// it must grow on every change to cached data and stay put on plain reads.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  YEAR,
  buildData,
  exam,
  readTree,
  student,
} from '../../../tests/reference-harness/scenario.mjs';
import { openStore, type LegacyStore } from '../store-session';

const E1 = 'nat-gen-1-2025-2026';

function scenario(): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'maatwerk-gen-'));
  try {
    buildData(root, {
      years: {
        [YEAR]: {
          students: [student(1), student(2)],
          exams: [exam(E1, [[2, 'R']])],
          scores: { nat: { 1: { scores: { [E1]: { q1: 1 } } } } },
        },
      },
    });
    return readTree(root) as Record<string, string>;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let Store: LegacyStore;
beforeEach(async () => {
  ({ Store } = await openStore({ files: scenario(), subject: 'nat' }));
});

describe('Store.generation', () => {
  it('stays put while files are only read', async () => {
    const g = Store.generation!();
    await Store.preloadScores!(YEAR);
    await Store.getStudentScores!('1', YEAR);
    await Store.loadUsers!();
    expect(Store.generation!()).toBe(g);
  });

  it('grows on an own write', async () => {
    await Store.preloadScores!(YEAR);
    const g = Store.generation!();
    await Store.setScore!('2', E1, 'q1', 2, YEAR);
    expect(Store.generation!()).toBeGreaterThan(g);
  });

  it('grows on a colleague change to data, not on presence', async () => {
    await Store.preloadScores!(YEAR);
    let g = Store.generation!();
    await Store.applyExternalChange!({ relPath: 'users/gebr-x.json', kind: 'modified' });
    expect(Store.generation!()).toBe(g);
    await Store.applyExternalChange!({
      relPath: `${YEAR}/scores/nat/1.json`,
      kind: 'modified',
    });
    expect(Store.generation!()).toBeGreaterThan(g);
    g = Store.generation!();
    await Store.applyExternalChange!({ relPath: `${YEAR}/exams/${E1}.json`, kind: 'modified' });
    expect(Store.generation!()).toBeGreaterThan(g);
  });

  it('grows when a cached entry is dropped', async () => {
    const g = Store.generation!();
    Store.invalidateSchool!();
    expect(Store.generation!()).toBeGreaterThan(g);
  });
});
