// SPDX-License-Identifier: AGPL-3.0-or-later

// The mock's copy of the core's edit locks (`maatwerk_core::locks`, step 41, edit-locks.md
// section 6): students, groups, exams (questions, PO scope, delete) and observaties (delete,
// scope). Same rules and Dutch texts; the core is the source and its tests are the spec. Not
// mirrored (backlog "From Step 41"): the herkansing family rule (single writes and
// `saveExamFamily`), the observatie toetstype rule, the empty-scope case of review 41 m1, and the
// fail-closed paths of unreadable files.

import { hasData } from '../../domain/has-data';
import { obsLockedValues, type ObsLinkScopes } from '../../domain/obs-locks';
import { WI_VARIANTS } from '../../domain/opdrachten';

type Obj = Record<string, unknown>;

const isWi = (v: string): boolean => WI_VARIANTS.has(v);

/** What the guard reads of the mock's files. */
export interface LockFiles {
  /** A parsed JSON file, or null when absent. */
  json(rel: string): unknown;
  /** The parsed JSON files directly in `dir`. */
  dir(dir: string): { name: string; data: unknown }[];
  /** The folders directly in `dir`. */
  folders(dir: string): string[];
  /** The school years with a folder. */
  years(): string[];
  /** Every opdracht record. */
  opdrachten(): unknown[];
}

const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ids = (v: unknown): string[] => list(v).map(String);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
/** As the core's `same`: `"3"` and `3` are the same jaarlaag; absent and null are equal. */
const same = (a: unknown, b: unknown): boolean =>
  (a ?? null) === (b ?? null) ||
  (typeof a !== 'object' && typeof b !== 'object' && String(a) === String(b)) ||
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function studentsWithData(files: LockFiles, year: string): Set<string> {
  const out = new Set<string>();
  for (const vak of files.folders(`${year}/scores`)) {
    for (const { name, data } of files.dir(`${year}/scores/${vak}`)) {
      const rec = obj(data);
      const exams = ['scores', 'overrides', 'observations', 'po'].flatMap((k) =>
        Object.keys(obj(rec[k])),
      );
      if (exams.some((e) => hasData(rec, e))) out.add(name.replace(/\.json$/, ''));
    }
  }
  return out;
}

function examHasData(files: LockFiles, year: string, vak: string, exam: string): boolean {
  return files.dir(`${year}/scores/${vak}`).some(({ data }) => hasData(obj(data), exam));
}

function attemptsOf(files: LockFiles, year: string, root: string): string[] {
  return files
    .dir(`${year}/exams`)
    .map(({ data }) => obj(data))
    .filter((e) => text(e.parent_id) === root)
    .map((e) => text(e.id));
}

function guardStudents(files: LockFiles, rel: string, year: string, next: unknown): string | null {
  const idsIn = (f: unknown) => list(obj(f).students).map((s) => String(obj(s).id));
  const kept = new Set(idsIn(next));
  const removed = idsIn(files.json(rel)).filter((id) => !kept.has(id));
  if (!removed.length) return null;
  const withData = studentsWithData(files, year);
  const scored = removed.find((id) => withData.has(id));
  if (scored)
    return `Leerling ${scored} niet verwijderd: er zijn scores ingevoerd voor deze leerling in ${year}.`;
  const inGroup = new Set(
    files.dir(`${year}/groups`).flatMap(({ data }) => ids(obj(data).student_ids)),
  );
  const grouped = removed.find((id) => inGroup.has(id));
  return grouped
    ? `Leerling ${grouped} niet verwijderd: de leerling zit in een groep van ${year}.`
    : null;
}

const GROUP_FIELDS: [string, string][] = [
  ['name', 'naam'],
  ['jaarlaag', 'jaarlaag'],
  ['schoolsoort', 'schoolsoort'],
  ['subject', 'vak'],
];

function guardGroup(files: LockFiles, rel: string, next: unknown): string | null {
  const old = files.json(rel);
  if (old === null) return null;
  const members = ids(obj(old).student_ids).length;
  if (!members) return null;
  if (next === null)
    return `Deze groep heeft ${members} leerling(en) en kan dus niet worden verwijderd.`;
  // A write that empties the group may change its fields too (the CSV import, D34).
  if (!ids(obj(next).student_ids).length) return null;
  const changed = GROUP_FIELDS.filter(([k]) => !same(obj(old)[k], obj(next)[k])).map(([, l]) => l);
  return changed.length
    ? `Deze groep heeft leerlingen: ${changed.join(', ')} ligt vast. Haal eerst de leerlingen uit de groep.`
    : null;
}

const PO_SCOPE_FIELDS: [string, string][] = [
  ['jaarlaag', 'jaarlaag'],
  ['schoolsoort', 'schoolsoort'],
  ['subcategory', 'subcategorie'],
  ['rubric_id', 'rubric'],
];

function guardExam(
  files: LockFiles,
  rel: string,
  year: string,
  id: string,
  next: unknown,
): string | null {
  const old = files.json(rel);
  if (old === null) return null;
  const o = obj(old);
  const vak = text(obj(next).subject) || text(o.subject);
  if (next === null) {
    if (attemptsOf(files, year, id).length)
      return 'Er zijn herkansingen gekoppeld aan deze toets. Verwijder die eerst.';
    return examHasData(files, year, vak, id)
      ? 'Er zijn scores ingevoerd voor deze toets, de toets kan dus niet worden verwijderd.'
      : null;
  }
  const n = obj(next);
  const qids = (e: Obj) => list(e.questions).map((q) => String(obj(q).id));
  const kept = new Set(qids(n));
  if (qids(o).some((q) => !kept.has(q)) && examHasData(files, year, vak, id))
    return 'Er zijn scores ingevoerd voor deze toets: een bestaande vraag kan niet meer worden verwijderd.';
  if (n.kind === 'po' || o.kind === 'po') {
    const changed = PO_SCOPE_FIELDS.filter(([k]) => !same(o[k], n[k])).map(([, l]) => l);
    const root = text(n.parent_id) || text(o.parent_id) || id;
    const family = [root, ...attemptsOf(files, year, root)];
    if (changed.length && family.some((e) => examHasData(files, year, vak, e)))
      return `Er zijn al scores voor deze PO: ${changed.join(', ')} ligt vast.`;
  }
  return null;
}

/** Tests (every year), rubrics and opdrachten that link the observatie. */
function obsLinks(files: LockFiles, id: string) {
  const tests = files.years().flatMap((year) =>
    files
      .dir(`${year}/exams`)
      .map(({ data }) => ({ year, e: obj(data) }))
      .filter(({ e }) => ids(e.obs_ids).includes(id)),
  );
  const rubrics = files
    .dir('rubrics')
    .map(({ data }) => obj(data))
    .filter(
      (r) =>
        ids(r.obs_ids).includes(id) ||
        list(r.categories).some((c) => ids(obj(c).obs_ids).includes(id)),
    );
  const opdrachten = files
    .opdrachten()
    .map(obj)
    .filter((o) => ids(o.observaties).includes(id));
  return { tests, rubrics, opdrachten };
}

function guardObs(files: LockFiles, rel: string, id: string, next: unknown): string | null {
  const old = files.json(rel);
  if (old === null) return null;
  const links = obsLinks(files, id);
  if (next === null) {
    const names = [
      ...links.tests.map(({ year, e }) => `toets ${text(e.title) || '?'} (${year})`),
      ...links.rubrics.map((r) => `rubric ${text(r.naam) || '?'}`),
      ...links.opdrachten.map((o) => `opdracht ${text(o.naam) || '?'}`),
    ];
    return names.length
      ? `Deze observatie is gekoppeld en kan dus niet worden verwijderd: ${names.join(', ')}.`
      : null;
  }
  // Decision 12 through the form's rule (domain/obs-locks.ts): a locked value may not go.
  const scope = (v: unknown) => {
    const x = obj(v);
    const subjects = ids(x.subjects);
    return {
      jaarlagen: ids(x.jaarlagen),
      schoolsoort: ids(x.schoolsoort),
      subjects: subjects.length ? subjects : x.subject ? [String(x.subject)] : [],
    };
  };
  const scopes: ObsLinkScopes = {
    tests: links.tests.map(({ e }) => ({
      jaarlaag: e.jaarlaag as string,
      schoolsoort: ids(e.schoolsoort),
      subject: text(e.subject),
    })),
    rubrics: links.rubrics.map((r) => ({
      jaarlagen: ids(r.jaarlagen),
      schoolsoort: ids(r.schoolsoort),
      subject: text(r.subject),
    })),
  };
  const now = scope(next);
  const locked = obsLockedValues(scopes, scope(old), now);
  const gone = [
    ...locked.jaarlagen
      .filter((j) => now.jaarlagen.length && !now.jaarlagen.includes(j))
      .map((j) => `jaarlaag ${j}`),
    ...locked.schoolsoort.filter((s) => now.schoolsoort.length && !now.schoolsoort.includes(s)),
    ...locked.vakken.filter((v) => !now.subjects.includes(v)).map((v) => `vak ${v}`),
  ];
  // Every wiskunde variant at once: a `wi` link fits none of them any more.
  const wiUsed = [...scopes.tests, ...scopes.rubrics].some((l) => l.subject === 'wi');
  if (wiUsed && scope(old).subjects.some(isWi) && !now.subjects.some(isWi))
    gone.push('vak wiskunde');
  return gone.length
    ? `Deze observatie is gekoppeld, dus dit blijft erin: ${gone.join('; ')}.`
    : null;
}

/**
 * The edit-lock refusal for writing `next` to `rel` (null = deleting it), or null. Only for the
 * files the core guards.
 */
export function lockGuard(files: LockFiles, rel: string, next: unknown): string | null {
  const students = /^(\d{4}-\d{4})\/students-\1\.json$/.exec(rel);
  if (students)
    return next === null
      ? 'Het leerlingenbestand van een schooljaar wordt niet verwijderd.'
      : guardStudents(files, rel, students[1]!, next);
  if (/^\d{4}-\d{4}\/groups\/[^/]+\.json$/.test(rel)) return guardGroup(files, rel, next);
  const exam = /^(\d{4}-\d{4})\/exams\/([^/]+)\.json$/.exec(rel);
  if (exam) return guardExam(files, rel, exam[1]!, exam[2]!, next);
  const obs = /^observaties\/([^/]+)\.json$/.exec(rel);
  if (obs) return guardObs(files, rel, obs[1]!, next);
  return null;
}
