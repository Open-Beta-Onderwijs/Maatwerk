// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bestAttempt, resolveBestAttempts } from './attempts';
import { examResults } from './grades';
import {
  classesByStudent,
  copyGroups,
  forGrading,
  gradeFormula,
  groupName,
  groupsToSave,
  matchingClasses,
  matchingRubrics,
  memberCount,
  movedStudents,
  placeStudent,
  randomGroups,
  rubricFilterNote,
  rubricLine,
  rubricOption,
  setRubricLookup,
  unplaced,
  type Projectgroep,
} from './po';
import { newRubric, type Rubric } from './rubric';
import { yearAverage } from './statistics';
import type { Exam } from './types';

const rubric = (fields: Partial<Rubric>): Rubric => newRubric('nat', fields);

describe('which rubrics and classes fit a PO (decision 22)', () => {
  const rubrics = [
    rubric({ id: 'r1', naam: 'Verslag', schoolsoort: ['Havo', 'Vwo'], jaarlagen: ['3', '4'] }),
    rubric({ id: 'r2', naam: 'Practicum', schoolsoort: ['Havo'], jaarlagen: ['3'] }),
    rubric({ id: 'r3', naam: 'Poster', schoolsoort: ['Vwo'], jaarlagen: ['5'] }),
    {
      ...rubric({ id: 'r4', naam: 'Biologie', schoolsoort: ['Havo'], jaarlagen: ['3'] }),
      subject: 'bio',
    },
  ];

  it('same vak, a shared schoolsoort and the jaarlaag; sorted by name', () => {
    const ids = (s: Parameters<typeof matchingRubrics>[1]) =>
      matchingRubrics(rubrics, s).map((r) => r.id);
    expect(ids({ subject: 'nat', schoolsoort: ['Havo'], jaarlaag: '3' })).toEqual(['r2', 'r1']);
    expect(ids({ subject: 'nat', schoolsoort: ['Vwo'], jaarlaag: 3 })).toEqual(['r1']);
    expect(ids({ subject: 'nat', schoolsoort: ['Gymnasium'], jaarlaag: '3' })).toEqual([]);
    expect(ids({ subject: 'nat', schoolsoort: ['Havo'], jaarlaag: null })).toEqual([]);
  });

  it('classes: vak, jaarlaag and a shared schoolsoort; students with their class names', () => {
    const classes = [
      {
        id: 'a',
        name: '3b nat',
        subject: 'nat',
        jaarlaag: 3,
        schoolsoort: ['Havo'],
        student_ids: ['1', '2'],
      },
      {
        id: 'b',
        name: '3a nat',
        subject: 'nat',
        jaarlaag: '3',
        schoolsoort: ['Vwo'],
        student_ids: ['2', '3'],
      },
      {
        id: 'c',
        name: '4a nat',
        subject: 'nat',
        jaarlaag: '4',
        schoolsoort: ['Havo'],
        student_ids: ['4'],
      },
      {
        id: 'd',
        name: '3 bio',
        subject: 'bio',
        jaarlaag: '3',
        schoolsoort: ['Havo'],
        student_ids: ['5'],
      },
    ];
    const m = matchingClasses(classes, {
      subject: 'nat',
      schoolsoort: ['Havo', 'Vwo'],
      jaarlaag: '3',
    });
    expect(m.map((c) => c.id)).toEqual(['b', 'a']);
    expect([...classesByStudent(m)]).toEqual([
      ['2', ['3a nat', '3b nat']],
      ['3', ['3a nat']],
      ['1', ['3b nat']],
    ]);
  });

  it('texts of the PO dialog and card (spec 4.13)', () => {
    const t = { categories: 4, normal: 17, bonus: 4, diagnostic: 3 };
    expect(rubricOption(rubric({ naam: 'Verslag' }), t)).toBe('Verslag (17 + 4 bonus)');
    expect(rubricOption(rubric({ naam: 'P' }), { ...t, bonus: 0 })).toBe('P (17)');
    expect(rubricLine(rubric({ naam: 'Verslag' }), t)).toBe(
      'Rubric Verslag · 4 categorieën · 17 punten · bonus 4',
    );
    expect(rubricLine(undefined, null)).toBe('Rubric ontbreekt: geen cijfer');
    expect(gradeFormula(17)).toBe(
      'Cijfer = 10 × punten ÷ 17, minimaal 1,0 en hoogstens 10,0. Bonuspunten tellen mee in de punten, niet in het maximum.',
    );
    expect(rubricFilterNote({ schoolsoort: ['Gymnasium'], jaarlaag: '5' }, 'Natuurkunde')).toBe(
      'Alleen rubrics voor Gymnasium · Natuurkunde · jaarlaag 5',
    );
    expect(memberCount(1)).toBe('1 ll');
    expect(memberCount(2)).toBe('2 lln');
    expect(groupName({ id: 'g', naam: '  ', student_ids: [] }, 2)).toBe('Projectgroep 3');
    expect(groupName({ id: 'g', naam: 'Valtoren', student_ids: [] }, 0)).toBe('Valtoren');
  });
});

describe('projectgroepen (decisions 18, 19)', () => {
  const groups: Projectgroep[] = [
    { id: 'g1', naam: 'A', student_ids: ['1', '2'] },
    { id: 'g2', student_ids: ['3'] },
    { id: 'g3', naam: ' ', student_ids: [] },
  ];

  it('unplaced keeps the order of the students', () => {
    expect(unplaced(['5', '3', '4', '1'], groups)).toEqual(['5', '4']);
  });

  it('a student moves to one group, or out of all', () => {
    const moved = placeStudent(groups, '2', 'g2');
    expect(moved.map((g) => g.student_ids)).toEqual([['1'], ['3', '2'], []]);
    expect(placeStudent(moved, '3', null).map((g) => g.student_ids)).toEqual([['1'], ['2'], []]);
  });

  it('random groups are at most the size and as even as possible', () => {
    const ten = Array.from({ length: 10 }, (_, i) => String(i));
    let x = 0.37;
    const rng = () => (x = (x * 9301 + 0.49297) % 1);
    const out = randomGroups(ten, 3, rng);
    expect(out.map((g) => g.length)).toEqual([3, 3, 2, 2]);
    expect(out.flat().sort()).toEqual(ten.sort());
    expect(randomGroups(['a'], 0).map((g) => g.length)).toEqual([1]);
    expect(randomGroups([], 3)).toEqual([]);
  });

  it('saving drops empty groups and blank names', () => {
    expect(groupsToSave(groups)).toEqual([
      { id: 'g1', naam: 'A', student_ids: ['1', '2'] },
      { id: 'g2', student_ids: ['3'] },
    ]);
  });

  it('a herkansing copies the groups with new ids', () => {
    const copy = copyGroups(groups);
    expect(copy.map((g) => g.student_ids)).toEqual(groups.map((g) => g.student_ids));
    expect(copy.every((g, i) => g.id !== groups[i]?.id)).toBe(true);
    copy[0]?.student_ids.push('9');
    expect(groups[0]?.student_ids).toEqual(['1', '2']);
  });

  it('only students who change group count as moved', () => {
    const after: Projectgroep[] = [
      { id: 'g1', student_ids: ['1'] },
      { id: 'g2', student_ids: ['3', '2'] },
      { id: 'g4', student_ids: ['7'] },
    ];
    expect(movedStudents(groups, after)).toEqual(['2']);
  });
});

describe('a PO is graded with its rubric (step 22, decision 16)', () => {
  const r = {
    ...rubric({ id: 'rx' }),
    categories: [
      { id: 'c1', naam: 'A', max: 8, soort: 'normaal' as const, obs_ids: [], niveaus: [] },
      { id: 'c2', naam: 'B', max: 2, soort: 'normaal' as const, obs_ids: [], niveaus: [] },
      { id: 'c3', naam: 'X', max: 4, soort: 'bonus' as const, obs_ids: [], niveaus: [] },
    ],
  };
  const po: Exam = {
    id: 'p',
    kind: 'po',
    subject: 'nat',
    rubric_id: 'rx',
    weging: 1,
    questions: [],
  };
  const rec = { scores: { p: { c1: 6, c3: 1 } } };

  it('attaches the rubric for the rules only', () => {
    setRubricLookup((id) => (id === 'rx' ? r : undefined));
    expect((forGrading(po) as { rubric?: unknown }).rubric).toBe(r);
    expect('rubric' in po).toBe(false);
    const toets: Exam = { id: 't', questions: [] };
    expect(forGrading(toets)).toBe(toets);
  });

  it('grade 10 × 7 ÷ 10 = 7,0; it counts in the year average', () => {
    setRubricLookup((id) => (id === 'rx' ? r : undefined));
    const res = examResults(rec, po)!;
    expect([res.scored, res.normalMax, res.bonusMax, res.grade]).toEqual([7, 10, 4, 7]);
    expect(res.R).toBe('NVT');
    expect(yearAverage([po], rec)).toBe(7);
  });

  it('the best attempt of a PO family is graded with the rubric (review 22 M1)', () => {
    setRubricLookup((id) => (id === 'rx' ? r : undefined));
    const resit: Exam = { ...po, id: 'p2', parent_id: 'p', attempt: 2 };
    const rec2 = { scores: { p: { c1: 4 }, p2: { c1: 8, c3: 2 } } };
    const best = bestAttempt(rec2, [po, resit])!;
    expect([best.examId, best.grade]).toEqual(['p2', 10]);
    expect(best.questionScores).toEqual({ c1: 8, c3: 2 });
    const history = [po, resit].map((exam) => ({
      exam,
      questionScores: rec2.scores[exam.id as 'p' | 'p2'],
    }));
    expect(resolveBestAttempts(history).map((h) => h.exam.id)).toEqual(['p2']);
  });

  it('without its rubric no grade', () => {
    setRubricLookup(() => undefined);
    // Without categories none of its scores are read: no results at all.
    expect(examResults(rec, po)).toBeNull();
    expect(yearAverage([po], rec)).toBeNull();
  });
});
