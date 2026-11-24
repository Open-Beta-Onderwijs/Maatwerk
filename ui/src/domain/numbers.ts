// SPDX-License-Identifier: AGPL-3.0-or-later

// The list screens' numbers of one school year and vak, computed in Rust (step 38,
// `maatwerk_core::numbers`, command `vak_numbers`). The types mirror the serde output; the UI only
// formats these values (decimal comma, fixed decimals), it computes no grade number itself.

import type { AverageFormat, Histogram, Stats, Trend } from './statistics';

/** A student average as shown (decisions 91-93). */
export interface Shown {
  /** Unrounded. */
  raw: number;
  /** Under the school's format: show with exactly `decimalen` decimals. */
  shown: number;
  /** The shown value below 5,5. */
  fails: boolean;
}

/** One bar of a student card: a test's best attempt, in volgnummer order. */
export interface NumbersBar {
  /** The original's id. */
  examId: string;
  grade: number;
  diagnostic: boolean;
}

export interface StudentNumbers {
  /** Years 4-6. */
  upper: boolean;
  /** Grade per attempt id, for every attempt with one. */
  results: Record<string, number>;
  bars: NumbersBar[];
  average: Shown | null;
  trend: Trend | null;
  /** Only for upper-school students and members of an upper-school group. */
  se: Shown | null;
}

/** One exam card: an attempt, or a Verzamelkaart. */
export interface ExamNumbers {
  /** The grades that count, in student order. */
  grades: number[];
  stats: Stats | null;
  /** The mini histogram (step 1). */
  histogram: Histogram;
  /** Observatie id -> number of students. */
  obs: Record<string, number>;
}

export interface GroupNumbers {
  upper: boolean;
  year: Stats | null;
  se: Stats | null;
}

export interface Formats {
  r: AverageFormat;
  se: AverageFormat;
}

export interface VakNumbers {
  year: string;
  vak: string;
  formats: Formats;
  students: Record<string, StudentNumbers>;
  /** Per attempt id. */
  exams: Record<string, ExamNumbers>;
  /** The Verzamelkaart per original that has resits. */
  summaries: Record<string, ExamNumbers>;
  groups: Record<string, GroupNumbers>;
}

export const DEFAULT_FORMAT: AverageFormat = { methode: 'afronden', decimalen: 1 };

/**
 * One format of `instellingen.json` `gemiddelden` as the core reads it: missing parts default
 * (afronden, 1), anything unusable is the default for that average.
 */
export function readFormat(v: unknown): AverageFormat {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_FORMAT };
  const o = v as { methode?: unknown; decimalen?: unknown };
  const methode = o.methode === undefined ? 'afronden' : o.methode;
  const decimalen = o.decimalen === undefined ? 1 : o.decimalen;
  if (methode !== 'afronden' && methode !== 'afkappen') return { ...DEFAULT_FORMAT };
  if (decimalen !== 0 && decimalen !== 1 && decimalen !== 2) return { ...DEFAULT_FORMAT };
  return { methode, decimalen };
}

/** Both formats of `instellingen.json` (`maatwerk_core::numbers::format::school_formats`). */
export function readFormats(instellingen: unknown): Formats {
  const g = (instellingen as { gemiddelden?: Record<string, unknown> } | null)?.gemiddelden;
  const field = g && typeof g === 'object' ? g : undefined;
  return { r: readFormat(field?.r), se: readFormat(field?.se) };
}
