// SPDX-License-Identifier: AGPL-3.0-or-later

// Shapes of the v1 data files, as far as the domain code reads them
// (docs/reference/data-files.md, docs/schemas/). Unknown fields pass through.

export type Rtti = 'R' | 'T1' | 'T2' | 'I';
export type QuestionKind = 'normal' | 'bonus' | 'diag';

export interface Question {
  id: string;
  max_points: number;
  rtti: Rtti;
  kind?: QuestionKind;
  [key: string]: unknown;
}

export interface Exam {
  id: string;
  subject?: string;
  subcategory?: string | null;
  title?: string;
  jaarlaag?: string | number;
  schoolsoort?: string[];
  n_term?: number;
  questions: Question[];
  parent_id?: string;
  attempt?: number;
  volgnummer?: number;
  obs_ids?: string[];
  /** Saved coupling { obsId: [opdrachtId] }. */
  opdrachten?: Record<string, string[]>;
  opdrachtenCijfer?: CijferCard[];
  academic_year?: string;
  _meta?: Meta;
  [key: string]: unknown;
}

/** A typed score: number of points, `null` or `'N'` (not made), or any string as typed. */
export type ScoreValue = number | string | null;
export type QuestionScores = Record<string, ScoreValue>;

export interface Override {
  cijfer: number | null;
  berekend?: number | null;
}

/** Student ids are numbers in imported data and strings elsewhere (ADR-0003 C8). */
export type StudentId = string | number;

/** One student's score file for one subject and year. */
export interface ScoreRecord {
  student_id?: StudentId;
  scores?: Record<string, QuestionScores>;
  overrides?: Record<string, Override>;
  observations?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface Student {
  id: StudentId;
  voornaam?: string;
  tussenvoegsel?: string;
  achternaam?: string;
  name?: string;
  stamklas?: string;
  jaarlaag?: string;
  schoolsoort?: string[];
  [key: string]: unknown;
}

export interface Group {
  id: string;
  name: string;
  subject?: string;
  jaarlaag?: string | number;
  student_ids: StudentId[];
  [key: string]: unknown;
}

export interface Meta {
  rev: number;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface CijferCard {
  id: string;
  onder: number;
  opdrachten?: string[];
  [key: string]: unknown;
}

export interface Observatie {
  id: string;
  naam?: string;
  icon?: string;
  [key: string]: unknown;
}

export interface Opdracht {
  id: string;
  naam?: string;
  vakken?: string[];
  jaarlagen?: (string | number)[];
  schoolsoort?: string[];
  observaties?: string[];
  [key: string]: unknown;
}

/** Same student id, whether stored as number or string (ADR-0003 C8). */
export function sameId(a: StudentId | null | undefined, b: StudentId | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}
