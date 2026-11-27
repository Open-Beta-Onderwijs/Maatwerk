// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { lockGuard, type LockFiles } from './mock-locks';

// The cases of maatwerk-core `locks::tests` (students, groups, exams, observaties).
const Y = '2025-2026';

function files(map: Record<string, unknown>): LockFiles {
  return {
    json: (rel) => (rel in map ? map[rel] : null),
    dir: (d) =>
      Object.entries(map)
        .filter(([rel]) => rel.startsWith(`${d}/`) && !rel.slice(d.length + 1).includes('/'))
        .map(([rel, data]) => ({ name: rel.slice(d.length + 1), data })),
    years: () => [Y],
    opdrachten: () =>
      Object.entries(map)
        .filter(([rel]) => /^opdrachten\/[^/]+\/opdracht\.json$/.test(rel))
        .map(([, v]) => v),
  };
}

const scored = { scores: { e1: { q1: 'N' } } };

describe('lockGuard: students and groups (2.1, 2.2)', () => {
  const studentsRel = `${Y}/students-${Y}.json`;
  const two = { students: [{ id: '1' }, { id: '2' }] };
  it('refuses removing a student with data or in a group', () => {
    const f = files({
      [studentsRel]: two,
      [`${Y}/scores/nat/1.json`]: scored,
      [`${Y}/groups/g.json`]: { student_ids: ['2'] },
    });
    expect(lockGuard(f, studentsRel, { students: [{ id: '2' }] })).toMatch(/Leerling 1 .*scores/);
    expect(lockGuard(f, studentsRel, { students: [{ id: '1' }] })).toMatch(/Leerling 2 .*groep/);
    expect(lockGuard(f, studentsRel, two)).toBeNull();
  });

  it('a group with students keeps name, jaarlaag, schoolsoort, vak and is not deleted', () => {
    const rel = `${Y}/groups/g.json`;
    const g = {
      name: '3a',
      jaarlaag: '3',
      schoolsoort: ['Havo'],
      subject: 'nat',
      student_ids: ['1'],
    };
    const f = files({ [rel]: g });
    expect(lockGuard(f, rel, { ...g, jaarlaag: 3 })).toBeNull(); // "3" and 3 are the same
    expect(lockGuard(f, rel, { ...g, docenten: ['x'] })).toBeNull();
    expect(lockGuard(f, rel, { ...g, name: '3b' })).toMatch(/naam ligt vast/);
    // Emptied in the same write (the CSV import, D34): free.
    expect(lockGuard(f, rel, { ...g, name: '3b', student_ids: [] })).toBeNull();
    expect(lockGuard(f, rel, null)).toMatch(/1 leerling\(en\)/);
    expect(lockGuard(files({ [rel]: { ...g, student_ids: [] } }), rel, null)).toBeNull();
  });
});

describe('lockGuard: exams (2.3, 2.4)', () => {
  const rel = `${Y}/exams/e1.json`;
  const exam = { id: 'e1', subject: 'nat', questions: [{ id: 'q1' }, { id: 'q2' }] };
  it('an exam with data or attempts is not deleted; its questions stay', () => {
    const f = files({ [rel]: exam, [`${Y}/scores/nat/1.json`]: scored });
    expect(lockGuard(f, rel, null)).toMatch(/scores ingevoerd/);
    expect(lockGuard(f, rel, { ...exam, questions: [{ id: 'q1' }] })).toMatch(/vraag/);
    expect(lockGuard(f, rel, { ...exam, title: 'x' })).toBeNull();
    const withResit = files({
      [rel]: exam,
      [`${Y}/exams/e1h.json`]: { id: 'e1h', parent_id: 'e1' },
    });
    expect(lockGuard(withResit, rel, null)).toMatch(/herkansingen/);
    expect(lockGuard(files({ [rel]: exam }), rel, null)).toBeNull();
  });

  it("a PO's scope stays once its family has data (decision 8)", () => {
    const po = { id: 'e1', kind: 'po', subject: 'nat', jaarlaag: '3', rubric_id: 'r1' };
    const f = files({
      [rel]: po,
      [`${Y}/exams/e1h.json`]: { id: 'e1h', parent_id: 'e1' },
      [`${Y}/scores/nat/1.json`]: { po: { e1h: { groupLines: [1] } } },
    });
    expect(lockGuard(f, rel, { ...po, jaarlaag: '4' })).toMatch(/jaarlaag ligt vast/);
    expect(lockGuard(f, rel, { ...po, title: 'PO' })).toBeNull();
    expect(lockGuard(files({ [rel]: po }), rel, { ...po, jaarlaag: '4' })).toBeNull();
  });
});

describe('lockGuard: observaties (2.6, decisions 12, 13)', () => {
  const rel = 'observaties/o1.json';
  const obs = {
    id: 'o1',
    jaarlagen: ['3', '4'],
    schoolsoort: ['Havo', 'Vwo'],
    subjects: ['nat', 'wisa', 'wisb'],
  };
  const test = {
    id: 'e1',
    title: 'Toets 1',
    jaarlaag: '3',
    schoolsoort: ['Havo'],
    subject: 'nat',
    obs_ids: ['o1'],
  };
  it('a linked observatie is not deleted; the reason names the links', () => {
    expect(lockGuard(files({ [rel]: obs }), rel, null)).toBeNull();
    const f = files({
      [rel]: obs,
      'opdrachten/op/opdracht.json': { naam: 'Breuken', observaties: ['o1'] },
    });
    expect(lockGuard(f, rel, null)).toMatch(/opdracht Breuken/);
    expect(lockGuard(files({ [rel]: obs, [`${Y}/exams/e1.json`]: test }), rel, null)).toMatch(
      /toets Toets 1 \(2025-2026\)/,
    );
  });

  it('what a linked test uses stays; the rest is free', () => {
    const f = files({
      [rel]: obs,
      [`${Y}/exams/e1.json`]: test,
      [`${Y}/exams/e2.json`]: { ...test, id: 'e2', subject: 'wi' },
    });
    expect(lockGuard(f, rel, { ...obs, jaarlagen: ['4'] })).toMatch(/jaarlaag 3/);
    expect(lockGuard(f, rel, { ...obs, schoolsoort: ['Vwo'] })).toMatch(/Havo/);
    expect(lockGuard(f, rel, { ...obs, subjects: ['wisa', 'wisb'] })).toMatch(/vak nat/);
    expect(lockGuard(f, rel, { ...obs, subjects: ['nat', 'wisa'] })).toBeNull();
    expect(lockGuard(f, rel, { ...obs, subjects: ['nat'] })).toMatch(/vak wiskunde/);
    expect(lockGuard(f, rel, { ...obs, jaarlagen: ['3'], schoolsoort: [] })).toBeNull();
  });
});
