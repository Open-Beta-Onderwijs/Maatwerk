// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { Exam, Group, Observatie, ScoreRecord, Student } from '../../domain/types';
import { buildGroupModel, columnsOf, obsFits, obsRows } from './model';
import { heatPct } from './observaties';

const q = (id: string) => ({ id, max_points: 10, rtti: 'R' as const });
const exam = (fields: Partial<Exam>): Exam => ({
  id: 'x',
  subject: 'nat',
  jaarlaag: '3',
  n_term: 1,
  weging: 1,
  questions: [q('q1')],
  ...fields,
});

const group: Group = { id: 'g', name: '3a', jaarlaag: '3', student_ids: ['1', '2'] };
const students: Student[] = [
  { id: '1', voornaam: 'A' },
  { id: '2', voornaam: 'B' },
];

describe('columns', () => {
  it('takes originals of the jaarlaag with a volgnummer, by periode, resits attached', () => {
    const exams = [
      exam({ id: 'b', volgnummer: 302, periode: '2' }),
      exam({ id: 'a', volgnummer: 301, periode: '1' }),
      exam({ id: 'a-h', volgnummer: 301, parent_id: 'a', description: 'HERKANSING', attempt: 2 }),
      exam({ id: 'c', volgnummer: 401, jaarlaag: '4' }),
      exam({ id: 'd' }),
    ];
    const cols = columnsOf(group, exams);
    expect(cols.map((c) => c.original.id)).toEqual(['a', 'b']);
    expect(cols[0]!.attempts.map((e) => e.id)).toEqual(['a', 'a-h']);
  });
});

describe('cells', () => {
  it('holds the attempt that counts with its resit dot and the original grade', () => {
    const exams = [
      exam({ id: 'a', volgnummer: 301, obs_ids: ['o1'] }),
      exam({ id: 'a-h', volgnummer: 301, parent_id: 'a', description: 'HERKANSING', attempt: 2 }),
    ];
    const records = new Map<string, ScoreRecord>([
      ['1', { scores: { a: { q1: 3 }, 'a-h': { q1: 8 } }, observations: { 'a-h': ['o1'] } }],
      ['2', { scores: { a: { q1: 6 } } }],
    ]);
    const m = buildGroupModel({ group, students, yearExams: exams, records });
    const c = m.rows[0]!.cells[0]!;
    expect(c.grade).toBe(8.2);
    expect(c.resit?.title).toBe('Herkansing (poging 2)');
    expect(c.originalGrade).toBe(3.7);
    expect(c.obs).toEqual(['o1']);
    expect(m.rows[1]!.cells[0]!.resit).toBeNull();
    expect(m.showSe).toBe(false);
  });

  it('gives a student outside every projectgroep no PO grade', () => {
    const po = exam({
      id: 'p',
      volgnummer: 309,
      kind: 'po',
      questions: [],
      projectgroepen: [{ id: 'pg', naam: 'Valtoren', student_ids: ['1'] }],
    });
    const m = buildGroupModel({ group, students, yearExams: [po], records: new Map() });
    expect(m.rows[0]!.cells[0]!.projectgroep).toBe('Valtoren');
    expect(m.rows[0]!.cells[0]!.unplaced).toBe(false);
    expect(m.rows[1]!.cells[0]!.unplaced).toBe(true);
    expect(m.rows[1]!.cells[0]!.grade).toBeNull();
  });

  it('shows the SE column for an upper-school group or a PTA test', () => {
    const pta = exam({ id: 'a', volgnummer: 301, type: 'pta' });
    expect(buildGroupModel({ group, students, yearExams: [pta], records: new Map() }).showSe).toBe(
      true,
    );
    const upper = { ...group, jaarlaag: '4' };
    expect(
      buildGroupModel({ group: upper, students, yearExams: [], records: new Map() }).showSe,
    ).toBe(true);
  });
});

describe('observaties (decision 34)', () => {
  const obs = (id: string, naam: string, toetstypes?: string[]): Observatie => ({
    id,
    naam,
    toetstypes,
  });

  it('fits by toetstypes; absent means toets', () => {
    const [col] = columnsOf(group, [exam({ id: 'a', volgnummer: 301 })]);
    expect(obsFits(obs('o', 'x'), col!)).toBe(true);
    expect(obsFits(obs('o', 'x', ['po']), col!)).toBe(false);
  });

  it('counts students per column, alphabetically, empty where it does not fit', () => {
    const exams = [exam({ id: 'a', volgnummer: 301, obs_ids: ['o1', 'o2'] })];
    const records = new Map<string, ScoreRecord>([
      ['1', { scores: { a: { q1: 5 } }, observations: { a: ['o1', 'o2'] } }],
      ['2', { scores: { a: { q1: 5 } }, observations: { a: ['o1'] } }],
    ]);
    const m = buildGroupModel({ group, students, yearExams: exams, records });
    const rows = obsRows(m, [
      obs('o1', 'Rekenfout'),
      obs('o2', 'Eenheid'),
      obs('o3', 'PO', ['po']),
    ]);
    expect(rows.map((r) => r.obs.naam)).toEqual(['Eenheid', 'Rekenfout']);
    expect(rows.map((r) => r.counts)).toEqual([[1], [2]]);
    expect(rows[1]!.total).toBe(2);
  });

  it('tints by intensity, full at half the group', () => {
    expect(heatPct(0, 10)).toBe(0);
    expect(heatPct(5, 10)).toBe(84);
    expect(heatPct(9, 10)).toBe(84);
    expect(heatPct(1, 10)).toBeLessThan(heatPct(3, 10));
  });
});
