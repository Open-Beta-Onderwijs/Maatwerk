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
import type { MockApi } from '../../src/bridge/mock/mock-api';
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
let api: MockApi;
beforeEach(async () => {
  ({ Store, api } = await openStore({ files: scenario(), subject: 'nat' }));
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
    await Store.applyExternalChange!({ relPath: 'aanwezigheid/gebr-x.json', kind: 'modified' });
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

describe('Store.examResults (memoised)', () => {
  it('reuses a result until the record or the exam is replaced', async () => {
    const exam = (Store.getExamsSync!(YEAR) as { id: string }[]).find((e) => e.id === E1)!;
    const rec = await Store.getStudentScores!('1', YEAR);
    const first = Store.examResults!(rec, exam);
    expect(first?.grade).not.toBeNull();
    expect(Store.examResults!(rec, exam)).toBe(first);
    // A copy with another n-term (as the score modal makes) is computed anew.
    expect(Store.examResults!(rec, { ...exam, n_term: 3 })).not.toEqual(first);
    // A saved score replaces the cached record: a new result.
    await Store.setScore!('1', E1, 'q1', 2, YEAR);
    const next = Store.examResults!(await Store.getStudentScores!('1', YEAR), exam);
    expect(next).not.toBe(first);
    expect(next?.scored).toBe(2);
  });
});

describe('Store.preloadScores (one folder read)', () => {
  const reads = () => api.calls.filter(([m]) => m === 'readJson' || m === 'readJsonDir');

  it('reads the folder once; later score reads need no call', async () => {
    api.calls.length = 0;
    await Promise.all([Store.preloadScores!(YEAR), Store.getStudentScores!('1', YEAR)]);
    expect(reads()).toEqual([['readJsonDir', `${YEAR}/scores/nat`]]);
    // Student 2 has no file: known after the folder read, no single read.
    expect((await Store.getStudentScores!('2', YEAR)).scores).toEqual({});
    expect((await Store.getStudentScores!('1', YEAR)).scores[E1]).toEqual({ q1: 1 });
    expect(reads()).toHaveLength(1);
  });

  it('keeps a cached record that is newer than the folder read', async () => {
    await Store.setScore!('1', E1, 'q1', 2, YEAR);
    const rel = `${YEAR}/scores/nat/1.json`;
    // The folder still holds the old file (a read that started before the write).
    const old = api.peek(rel)!.replace('"q1": 2', '"q1": 1');
    expect(old).not.toBe(api.peek(rel));
    const original = api.readJsonDir.bind(api);
    api.readJsonDir = async (dir: string) =>
      (await original(dir)).map((f) => (f.name === '1.json' ? { ...f, data: JSON.parse(old) } : f));
    await Store.preloadScores!(YEAR);
    expect((await Store.getStudentScores!('1', YEAR)).scores[E1]).toEqual({ q1: 2 });
  });
});

describe('review 7c', () => {
  it('M2: a colleague change to a file that is not cached leaves generation alone', async () => {
    const g = Store.generation!();
    // Another vak's score file: never read here.
    await Store.applyExternalChange!({ relPath: `${YEAR}/scores/bio/1.json`, kind: 'modified' });
    await Store.applyExternalChange!({ relPath: `${YEAR}/exams/bio-x.json`, kind: 'added' });
    expect(Store.generation!()).toBe(g);
  });

  it('M3: a second preload with everything cached makes no call', async () => {
    await Store.preloadScores!(YEAR);
    api.calls.length = 0;
    await Store.preloadScores!(YEAR);
    expect(api.calls.filter(([m]) => m === 'readJsonDir')).toEqual([]);
  });

  it('n6: no folder read without a vak (admin)', async () => {
    api.calls.length = 0;
    await Store.preloadScores!(YEAR, null);
    expect(api.calls.filter(([m]) => m === 'readJsonDir')).toEqual([]);
  });
});
