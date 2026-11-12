// SPDX-License-Identifier: AGPL-3.0-or-later

// Who and what a score modal shows: the groups taking an exam, their students, and a
// signature of both (with the observaties) so a colleague's change can tell when to reload.

import type { Exam, Group, Observatie, Student } from '../../domain/types';
import { Store } from '../../store.js';

/** Groups (in display order) whose students take this exam. */
export function examGroups(
  exam: Exam,
  year: string,
  jaarlaag: string | number = exam.jaarlaag ?? '',
): Group[] {
  const examSchoolsoort = exam.schoolsoort ?? [];
  return (Store.getGroupsSync(year) as Group[])
    .filter((g) => {
      if (String(g.jaarlaag) !== String(jaarlaag)) return false;
      if (examSchoolsoort.length === 0) return true;
      return ((g.schoolsoort as string[] | undefined) ?? []).some((ss) =>
        examSchoolsoort.includes(ss),
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupStudentsOf(group: Group, allStudents: Student[]): Student[] {
  return allStudents
    .filter((s) => group.student_ids.includes(s.id))
    .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));
}

/** The exam's observaties, by name. */
export function examObservaties(exam: Exam): Observatie[] {
  const allObs = Store.getObservatiesSync() as Observatie[];
  return (exam.obs_ids ?? [])
    .map((id) => allObs.find((o) => o.id === id))
    .filter((o): o is Observatie => !!o)
    .sort((a, b) => (a.naam ?? '').localeCompare(b.naam ?? '', 'nl'));
}

/** JSON with sorted keys, so two versions of an object compare regardless of key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** True when two versions of an exam differ only in their N-term (and version info). */
export function onlyNTermDiffers(a: Exam, b: Exam): boolean {
  const strip = (e: Exam) => {
    const rest: Partial<Exam> = { ...e };
    delete rest.n_term;
    delete rest._meta;
    return rest;
  };
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

/** Everything about the modal's layout that comes from groups, students and observaties. */
export function rosterSignature(exam: Exam, year: string): string {
  const allStudents = Store.getStudentsSync(year) as Student[];
  const allObs = Store.getObservatiesSync() as Observatie[];
  return stableStringify({
    groups: examGroups(exam, year).map((g) => [
      g.id,
      g.name,
      groupStudentsOf(g, allStudents).map((s) => [s.id, Store.fullName(s)]),
    ]),
    obs: (exam.obs_ids ?? []).map((id) => {
      const o = allObs.find((x) => x.id === id);
      return o ? [o.id, o.naam, o.icon] : null;
    }),
  });
}
