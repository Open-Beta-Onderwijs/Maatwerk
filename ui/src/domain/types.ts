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

/** Format v3 (step 18, decision 14): a test or a practical assignment (PO). */
export type ExamKind = 'toets' | 'po';

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
  /** Format v3; absent counts as `'toets'`. */
  kind?: ExamKind;
  /** Format v3: a diagnostic test counts for neither rapport nor SE (weging 0, never PTA). */
  diagnostic?: boolean;
  /** Format v3: an inhaal/herkansing with the original's observaties, locked (F-12). */
  obs_from_parent?: boolean;
  /** Format v3 (F-14): opdrachten for a score below `onder` on question `vraag`. */
  opdrachtenVraag?: VraagCard[];
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
/** A student number; a string in format v2 (ADR-0003 C8). */
export type StudentId = string;

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

/** Format v3 (F-14): "score on question `vraag` below `onder`" -> these opdrachten. */
export interface VraagCard {
  id: string;
  /** A question id of the exam. */
  vraag: string;
  /** Points: a score below this matches, and so does `N` (not attempted); an empty score not. */
  onder: number;
  opdrachten?: string[];
}

/** The v3 defaults of an exam: `kind: 'toets'`, `diagnostic: false` when absent. */
export function withExamDefaults<E extends Partial<Exam>>(exam: E): E {
  return { ...exam, kind: exam.kind ?? 'toets', diagnostic: exam.diagnostic ?? false };
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
