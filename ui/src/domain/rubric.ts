// SPDX-License-Identifier: AGPL-3.0-or-later

// Rubrics and observatie toetstypes (step 21; PLAN-2 decisions 16, 20, 21, 23). The rules run
// in Rust (`maatwerk_grades::rubric`, WebAssembly): the editor checks live with the same code
// the core uses to refuse a bad save. File format: docs/reference/data-files-v3.md "Rubrics".

import { coreCall } from './core';

export type Soort = 'normaal' | 'bonus' | 'diagnostisch';
export type Toetstype = 'toets' | 'po';

export interface Niveau {
  min: number | null;
  max: number | null;
  titel?: string;
  uitleg: string;
}

export interface RubricCategory {
  id: string;
  naam: string;
  max: number | null;
  soort: Soort;
  obs_ids: string[];
  niveaus: Niveau[];
}

export interface Rubric {
  id: string;
  naam: string;
  beschrijving?: string;
  subject: string;
  schoolsoort: string[];
  jaarlagen: string[];
  obs_ids: string[];
  categories: RubricCategory[];
  _meta?: { rev?: number; [k: string]: unknown };
}

export interface RubricTotals {
  categories: number;
  normal: number;
  bonus: number;
  diagnostic: number;
}

export interface CategoryCheck {
  id: string;
  errors: string[];
  /** Runs [from, to] of scores no level covers. */
  gaps: [number, number][];
  /** Levels whose bounds are wrong on their own. */
  badLevels: number[];
  /** Levels whose minimum (maximum) another level has too. */
  sharedMin: number[];
  sharedMax: number[];
  missingUitleg: number[];
}

export interface RubricCheck {
  valid: boolean;
  errors: string[];
  categories: CategoryCheck[];
  totals: RubricTotals;
}

/** The PO's that use a rubric (`rubricUsage`, any school year). */
export interface RubricUse {
  year: string;
  examId: string;
  naam: string;
}

export const MIN_LEVELS = 2;
export const MAX_LEVELS = 5;

export const SOORTEN: { value: Soort; label: string }[] = [
  { value: 'normaal', label: 'Normaal' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'diagnostisch', label: 'Diagnostisch' },
];

/**
 * A rubric file with every list present, whatever is on disk (a hand-edited or damaged file must
 * not break the tab, review 21 m5). The rules still judge what is there.
 */
export function normaliseRubric(raw: unknown): Rubric {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Rubric>;
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  // As the Rust reader: a number or a numeric string.
  const num = (v: unknown): number | null => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const soort = (v: unknown): Soort => (v === 'bonus' || v === 'diagnostisch' ? v : 'normaal');
  return {
    ...r,
    id: str(r.id),
    naam: str(r.naam),
    subject: str(r.subject),
    schoolsoort: list<unknown>(r.schoolsoort).map(String),
    jaarlagen: list<unknown>(r.jaarlagen).map(String),
    obs_ids: list<unknown>(r.obs_ids).map(String),
    categories: list<Partial<RubricCategory> | null>(r.categories)
      .filter((c): c is Partial<RubricCategory> => !!c && typeof c === 'object')
      .map((c) => ({
        ...c,
        id: str(c.id),
        naam: str(c.naam),
        max: num(c.max),
        soort: soort(c.soort),
        obs_ids: list<unknown>(c.obs_ids).map(String),
        niveaus: list<Partial<Niveau> | null>(c.niveaus)
          .filter((l): l is Partial<Niveau> => !!l && typeof l === 'object')
          .map((l) => ({
            ...l,
            min: num(l.min),
            max: num(l.max),
            titel: str(l.titel),
            uitleg: str(l.uitleg),
          })),
      })),
  };
}

/** Every rule of decision 21 plus the rubric's own fields; `valid` means it may be saved. */
export function checkRubric(rubric: Rubric): RubricCheck {
  return coreCall<RubricCheck>('checkRubric', rubric);
}

/** What an edit changes that decision 20 locks while a PO uses the rubric (empty: allowed). */
export function lockedChanges(before: Rubric, after: Rubric): string[] {
  return coreCall<string[]>('rubricLockedChanges', before, after);
}

/** 10 × points ÷ max, between 1,0 and 10,0 (decision 16); null without a max. Not rounded. */
export function poGrade(points: number, max: number): number | null {
  return coreCall<number | null>('poGrade', points, max);
}

/** "17 punten + 4 bonus" (the editor header) or "17 punten · bonus 4" (cards, `style: 'card'`). */
export function totalsText(t: RubricTotals, style: 'header' | 'card' = 'header'): string {
  const punten = `${t.normal} ${t.normal === 1 ? 'punt' : 'punten'}`;
  if (style === 'card') {
    const cats = `${t.categories} ${t.categories === 1 ? 'categorie' : 'categorieën'}`;
    return [cats, punten, t.bonus ? `bonus ${t.bonus}` : ''].filter(Boolean).join(' · ');
  }
  return t.bonus ? `${punten} + ${t.bonus} bonus` : punten;
}

/** "In gebruik bij 2 PO's". */
export function usageText(n: number): string {
  return `In gebruik bij ${n} ${n === 1 ? 'PO' : "PO's"}`;
}

/** The toetstypes of an observatie; absent or empty means `toets` (decision 23). */
export function obsToetstypes(obs: { toetstypes?: unknown }): Toetstype[] {
  const list = Array.isArray(obs.toetstypes)
    ? obs.toetstypes.filter((t): t is Toetstype => t === 'toets' || t === 'po')
    : [];
  return list.length ? list : ['toets'];
}

/** Offered on test screens (`toets`) or PO screens (`po`). */
export function obsHasToetstype(obs: { toetstypes?: unknown }, type: Toetstype): boolean {
  return obsToetstypes(obs).includes(type);
}

let seq = 0;
/** An opaque id with a prefix (C10): time plus a counter, so two in one millisecond differ. */
export function makeId(prefix: string): string {
  seq = (seq + 1) % 1000;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36).padStart(2, '0')}`;
}

/** Two levels splitting 0..max; the editor's default for a new category. */
export function defaultLevels(max: number): Niveau[] {
  const mid = Math.max(0, Math.floor(max / 2));
  return [
    { min: 0, max: mid, titel: '', uitleg: '' },
    { min: Math.min(mid + 1, max), max, titel: '', uitleg: '' },
  ];
}

export function newCategory(): RubricCategory {
  return {
    id: makeId('cat'),
    naam: '',
    max: 4,
    soort: 'normaal',
    obs_ids: [],
    niveaus: defaultLevels(4),
  };
}

export function newRubric(subject: string, fields: Partial<Rubric> = {}): Rubric {
  return {
    id: makeId('rubric'),
    naam: '',
    beschrijving: '',
    subject,
    schoolsoort: [],
    jaarlagen: [],
    obs_ids: [],
    categories: [newCategory()],
    ...fields,
  };
}

/** "Dupliceren": a free copy (new ids, no `_meta`) named "<naam> (kopie)". */
export function duplicateRubric(rubric: Rubric): Rubric {
  const copy = structuredClone(rubric);
  delete copy._meta;
  copy.id = makeId('rubric');
  copy.naam = `${rubric.naam} (kopie)`;
  copy.categories = copy.categories.map((c) => ({ ...c, id: makeId('cat') }));
  return copy;
}
