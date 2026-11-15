// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { Results } from '../../domain/grades';
import type { Rubric } from '../../domain/rubric';
import type { Exam, Observatie, ScoreRecord, Student } from '../../domain/types';
import { levelColor } from './charts';
import { buildPoModel, levelCounts, obsSections, type PoModel } from './model';
import { poCellTip, resultatenHtml } from './resultaten';

const rubric: Rubric = {
  id: 'r',
  naam: 'Onderzoeksverslag',
  subject: 'nat',
  schoolsoort: ['Havo'],
  jaarlagen: ['3'],
  obs_ids: ['o-gen'],
  categories: [
    {
      id: 'th',
      naam: 'Theorie',
      max: 8,
      soort: 'normaal',
      obs_ids: ['o-th'],
      niveaus: [
        { min: 0, max: 3, titel: 'Matig', uitleg: '' },
        { min: 3, max: 8, titel: 'Goed', uitleg: '' },
      ],
    },
    {
      id: 'pl',
      naam: 'Planning',
      max: 2,
      soort: 'diagnostisch',
      obs_ids: [],
      niveaus: [
        { min: 0, max: 1, uitleg: '' },
        { min: 2, max: 2, uitleg: '' },
      ],
    },
  ],
};

const exam: Exam = {
  id: 'po',
  kind: 'po',
  title: 'PO',
  jaarlaag: '3',
  questions: [],
  projectgroepen: [
    { id: 'g1', naam: 'Valtoren', student_ids: ['2', '1'] },
    { id: 'g2', student_ids: ['3'] },
  ],
};

const students = new Map<string, Student>(
  [
    ['1', 'Anna', 'Smit'],
    ['2', 'Bas', 'Jansen'],
    ['3', 'Cas', 'Visser'],
    ['4', 'Dirk', 'Bakker'],
  ].map(([id, voornaam, achternaam]) => [id!, { id: id!, voornaam, achternaam }]),
);

const valtoren = (own: number | null): ScoreRecord => ({
  scores: { po: { th: 3, pl: 1 } },
  observations: { po: ['o-gen'] },
  po: {
    po: {
      projectgroep: 'g1',
      categoryObs: { th: ['o-th'] },
      groupLines: [{ label: 'Te laat', value: -0.5 }],
      ownLines: own === null ? [] : [{ label: 'Extra', value: own }],
    },
  },
});

const records = new Map<string, ScoreRecord>([
  ['1', valtoren(0.3)],
  ['2', valtoren(null)],
  ['3', { scores: { po: { th: 8 } } }],
  ['4', {}],
]);

const grades: Record<string, number> = { '1': 3.6, '2': 3.3, '3': 10 };

function model(): PoModel {
  return buildPoModel({
    exam,
    rubric,
    students,
    records,
    classTag: (id) => (id === '3' ? '3b' : '3a'),
    name: (id) => `${students.get(id)!.voornaam} ${students.get(id)!.achternaam}`,
    results: (rec) => {
      const id = [...records].find(([, r]) => r === rec)?.[0] ?? '';
      if (!(id in grades)) return null;
      return {
        scored: Number(rec?.scores?.po?.th ?? 0),
        grade: grades[id]!,
        rubricGrade: id === '3' ? 10 : 3.8,
      } as Results;
    },
  });
}

const obs: Observatie[] = [
  { id: 'o-gen', naam: 'Netjes', icon: '✨' },
  { id: 'o-th', naam: 'Bronnen', icon: '📚' },
] as Observatie[];

describe('PO overview model (spec 4.14)', () => {
  it('lists every student by achternaam; only placed ones have a grade', () => {
    const m = model();
    expect(m.rows.map((r) => r.id)).toEqual(['4', '2', '1', '3']);
    expect(m.placed.map((r) => r.id)).toEqual(['2', '1', '3']);
    expect(m.rows[0]!.grade).toBeNull();
    expect(m.klassen).toEqual(['3a', '3b']);
    expect(m.max).toBe(8);
    expect(m.groups.map((g) => [g.name, g.rubricGrade, g.members.length])).toEqual([
      ['Valtoren', 3.8, 2],
      ['Projectgroep 2', 10, 1],
    ]);
  });

  it('counts a score in every level it falls in', () => {
    const m = model();
    // 3, 3 (both levels) and 8 (Goed).
    expect(levelCounts(rubric.categories[0]!, m.placed)).toEqual([2, 3]);
  });

  it('counts observaties per category and in general, with the groups', () => {
    const s = obsSections(model(), obs);
    expect(s.map((x) => x.category?.naam ?? 'algemeen')).toEqual(['Theorie', 'algemeen']);
    expect(s[0]!.rows[0]).toMatchObject({ n: 2, groups: ['Valtoren'] });
    expect(s[1]!.rows[0]).toMatchObject({ n: 2, groups: ['Valtoren'] });
  });

  it('builds the tooltips: the grade build-up, observaties, then the category scores', () => {
    const m = model();
    const grade = poCellTip(m, obs, '1|cijfer')!;
    expect(grade.head).toBe('Anna Smit: 3,6');
    expect(grade.sub).toBe('Projectgroep Valtoren 3,8 · groep −0,5 · persoonlijk +0,3');
    expect(grade.obs!.map((o) => o.naam)).toEqual(['Netjes', 'Theorie: Bronnen']);
    expect(grade.rows).toEqual([
      ['Theorie', '3 / 8'],
      ['Planning (diagnostisch)', '1 / 2'],
    ]);
    expect(poCellTip(m, obs, '1|bm')!.head).toBe('Bonus / malus: −0,2');
    expect(poCellTip(m, obs, '4|cijfer')).toBeNull();
  });

  it('shows Per klas with chips and Per projectgroep with Niet ingedeeld last', () => {
    const m = model();
    const klas = resultatenHtml(m, 'klas');
    expect(klas).toContain('Klas 3a');
    expect(klas).toContain('po-ov-chip--none');
    const groep = resultatenHtml(m, 'groep');
    expect(groep).toContain('projectgroepcijfer 3,8 · Te laat −0,5 · 2 leerlingen');
    expect(groep.lastIndexOf('Niet ingedeeld')).toBeGreaterThan(
      groep.lastIndexOf('Projectgroep 2'),
    );
    // Niet ingedeeld has no footer: three sections, two of them with one.
    expect(groep.match(/GEMIDDELDE/g)).toHaveLength(2);
  });

  it('shades the levels from light to dark', () => {
    expect(levelColor(0, 3, false)).toContain('22%');
    expect(levelColor(2, 3, false)).toContain('100%');
    expect(levelColor(1, 2, true)).toContain('--grade-diagnostic-border');
  });
});
