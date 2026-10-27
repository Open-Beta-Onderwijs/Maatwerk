// SPDX-License-Identifier: AGPL-3.0-or-later

// Ids, slugs, names, the school year, group-name parsing, exam sequence
// numbers and `_meta` stamps. Ported from store.js; pinned by
// tests/golden/logic/ids.json.

import type { Exam, Meta, Student } from './types';

/** School year of `now`: it turns over on 1 August, local time (BR 10). */
export function currentSchoolYear(now: Date = new Date()): string {
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/** "voornaam tussenvoegsel achternaam", else the legacy `name`, else `#id`. */
export function fullName(s: Partial<Student>): string {
  if (s.voornaam || s.achternaam)
    return [s.voornaam, s.tussenvoegsel, s.achternaam].filter(Boolean).join(' ');
  return s.name ?? `#${s.id}`;
}

/** Leading digits of a stamklas ("3a" -> "3"), or ''. */
export function jaarlaagFromStamklas(stamklas: unknown): string {
  const m = String(stamklas ?? '').match(/^(\d+)/);
  return m ? m[1]! : '';
}

/** Sorts in place by jaarlaag (numeric), stamklas, achternaam; returns the list. */
export function sortStudents<T extends Partial<Student>>(list: T[]): T[] {
  list.sort((a, b) => {
    const ja = jaarlaagFromStamklas(a.stamklas),
      jb = jaarlaagFromStamklas(b.stamklas);
    const jcmp = ja.localeCompare(jb, undefined, { numeric: true });
    if (jcmp !== 0) return jcmp;
    const scmp = (a.stamklas ?? '').localeCompare(b.stamklas ?? '');
    if (scmp !== 0) return scmp;
    return (a.achternaam ?? '').localeCompare(b.achternaam ?? '');
  });
  return list;
}

/** Lower-case ASCII slug: other characters (accents too) collapse to '-'. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** `<subject>-<slug(title)>-<year>`; equal titles collide (quirk B26). */
export function makeExamId(title: string, year: string, subject: string | null | undefined) {
  return `${subject}-${slug(title)}-${year.replace(/\//g, '-')}`;
}

export function makeGroupId(name: string, year: string): string {
  return slug(name) + '-' + year.replace(/\//g, '-');
}

/** Subject guessed from a group name ("3a nat" -> 'nat'), or null. */
export function subjectFromGroupName(name: string | null | undefined): string | null {
  const n = (name ?? '').toLowerCase();
  if (/nat/.test(n)) return 'nat';
  if (/biol/.test(n)) return 'bio';
  if (/schk/.test(n)) return 'schk';
  if (/wi/.test(n)) return 'wi';
  return null;
}

/**
 * Jaarlaag (leading digits) and, for wiskunde, the subcategory (`wisa`..`wisd`,
 * or 'onderbouw' for jaarlaag 1-3) derived from a group name.
 */
export function parseGroupName(
  name: string | null | undefined,
  subject: string | null | undefined,
): { jaarlaag: string | null; subcategory: string | null } {
  const n = (name ?? '').toLowerCase();
  const jlMatch = n.match(/^(\d+)/);
  const jaarlaag = jlMatch ? jlMatch[1]! : null;

  let subcategory: string | null = null;
  if (subject === 'wi') {
    if (/wisd/.test(n)) subcategory = 'wisd';
    else if (/wisc/.test(n)) subcategory = 'wisc';
    else if (/wisb/.test(n)) subcategory = 'wisb';
    else if (/wisa/.test(n)) subcategory = 'wisa';
    // "4awi"/"5bwi" are not recognised (subcategory stays null)
    if (!subcategory && jaarlaag && parseInt(jaarlaag, 10) <= 3) {
      subcategory = 'onderbouw';
    }
  }

  return { jaarlaag, subcategory };
}

/**
 * Sequence number for a new exam: jaarlaag * 100 + (highest existing sequence
 * of that jaarlaag mod 100) + 1; undefined when the jaarlaag is not a number.
 * Overflows above 99 exams per jaarlaag (quirk B27).
 */
export function nextVolgnummer(
  existing: Pick<Exam, 'jaarlaag' | 'volgnummer'>[],
  jaarlaag: Exam['jaarlaag'],
): number | undefined {
  const jl = parseInt(String(jaarlaag), 10);
  if (isNaN(jl)) return undefined;
  const same = existing.filter((e) => String(e.jaarlaag) === String(jaarlaag) && e.volgnummer);
  const maxSeq = same.length > 0 ? Math.max(...same.map((e) => e.volgnummer! % 100)) : 0;
  return jl * 100 + maxSeq + 1;
}

/**
 * Sets `obj._meta` for a save: rev + 1 over the version on disk, creation
 * fields kept from disk (or set now for a new file), updated now by `userId`.
 */
export function stampMeta<T extends object>(
  obj: T,
  onDisk: { _meta?: Partial<Meta> } | null | undefined,
  userId: string | null,
  now: Date = new Date(),
): T & { _meta: Meta } {
  const iso = now.toISOString();
  const prev = onDisk?._meta;
  (obj as T & { _meta: Meta })._meta = {
    rev: (prev?.rev ?? 0) + 1,
    createdBy: onDisk ? (prev?.createdBy ?? null) : userId,
    createdAt: onDisk ? (prev?.createdAt ?? null) : iso,
    updatedBy: userId,
    updatedAt: iso,
  };
  return obj as T & { _meta: Meta };
}
