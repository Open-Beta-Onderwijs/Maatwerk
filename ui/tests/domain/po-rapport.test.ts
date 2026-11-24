// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPoRapportData, skippedNoticeHtml } from '../../src/domain/po-rapport';
import { normaliseForTypst } from '../../src/domain/rapport';
import type { Exam, ScoreRecord } from '../../src/domain/types';
import { EXAM, EXAM_ID, fixtureInput, RECORDS } from './po-rapport.fixture';

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
    expect(data.skipped).toEqual({
      unplaced: ['Lotte Bakker'],
      ungraded: ['Daan Jansen'],
      otherGroup: [],
      partial: [],
    });
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

  it('averages each category over the graded students (class_questions, m5 rule B)', () => {
    const intro = sem.categories[0]!;
    // 2, 2, 2 and 3 of 3: 2,25 -> 2,3 (one decimal), 75%.
    expect(intro).toMatchObject({ name: 'Introductie', soort: 'normaal', max: 3, score: 2 });
    expect([intro.avg, intro.avg_pct]).toEqual([2.3, 75]);
    // An empty normal or bonus category counts as 0, as in the grade, so the averages add up to
    // the average points (review 24 m5, user 2026-11-22: rule B): 2, 2, 2 and 0 of 4.
    const bonus = fleur.categories.find((c) => c.soort === 'bonus')!;
    expect([bonus.score, bonus.avg, bonus.avg_pct]).toEqual([null, 1.5, 38]);
    const counted = sem.categories.filter((c) => c.soort !== 'diagnostisch');
    const sum = counted.reduce((t, c) => t + c.avg, 0);
    const meanPoints = data.students.reduce((t, s) => t + s.points, 0) / data.students.length;
    expect(Math.abs(sum - meanPoints)).toBeLessThan(0.05 * counted.length);
    // A diagnostic category is not in the grade: averaged over who has a score (2, 2, 2 of 3).
    const diag = fleur.categories.find((c) => c.soort === 'diagnostisch')!;
    expect([diag.score, diag.avg, diag.avg_pct]).toEqual([null, 2, 67]);
    // No Totaal row (user, 2026-11-12).
    expect(sem).not.toHaveProperty('total');
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

  it('reads category scores with the core rules: "2" counts, null and N are 0 (review 24 m1)', () => {
    const input = fixtureInput();
    const records = new Map(input.records);
    const rec = structuredClone(RECORDS['900102']!) as ScoreRecord;
    Object.assign(rec.scores![EXAM_ID] as Record<string, unknown>, {
      intro: '2',
      vraag: null,
      theorie: 'N',
    });
    records.set('900102', rec);
    const emma = buildPoRapportData({ ...input, records }).students.find(
      (s) => s.name === 'Emma Kok',
    )!;
    expect(emma.categories.slice(0, 3).map((c) => c.score)).toEqual([2, 0, 0]);
    // 2 + 0 + 0 + 5 + 4 + 3 + 2 normal, 2 bonus: the same points as the grade.
    expect(emma.points).toBe(18);
  });

  it('a category max the core does not accept counts as 0 (review 24 m1)', () => {
    const input = fixtureInput();
    const rubric = structuredClone(input.rubric!);
    rubric.categories[0]!.max = 150;
    const sem = buildPoRapportData({ ...input, rubric }).students[0]!;
    expect(sem.categories[0]!.max).toBe(0);
    expect(sem.max).toBe(33);
  });

  it('an overwritten grade shows no bonus/malus lines, which did not count (review 24 m2)', () => {
    const input = fixtureInput();
    const records = new Map(input.records);
    const rec = structuredClone(RECORDS['900101']!) as ScoreRecord;
    rec.overrides = { [EXAM_ID]: { cijfer: 6 } };
    records.set('900101', rec);
    const sem = buildPoRapportData({ ...input, records }).students[0]!;
    expect(sem).toMatchObject({ grade: '6,0', grade_overridden: true, lines: [] });
  });

  it('no rapport for a member graded in another projectgroep (review 24 m4)', () => {
    const input = fixtureInput();
    const records = new Map(input.records);
    // Bas is in Valtoren but his file holds Lichtsluis's grading (moved by hand or an older app).
    const bas = structuredClone(RECORDS['900103']!) as ScoreRecord;
    (bas.po![EXAM_ID] as { projectgroep: string }).projectgroep = 'pg-3';
    records.set('900103', bas);
    const out = buildPoRapportData({ ...input, records });
    expect(out.students.map((s) => s.name)).not.toContain('Bas Vos');
    expect(out.skipped.otherGroup).toEqual(['Bas Vos']);
    // Sem's projectgroep still names Bas: he is a member of Valtoren.
    expect(out.students[0]!.projectgroep.members.map((m) => m.name)).toContain('Bas Vos');
  });

  it('warns about a partly graded projectgroep, whose rapport shows "—" (review 24 m3)', () => {
    const input = fixtureInput();
    const records = new Map(input.records);
    const rec = structuredClone(RECORDS['900104']!) as ScoreRecord;
    delete (rec.scores![EXAM_ID] as Record<string, unknown>).theorie;
    records.set('900104', rec);
    const out = buildPoRapportData({ ...input, records });
    const fleur = out.students.find((s) => s.name === 'Fleur de Wit')!;
    expect(fleur.categories.find((c) => c.name === 'Theorie')!.score).toBeNull();
    expect(out.skipped.partial).toEqual(['Projectgroep 2']);
  });

  it('a category added after grading makes the groups partly graded (review 24 m8)', () => {
    const input = fixtureInput();
    const rubric = structuredClone(input.rubric!);
    rubric.categories.push({
      ...structuredClone(rubric.categories[0]!),
      id: 'nieuw',
      naam: 'Nieuw',
    });
    const out = buildPoRapportData({ ...input, rubric });
    expect(out.students).toHaveLength(4);
    expect(out.students[0]!.categories.at(-1)).toMatchObject({ name: 'Nieuw', score: null });
    expect(out.skipped.partial).toEqual(['Valtoren', 'Projectgroep 2']);
  });

  it('on a herkansing lists as unplaced only who has no grade on the original (review 24 m6)', () => {
    const input = fixtureInput();
    const resit = {
      ...EXAM,
      id: 'po-h',
      parent_id: EXAM_ID,
      description: 'HERKANSING',
      projectgroepen: [{ id: 'pg-h', naam: '', student_ids: ['900103'] }],
    } as Exam;
    const records = new Map(input.records);
    const bas = structuredClone(RECORDS['900103']!) as ScoreRecord;
    bas.scores!['po-h'] = { ...(bas.scores![EXAM_ID] as object) };
    bas.po!['po-h'] = { projectgroep: 'pg-h', groupLines: [], ownLines: [] } as never;
    records.set('900103', bas);
    const out = buildPoRapportData({ ...input, exam: resit, original: EXAM, records });
    expect(out.students.map((s) => s.name)).toEqual(['Bas Vos']);
    // Sem, Emma and Fleur have a grade on the original; Daan and Lotte have none.
    expect(out.skipped.unplaced).toEqual(['Lotte Bakker', 'Daan Jansen']);
  });

  it('names who gets no rapport and why, in plain Dutch (review 24 n1)', () => {
    expect(
      skippedNoticeHtml({
        unplaced: ['Lotte Bakker', 'Sam <Smit>'],
        ungraded: ['Daan Jansen'],
        otherGroup: ['Bas Vos'],
        partial: ['Projectgroep 2'],
      }),
    ).toBe(
      '<p class="rapport-skipped">Geen rapport voor Lotte Bakker en Sam &lt;Smit&gt;: niet ingedeeld in een projectgroep.</p>' +
        '<p class="rapport-skipped">Geen rapport voor Daan Jansen: nog geen cijfer.</p>' +
        '<p class="rapport-skipped">Geen rapport voor Bas Vos: beoordeeld in een andere projectgroep. Beoordeel de eigen projectgroep opnieuw via Scores invoeren.</p>' +
        '<p class="rapport-skipped">Let op: Projectgroep 2 is nog niet helemaal beoordeeld. Een categorie zonder score staat in het rapport als —.</p>',
    );
    expect(
      skippedNoticeHtml({ unplaced: [], ungraded: [], otherGroup: [], partial: ['A', 'B'] }),
    ).toContain('Let op: A en B zijn nog niet helemaal beoordeeld.');
    expect(skippedNoticeHtml({ unplaced: [], ungraded: [], otherGroup: [], partial: [] })).toBe('');
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
