// SPDX-License-Identifier: AGPL-3.0-or-later

// PO data for the e2e and visual tests (step 22). The shared mock fixture has no PO: the step 21
// rubric tests count the rubrics' uses. This adds a second nat class (3b, two students), a PO on
// the fixture rubric "Onderzoeksverslag" (max 17, bonus 4) with two projectgroepen that mix the
// classes, and optionally category scores merged into the students' existing score files.

import { expect, type Page } from '@playwright/test';
import { TEACHER, withMock, YEAR } from './helpers';

export const PO_ID = 'po-valbeweging';
export const RUBRIC_ID = 'rubric-onderzoek';
export const CLASS_3B = '3b-nat-2025-2026';
/** Students of 3b. */
export const NEW_STUDENTS = ['900101', '900102'];

export interface SeedOptions {
  /** Write the PO exam (otherwise only the class 3b). */
  po?: boolean;
  /** Category scores: Valtoren 17 of 17 (10,0), the other group 14 (8,2). */
  scores?: boolean;
  /**
   * Step 23 grading: Valtoren 15 of 17 (8,8) with a group line −0,5 and, for Noor Bakker, an own
   * line +0,3 (8,3 and 8,6); Projectgroep 2 only Theorie 4, without a `po` entry (Bezig).
   */
  grading?: boolean;
}

/** The step 23 grading of Valtoren (`grading: true`). */
export const VALTOREN_GRADING = {
  scores: { 'cat-theorie': 6, 'cat-uitvoering': 7, 'cat-extra': 2, 'cat-samen': 3 },
  observations: ['obs-po-netjes'],
  po: {
    projectgroep: 'pg-1',
    categoryObs: { 'cat-theorie': ['obs-po-bronnen'] },
    categoryComments: { 'cat-uitvoering': 'Herhaal de metingen.' },
    comment: 'Goed onderzoek.',
    groupLines: [{ label: 'Te laat ingeleverd', value: -0.5 }],
    ownLines: [] as { label: string; value: number }[],
  },
};

interface ScoreFile {
  student_id?: string;
  scores?: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}

export function poExam(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PO_ID,
    title: 'PO Onderzoek valbeweging',
    subject: 'nat',
    kind: 'po',
    diagnostic: false,
    type: 'pta',
    rubric_id: RUBRIC_ID,
    jaarlaag: '3',
    schoolsoort: ['Havo', 'Vwo'],
    periode: '2',
    weging: 2,
    weging_se: 10,
    volgnummer: 309,
    questions: [],
    obs_ids: [],
    projectgroepen: [
      { id: 'pg-1', naam: 'Valtoren', student_ids: ['900001', '900101'] },
      { id: 'pg-2', student_ids: ['900002', '900003'] },
    ],
    _meta: { rev: 1 },
    ...fields,
  };
}

/** The files to seed; reads the fixture first (it goes to `/`). */
export async function poSeed(page: Page, o: SeedOptions = {}): Promise<Record<string, unknown>> {
  // Wait for the start screen: WebKit logs "Importing a module script failed." when the login's
  // navigation aborts a page still importing app.js (as perceived-speed.spec.ts loadApp).
  await page.goto('/');
  await expect(page.locator('.subject-card').first()).toBeVisible();
  const studentsRel = `${YEAR}/students-${YEAR}.json`;
  const read = (rel: string) =>
    withMock(page, (m, p) => JSON.parse(m.peek(p) ?? 'null') as unknown, rel);
  const students = (await read(studentsRel)) as { students: Record<string, unknown>[] };
  const files: Record<string, unknown> = {
    [studentsRel]: {
      ...students,
      students: [
        ...students.students,
        ...NEW_STUDENTS.map((id, i) => ({
          id,
          voornaam: ['Noor', 'Daan'][i],
          tussenvoegsel: '',
          achternaam: ['Bakker', 'Visser'][i],
          stamklas: '3b',
          jaarlaag: '3',
          schoolsoort: ['Havo', 'Vwo'],
        })),
      ],
    },
    [`${YEAR}/groups/${CLASS_3B}.json`]: {
      id: CLASS_3B,
      name: '3b nat',
      subject: 'nat',
      jaarlaag: '3',
      schoolsoort: ['Havo', 'Vwo'],
      student_ids: NEW_STUDENTS,
      docenten: [TEACHER],
      _meta: { rev: 1 },
    },
  };
  if (o.po || o.scores) files[`${YEAR}/exams/${PO_ID}.json`] = poExam();
  if (o.scores) {
    const points: Record<string, Record<string, number>> = {
      '900001': { 'cat-theorie': 8, 'cat-uitvoering': 9 },
      '900101': { 'cat-theorie': 8, 'cat-uitvoering': 9 },
      '900002': { 'cat-theorie': 7, 'cat-uitvoering': 7 },
      '900003': { 'cat-theorie': 7, 'cat-uitvoering': 7 },
    };
    for (const [id, cats] of Object.entries(points)) {
      const rel = `${YEAR}/scores/nat/${id}.json`;
      const old = ((await read(rel)) as ScoreFile | null) ?? { student_id: id };
      files[rel] = { ...old, scores: { ...(old.scores ?? {}), [PO_ID]: cats } };
    }
  }
  if (o.grading) {
    if (!o.po && !o.scores) files[`${YEAR}/exams/${PO_ID}.json`] = poExam();
    const g = VALTOREN_GRADING;
    const own = { '900101': [{ label: 'Extra meting', value: 0.3 }] } as Record<string, unknown[]>;
    for (const id of ['900001', '900101', '900002', '900003']) {
      const rel = `${YEAR}/scores/nat/${id}.json`;
      const old = ((await read(rel)) as ScoreFile | null) ?? { student_id: id };
      const valtoren = id === '900001' || id === '900101';
      files[rel] = {
        ...old,
        scores: {
          ...(old.scores ?? {}),
          [PO_ID]: valtoren ? g.scores : { 'cat-theorie': 4 },
        },
        ...(valtoren
          ? {
              observations: {
                ...((old.observations as Record<string, unknown> | undefined) ?? {}),
                [PO_ID]: g.observations,
              },
              po: { [PO_ID]: { ...g.po, ownLines: own[id] ?? [] } },
            }
          : {}),
      };
    }
  }
  return files;
}
