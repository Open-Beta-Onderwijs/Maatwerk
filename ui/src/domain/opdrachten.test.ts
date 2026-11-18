// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  assignOpdrachten,
  opdrachtVraagCards,
  vraagCardReason,
  vraagLabel,
  vraagScoreMatches,
} from './opdrachten';
import type { Exam, Opdracht, ScoreRecord, Student } from './types';

const exam = {
  id: 'e1',
  title: 'H3',
  structureMode: 'roman',
  questions: [
    { id: 'q1', section: 'I', number: 1, max_points: 2, rtti: 'R' },
    { id: 'q7', section: 'II', number: 3, max_points: 4, rtti: 'T1' },
  ],
  opdrachtenVraag: [
    { id: 'v1', vraag: 'q7', onder: 2, opdrachten: ['op1', 'gone'] },
    { id: 'v2', vraag: 'q9', onder: 1, opdrachten: ['op2'] },
  ],
} as unknown as Exam;

describe('F-14: a score on one question below X', () => {
  it('below the limit or N matches; an empty score or invalid text does not', () => {
    const cases: [Parameters<typeof vraagScoreMatches>[0], boolean][] = [
      [0, true],
      [1, true],
      [1.5, true],
      [2, false],
      [4, false],
      [null, true], // N as the grid stores it
      ['N', true],
      [' n ', true],
      ['1,5', true], // typed with a comma
      ['2', false],
      [undefined, false], // not entered
      ['', false],
      ['abc', false], // kept as typed, not a number
    ];
    for (const [value, want] of cases)
      expect([value, vraagScoreMatches(value, 2)]).toEqual([value, want]);
  });

  it('cards without deleted opdrachten or vanished questions; a PO has none', () => {
    const ops = [{ id: 'op1' }, { id: 'op2' }] as Opdracht[];
    expect(opdrachtVraagCards(exam, ops)).toEqual([
      { id: 'v1', vraag: 'q7', onder: 2, opdrachten: ['op1'] },
    ]);
    expect(opdrachtVraagCards({ ...exam, kind: 'po' } as Exam, ops)).toEqual([]);
  });

  it('the reason names the question as the exam numbers it', () => {
    expect(vraagLabel(exam, 'q7')).toBe('II3');
    expect(vraagLabel(exam, 'q404')).toBe('q404');
    expect(vraagCardReason({ vraag: 'q7', onder: 2 }, exam)).toEqual({
      icon: '🔢',
      naam: 'Vraag II3 onder 2 punten',
    });
    expect(vraagCardReason({ vraag: 'q1', onder: 1 }, exam).naam).toBe('Vraag I1 onder 1 punt');
    expect(vraagCardReason({ vraag: 'q1', onder: 0.5 }, exam).naam).toBe(
      'Vraag I1 onder 0,5 punten',
    );
  });

  it('assigns the card opdrachten, once per opdracht, next to the observaties', () => {
    const recs: Record<string, ScoreRecord> = {
      a: { scores: { e1: { q1: 2, q7: 1 } }, observations: { e1: ['o1'] } },
      b: { scores: { e1: { q1: 2, q7: null } } },
      c: { scores: { e1: { q1: 2 } } }, // q7 not entered
      d: { scores: { e1: { q1: 0, q7: 3 } } },
    };
    const exam2 = { ...exam, obs_ids: ['o1'] } as Exam;
    const out = assignOpdrachten({
      exam: exam2,
      students: ['a', 'b', 'c', 'd'].map((id) => ({ id, achternaam: id })) as Student[],
      recordOf: (id) => recs[String(id)],
      observaties: [{ id: 'o1', naam: 'Eenheid', icon: '📏' }] as never,
      opdrachten: [{ id: 'op1', naam: 'GFBA' }] as Opdracht[],
      groups: [],
      coupling: { o1: ['op1'] },
      vraagCards: [{ id: 'v1', vraag: 'q7', onder: 2, opdrachten: ['op1'] }],
    });
    expect(out.vraagStudents).toEqual({ v1: ['a', 'b'] });
    expect(
      out.students.map((s) => [
        s.student.id,
        s.items.map((i) => [i.opdracht.id, i.obs.map((r) => r.naam)]),
      ]),
    ).toEqual([
      ['a', [['op1', ['Eenheid', 'Vraag II3 onder 2 punten']]]],
      ['b', [['op1', ['Vraag II3 onder 2 punten']]]],
    ]);
  });
});
