// SPDX-License-Identifier: AGPL-3.0-or-later

// Data format v2 at the Store's file boundary (docs/reference/data-files-v2.md).
// The files say `"N"` for "niet gemaakt" (C9) and hold the students of a year
// in `{ students: [...] }` with string ids (C8); in memory the app keeps the
// shapes the domain code was written for (`null` = N, a plain student array),
// so grades, reports and the score grid do not change. Every read of these
// files goes through `decode`, every write through `encode`.

/** `<year>/scores/<subject>/<studentId>.json`. */
const SCORE_PATH = /^\d{4}-\d{4}\/scores\/[^/]+\/[^/]+\.json$/;
/** `<year>/students-<year>.json`. */
const STUDENTS_PATH = /^(\d{4}-\d{4})\/students-\1\.json$/;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A student id as v2 stores it: a string (C8). */
export function studentId(id: unknown): string {
  return typeof id === 'string' ? id : String(id ?? '');
}

/**
 * A student number typed or imported, as a string (C8). Same rule as v1, which
 * stored `Number(input)`: what is no number, or 0, is rejected (''), and the
 * number's text is kept ("0123" -> "123", "1.5e2" -> "150"), so a re-import
 * still matches the migrated students.
 */
export function normalStudentId(raw: unknown): string {
  const n = Number(String(raw ?? '').trim());
  return n ? String(n) : '';
}

/** Maps every question value of every exam in `scores` with `f`, in place. */
function mapScores(rec: Obj, f: (v: unknown) => unknown): void {
  if (!isObj(rec.scores)) return;
  for (const qs of Object.values(rec.scores)) {
    if (!isObj(qs)) continue;
    for (const [q, v] of Object.entries(qs)) qs[q] = f(v);
  }
}

/** File content -> what the Store keeps in memory. Other files pass through. */
export function decode(relPath: string, data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (STUDENTS_PATH.test(relPath)) {
    // A bare array is the v1 shape (a file a colleague's old app wrote, or one not yet
    // synced): read it as the list. Anything else is refused, never read as an empty list:
    // the next save would replace the whole year with one student (review 7a M1).
    const list = Array.isArray(data)
      ? data
      : isObj(data) && Array.isArray(data.students)
        ? data.students
        : null;
    if (!list) throw new Error(`Bestand ${relPath} heeft geen lijst met leerlingen.`);
    return list.map((s) => (isObj(s) && 'id' in s ? { ...s, id: studentId(s.id) } : s));
  }
  if (SCORE_PATH.test(relPath) && isObj(data)) {
    const rec = structuredClone(data);
    if ('student_id' in rec) rec.student_id = studentId(rec.student_id);
    mapScores(rec, (v) => (v === 'N' ? null : v));
    return rec;
  }
  return data;
}

/** What the Store keeps in memory -> file content. Other files pass through. */
export function encode(relPath: string, data: unknown): unknown {
  if (STUDENTS_PATH.test(relPath) && Array.isArray(data)) {
    return {
      students: data.map((s) => (isObj(s) && 'id' in s ? { ...s, id: studentId(s.id) } : s)),
    };
  }
  if (SCORE_PATH.test(relPath) && isObj(data)) {
    const rec = structuredClone(data);
    if ('student_id' in rec) rec.student_id = studentId(rec.student_id);
    mapScores(rec, (v) => (v === null ? 'N' : v));
    return rec;
  }
  return data;
}

/** Six random base-36 characters. */
function randomPart(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => (b % 36).toString(36)).join('');
}

/**
 * An id that does not depend on a title (C10): `<prefix>-<ms in base 36>-<random>`,
 * e.g. `toets-mhd2k1x0-a8f3k2`. Fits `^[A-Za-z0-9_-]+$`.
 */
export function opaqueId(prefix: 'toets' | 'groep', now: number = Date.now()): string {
  return `${prefix}-${now.toString(36)}-${randomPart()}`;
}
