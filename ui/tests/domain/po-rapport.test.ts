// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPoRapportData } from '../../src/domain/po-rapport';
import { normaliseForTypst } from '../../src/domain/rapport';
import type { ScoreRecord } from '../../src/domain/types';
import { EXAM_ID, fixtureInput, RECORDS } from './po-rapport.fixture';

/** The Typst golden of the PO rapport: its data is this builder's output for the fixture. */
const CASE_DIR = fileURLToPath(new URL('../../../tests/golden/typst/rapport-po/', import.meta.url));
/** The students on the golden: the projectgroep of three (with lines) and the one of one. */
const GOLDEN_STUDENTS = ['Sem Dijkstra', 'Fleur de Wit'];

describe('buildPoRapportData', () => {
  const data = buildPoRapportData(fixtureInput());
  const sem = data.students.find((s) => s.name === 'Sem Dijkstra')!;
  const fleur = data.students.find((s) => s.name === 'Fleur de Wit')!;

  it('has a rapport for every graded student in a projectgroep, by class then achternaam', () => {
    expect(data.students.map((s) => `${s.klas} ${s.name}`)).toEqual([
      '5A Sem Dijkstra',
      '5A Emma Kok',
      '5B Bas Vos',
      '5B Fleur de Wit',
    ]);
    expect(data.skipped).toEqual({ unplaced: ['Lotte Bakker'], ungraded: ['Daan Jansen'] });
  });

  it('takes points, grades and lines from the core (decisions 16, 17, 28)', () => {
    // 25 normal + 2 bonus of 36; 10 × 27 ÷ 36 = 7,5; −0,5 group, +0,3 own.
    expect(sem).toMatchObject({
      points: 27,
      max: 36,
      pct: 75,
      rubric_grade: '7,5',
      grade: '7,3',
      grade_overridden: false,
      grade_only: false,
      group_size: 3,
    });
    expect(sem.lines).toEqual([
      {
        voor: 'Projectgroep',
        label: 'Verslag een dag te laat ingeleverd',
        value: -0.5,
        text: '−0,5',
      },
      {
        voor: 'Persoonlijk',
        label: 'Extra meting met de lichtsluis gedaan',
        value: 0.3,
        text: '+0,3',
      },
    ]);
    expect(data.students.find((s) => s.name === 'Bas Vos')!.grade).toBe('6,5');
    expect(fleur).toMatchObject({ points: 32, max: 36, grade: '8,9', group_size: 1, lines: [] });
  });

  it('lists the projectgroep with the student first, then by achternaam', () => {
    expect(sem.projectgroep).toEqual({
      naam: 'Valtoren',
      members: [
        { name: 'Sem Dijkstra', klas: '5A' },
        { name: 'Emma Kok', klas: '5A' },
        { name: 'Bas Vos', klas: '5B' },
      ],
    });
    expect(fleur.projectgroep.naam).toBe('Projectgroep 2');
  });

  it('averages each category over the graded students (class_questions)', () => {
    const intro = sem.categories[0]!;
    // 2, 2, 2 and 3 of 3: 2,25 -> 2,3 (one decimal), 75%.
    expect(intro).toMatchObject({ name: 'Introductie', soort: 'normaal', max: 3, score: 2 });
    expect([intro.avg, intro.avg_pct]).toEqual([2.3, 75]);
    // An unscored category is left out of its average: only the Valtoren members scored it.
    const bonus = fleur.categories.find((c) => c.soort === 'bonus')!;
    expect([bonus.score, bonus.avg, bonus.avg_pct]).toEqual([null, 2, 50]);
    // (27 × 3 + 32) ÷ 4 = 28,25 of 36.
    expect(sem.total).toEqual({ avg: 28.3, avg_pct: 78 });
    expect(data.poInfo).toEqual({
      name: 'PO Onderzoek valbeweging',
      subject_display: 'Natuurkunde',
      scale_max: 8,
    });
  });

  it('carries levels, comments and observaties per category, the advice guarded', () => {
    const theorie = sem.categories.find((c) => c.name === 'Theorie')!;
    expect(theorie.levels).toHaveLength(4);
    expect(theorie.levels[3]).toEqual({
      min: 6,
      max: 8,
      title: 'Uitstekend',
      text: 'De theorie wordt verbonden met de resultaten.',
    });
    expect(theorie.comment).toMatch(/afleiding van g/);
    expect(theorie.observaties.map((o) => o.naam)).toEqual(['Formule verkeerd omgeschreven']);
    const discussie = sem.categories.find((c) => c.name === 'Discussie')!;
    expect([discussie.comment, discussie.observaties]).toEqual(['', []]);
    expect(sem.observaties.map((o) => o.icon)).toEqual(['📏']);
    expect(fleur.observaties).toEqual([]);
    expect(fleur.comment).toBe('');
  });

  it('counts an invalid category score as 0 and keeps an overwritten grade without scores', () => {
    const input = fixtureInput();
    const records = new Map(input.records);
    const bad = structuredClone(RECORDS['900102']!) as ScoreRecord;
    (bad.scores![EXAM_ID] as Record<string, unknown>).intro = 2.5;
    records.set('900102', bad);
    records.set('900105', { overrides: { [EXAM_ID]: { cijfer: 6 } } } as ScoreRecord);
    const out = buildPoRapportData({ ...input, records });
    const emma = out.students.find((s) => s.name === 'Emma Kok')!;
    expect(emma.categories[0]!.score).toBe(0);
    const daan = out.students.find((s) => s.name === 'Daan Jansen')!;
    expect(daan).toMatchObject({ grade: '6,0', grade_overridden: true, grade_only: true });
    expect(out.skipped.ungraded).toEqual([]);
  });

  it('is the data of the rapport-po Typst golden', () => {
    const students = GOLDEN_STUDENTS.map((n) => data.students.find((s) => s.name === n));
    const args = normaliseForTypst(['rapport-po', students, data.poInfo]);
    if (process.env.MAATWERK_WRITE_PO_CASE) {
      mkdirSync(CASE_DIR, { recursive: true });
      const old = existsSync(`${CASE_DIR}case.json`)
        ? JSON.parse(readFileSync(`${CASE_DIR}case.json`, 'utf8'))
        : {};
      const kase = {
        format: 1,
        id: 'rapport-po',
        path: 'A',
        rule: 'Step 24: PO rapport (ui/tests/domain/po-rapport.fixture.ts), a projectgroep of three with group and own lines and one of one',
        reference: { typst: '0.14.2', ppi: 50 },
        call: { channel: 'renderPoRapportPdf', args },
        result: { success: true },
        ...(old.port ? { port: old.port, pdf: old.pdf, png: old.png } : {}),
      };
      writeFileSync(`${CASE_DIR}case.json`, `${JSON.stringify(kase, null, 2)}\n`);
    }
    const kase = JSON.parse(readFileSync(`${CASE_DIR}case.json`, 'utf8'));
    expect(kase.call.args).toEqual(args);
  });
});
