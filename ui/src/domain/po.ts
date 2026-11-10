// SPDX-License-Identifier: AGPL-3.0-or-later

// Praktische opdrachten (step 22; PLAN-2 decisions 16-18, 22; design spec 4.13): which rubrics
// and students a PO can use, projectgroepen, and the rubric a PO is graded with. File format:
// docs/reference/data-files-v3.md "PO exams".

import { totalsText, type Rubric, type RubricTotals } from './rubric';
import type { Exam, Projectgroep, StudentId } from './types';

export type { Projectgroep };

/** What decides which rubrics, classes and students fit a PO. */
export interface PoScope {
  subject?: string;
  schoolsoort?: readonly string[];
  jaarlaag?: string | number | null;
}

/** A class (Groep) as far as the PO screens read it. */
export interface PoClass {
  id: string;
  name: string;
  subject?: string;
  jaarlaag?: string | number;
  schoolsoort?: string[];
  student_ids: StudentId[];
}

export function isPo(exam: { kind?: unknown } | null | undefined): boolean {
  return exam?.kind === 'po';
}

const shares = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a ?? []).some((x) => (b ?? []).includes(x));

/** Rubrics with the PO's vak, a shared schoolsoort and its jaarlaag (decision 22), by name. */
export function matchingRubrics(rubrics: readonly Rubric[], scope: PoScope): Rubric[] {
  const jl = String(scope.jaarlaag ?? '');
  return rubrics
    .filter(
      (r) =>
        r.subject === scope.subject &&
        shares(r.schoolsoort, scope.schoolsoort) &&
        jl !== '' &&
        r.jaarlagen.includes(jl),
    )
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

/** "Alleen rubrics voor Havo, Vwo · Natuurkunde · jaarlaag 3". */
export function rubricFilterNote(scope: PoScope, vakNaam: string): string {
  const ss = (scope.schoolsoort ?? []).join(', ') || 'elke schoolsoort';
  const jl = scope.jaarlaag ? `jaarlaag ${scope.jaarlaag}` : 'kies een jaarlaag';
  return `Alleen rubrics voor ${ss} · ${vakNaam} · ${jl}`;
}

/** "Onderzoeksverslag (17 + 4 bonus)": a rubric in the PO's dropdown. */
export function rubricOption(r: Rubric, t: RubricTotals): string {
  return `${r.naam} (${t.bonus ? `${t.normal} + ${t.bonus} bonus` : `${t.normal}`})`;
}

/** The PO card's line where a test shows its RTTI split (spec 4.13). */
export function rubricLine(r: Rubric | null | undefined, t: RubricTotals | null): string {
  if (!r || !t) return 'Rubric ontbreekt: geen cijfer';
  return `Rubric ${r.naam} · ${totalsText(t, 'card')}`;
}

/** The grade formula under the rubric preview (decision 16). */
export function gradeFormula(max: number): string {
  return `Cijfer = 10 × punten ÷ ${max}, minimaal 1,0 en hoogstens 10,0. Bonuspunten tellen mee in de punten, niet in het maximum.`;
}

/** The classes a PO's students come from: its vak, a shared schoolsoort, its jaarlaag. */
export function matchingClasses<C extends PoClass>(classes: readonly C[], scope: PoScope): C[] {
  return classes
    .filter(
      (c) =>
        c.subject === scope.subject &&
        String(c.jaarlaag ?? '') === String(scope.jaarlaag ?? '') &&
        shares(c.schoolsoort, scope.schoolsoort),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'nl', { numeric: true }));
}

/** Every student of the classes, with the names of their classes (in class order). */
export function classesByStudent(classes: readonly PoClass[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of classes)
    for (const s of c.student_ids) {
      const names = out.get(String(s)) ?? [];
      if (!names.includes(c.name)) names.push(c.name);
      out.set(String(s), names);
    }
  return out;
}

/** The students no projectgroep holds, in the order of `students`. */
export function unplaced(
  students: readonly StudentId[],
  groups: readonly Projectgroep[],
): string[] {
  const placed = new Set(groups.flatMap((g) => g.student_ids.map(String)));
  return students.map(String).filter((s) => !placed.has(s));
}

/** The name a projectgroep shows: its own, else "Projectgroep n" (1-based). */
export function groupName(g: Projectgroep, index: number): string {
  return g.naam?.trim() || `Projectgroep ${index + 1}`;
}

/** "2 lln" / "1 ll" (spec 4.13). */
export function memberCount(n: number): string {
  return `${n} ${n === 1 ? 'll' : 'lln'}`;
}

/** "9 projectgroepen" on the PO card. */
export function groupCountText(n: number): string {
  return `${n} ${n === 1 ? 'projectgroep' : 'projectgroepen'}`;
}

let seq = 0;
/** An opaque projectgroep id. */
export function newGroupId(): string {
  seq = (seq + 1) % 1000;
  return `pg-${Date.now().toString(36)}${seq.toString(36).padStart(2, '0')}`;
}

/** Moves a student into a group (out of any other), or out of every group with `to` null. */
export function placeStudent(
  groups: readonly Projectgroep[],
  student: StudentId,
  to: string | null,
): Projectgroep[] {
  const id = String(student);
  return groups.map((g) => {
    const rest = g.student_ids.filter((s) => String(s) !== id);
    return { ...g, student_ids: g.id === to ? [...rest, id] : rest };
  });
}

/**
 * "Willekeurig indelen…": the students in random groups of at most `size`, as even as possible
 * (10 students, size 3: 3, 3, 2, 2). `random` returns [0, 1) like Math.random.
 */
export function randomGroups(
  students: readonly StudentId[],
  size: number,
  random: () => number = Math.random,
): string[][] {
  const pool = students.map(String);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = a;
  }
  const n = Math.max(1, Math.floor(size));
  const count = Math.ceil(pool.length / n);
  const out: string[][] = Array.from({ length: count }, () => []);
  pool.forEach((s, i) => out[i % count]!.push(s));
  return out;
}

/** What is saved: empty groups dropped (spec 4.13), names trimmed, an empty name left out. */
export function groupsToSave(groups: readonly Projectgroep[]): Projectgroep[] {
  return groups
    .filter((g) => g.student_ids.length > 0)
    .map((g) => {
      const naam = g.naam?.trim();
      // A student once per group (review 22 n4).
      const ids = [...new Set(g.student_ids.map(String))];
      return { id: g.id, ...(naam ? { naam } : {}), student_ids: ids };
    });
}

/** A herkansing starts with the original's groups (decision 22): new ids, editable. */
export function copyGroups(groups: readonly Projectgroep[] | undefined): Projectgroep[] {
  return (groups ?? []).map((g) => ({ ...g, id: newGroupId(), student_ids: [...g.student_ids] }));
}

/**
 * Students who change projectgroep between `before` and `after` (decision 19: they take the new
 * group's scores). Students only added or removed do not count.
 */
export function movedStudents(
  before: readonly Projectgroep[],
  after: readonly Projectgroep[],
): string[] {
  const where = (gs: readonly Projectgroep[]) => {
    const m = new Map<string, string>();
    for (const g of gs) for (const s of g.student_ids) m.set(String(s), g.id);
    return m;
  };
  const a = where(before);
  const b = where(after);
  return [...a].filter(([s, g]) => b.has(s) && b.get(s) !== g).map(([s]) => s);
}

/**
 * Students in a group before and in none after: they leave the PO and lose its scores (user
 * 2026-11-10, review 22 M2).
 */
export function leftStudents(
  before: readonly Projectgroep[],
  after: readonly Projectgroep[],
): string[] {
  const placed = new Set(after.flatMap((g) => g.student_ids.map(String)));
  return [...new Set(before.flatMap((g) => g.student_ids.map(String)))].filter(
    (s) => !placed.has(s),
  );
}

// ── Grading: a PO is graded with its rubric, attached here (never saved) ─────────

type RubricLookup = (id: string, subject: string | undefined) => Rubric | undefined;
let lookup: RubricLookup = () => undefined;

/** Store registers where rubrics are found (its cache). */
export function setRubricLookup(fn: RubricLookup): void {
  lookup = fn;
}

/** The rubric of a PO, if it is loaded. */
export function rubricOf(exam: Pick<Exam, 'kind' | 'subject'> & { rubric_id?: unknown }) {
  return isPo(exam) && typeof exam.rubric_id === 'string'
    ? lookup(exam.rubric_id, exam.subject)
    : undefined;
}

/**
 * The exam as the grade rules read it: a PO gets `rubric` (the Rust `Exam.rubric`, attached by
 * the caller); anything else is returned as it is. Never save what this returns.
 */
export function forGrading<E extends Pick<Exam, 'kind' | 'subject'>>(exam: E): E {
  if (!isPo(exam)) return exam;
  return { ...exam, rubric: rubricOf(exam) ?? null };
}
