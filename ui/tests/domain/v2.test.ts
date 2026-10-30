// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { decode, encode, normalStudentId, opaqueId } from '../../src/domain/v2';
import { issueCounts, needsAttention } from '../../src/screens/gegevens';
import { migrationSummary } from '../../src/screens/migration';

const SCORES = '2025-2026/scores/nat/900001.json';
const STUDENTS = '2025-2026/students-2025-2026.json';

describe('v2 codec at the Store boundary (C8, C9)', () => {
  it('score files: "N" on disk is null in memory and back; invalid input stays', () => {
    const disk = {
      student_id: '900001',
      scores: { e: { q1: 2, q2: 'N', q3: 'abc' } },
      observations: { e: ['o'] },
      _meta: { hash: 'x' },
    };
    const mem = decode(SCORES, disk) as typeof disk;
    expect(mem.scores.e).toEqual({ q1: 2, q2: null, q3: 'abc' });
    expect(disk.scores.e.q2).toBe('N'); // the input is not changed
    expect(encode(SCORES, mem)).toEqual(disk);
  });

  it('score files: a numeric student_id becomes a string', () => {
    const mem = decode(SCORES, { student_id: 900001, scores: {} }) as { student_id: unknown };
    expect(mem.student_id).toBe('900001');
    expect(encode(SCORES, { student_id: 7, scores: { e: { q: null } } })).toEqual({
      student_id: '7',
      scores: { e: { q: 'N' } },
    });
  });

  it('students: the { students } wrapper is a plain array in memory, ids are strings', () => {
    const disk = { students: [{ id: '1', achternaam: 'A' }], _meta: { hash: 'x' } };
    expect(decode(STUDENTS, disk)).toEqual([{ id: '1', achternaam: 'A' }]);
    expect(decode(STUDENTS, { students: [{ id: 2 }] })).toEqual([{ id: '2' }]);
    expect(decode(STUDENTS, null)).toBeNull();
    expect(encode(STUDENTS, [{ id: 3, achternaam: 'B' }])).toEqual({
      students: [{ id: '3', achternaam: 'B' }],
    });
  });

  it('other files pass through unchanged', () => {
    const exam = { id: 'e', questions: [{ id: 'q1' }], x: null };
    expect(decode('2025-2026/exams/e.json', exam)).toBe(exam);
    expect(encode('2025-2026/exams/e.json', exam)).toBe(exam);
    expect(decode('2024-2025/students-2025-2026.json', [1])).toEqual([1]); // wrong year: not ours
  });
});

describe('student numbers typed or imported (C8)', () => {
  it('follow the v1 rule (Number), as strings', () => {
    expect(normalStudentId(' 0123 ')).toBe('123');
    expect(normalStudentId('1.5e2')).toBe('150');
    expect(normalStudentId(900001)).toBe('900001');
    for (const bad of ['', '0', 'abc', null, undefined]) expect(normalStudentId(bad)).toBe('');
  });
});

describe('opaque ids (C10)', () => {
  it('encode the time and six random characters', () => {
    expect(opaqueId('toets', 0)).toMatch(/^toets-0-[a-z0-9]{6}$/);
    expect(opaqueId('groep', 1_793_369_100_000)).toMatch(/^groep-mvv1nppc-[a-z0-9]{6}$/);
  });
});

describe('migration and data check texts', () => {
  it('summarises a migration in Dutch', () => {
    const lines = migrationSummary({
      fromVersion: 1,
      toVersion: 2,
      applied: true,
      backup: 'C:\\b\\maatwerk-backup-v1.zip',
      written: 10,
      moved: 2,
      deleted: 3,
      warnings: [],
      validation: {
        filesChecked: 10,
        issues: [{ severity: 'warning', kind: 'stray', path: 'x', message: 'm' }],
      },
    });
    expect(lines).toEqual([
      'Gegevensmap omgezet van versie 1 naar 2.',
      '10 bestanden bijgewerkt, 2 verplaatst, 3 verwijderd.',
      'Back-up: C:\\b\\maatwerk-backup-v1.zip',
      'Controle: geen fouten, 1 waarschuwing.',
    ]);
  });

  it('counts issues and decides when the admin is told', () => {
    const issue = (severity: string, kind: string) => ({ severity, kind, path: 'p', message: 'm' });
    expect(issueCounts([])).toBe('Geen fouten of waarschuwingen.');
    expect(issueCounts([issue('error', 'corrupt'), issue('warning', 'stray')])).toBe(
      '1 fout, 1 waarschuwing',
    );
    expect(needsAttention({ filesChecked: 1, issues: [issue('warning', 'stray')] })).toBe(false);
    expect(needsAttention({ filesChecked: 1, issues: [issue('warning', 'stamp')] })).toBe(true);
    expect(needsAttention({ filesChecked: 1, issues: [issue('error', 'reference')] })).toBe(true);
  });
});
