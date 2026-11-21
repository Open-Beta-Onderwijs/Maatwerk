// SPDX-License-Identifier: AGPL-3.0-or-later

// Roles and rights (step 35; ADR-0006 "Roles and rights", PLAN-2 decisions 78-80). The core
// (`maatwerk-core::rights`) refuses a score write the session may not make; this module is the
// same rule for the UI (which cells are locked) and the mock backend. Pure.

/** The role string the backend gets at login. */
export type BackendRole = 'docent' | 'beheer' | `bestuur:${string}`;

export interface GroupLike {
  subject?: string;
  docenten?: readonly (string | number)[];
  student_ids?: readonly (string | number)[];
}

export interface ExamLike {
  kind?: string;
  obs_ids?: readonly string[];
  projectgroepen?: readonly { id: string; student_ids: readonly (string | number)[] }[];
}

type Rec = Record<string, unknown> | null | undefined;

const EXAM_KEYS = ['scores', 'overrides', 'observations', 'po'] as const;
const FREE_KEYS = new Set(['_meta', 'student_id']);

/** The voorzitter and secretaris of `vak` in `school.json`. */
export function bestuurOf(
  school: { secties?: Record<string, { voorzitter?: string | null; secretaris?: string | null }> },
  vak: string,
): string[] {
  const s = school.secties?.[vak];
  return [s?.voorzitter, s?.secretaris].filter((id): id is string => !!id);
}

/** The students of the user's groups of `vak` (groups whose `docenten` name the user). */
export function ownStudentIds(
  groups: readonly GroupLike[],
  vak: string,
  userId: string,
): Set<string> {
  const out = new Set<string>();
  for (const g of groups) {
    if (g.subject?.toLowerCase() !== vak.toLowerCase()) continue;
    if (!(g.docenten ?? []).some((d) => String(d) === userId)) continue;
    for (const s of g.student_ids ?? []) out.add(String(s));
  }
  return out;
}

/** `[year, vak, student]` of `<year>/scores/<vak>/<id>.json`, else null. */
export function scoreFile(relPath: string): [string, string, string] | null {
  const m = /^([^/]+)\/scores\/([^/]+)\/([^/]+)\.json$/i.exec(relPath);
  return m ? [m[1]!, m[2]!, m[3]!] : null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const entry = (rec: Rec, key: string, exam: string): unknown => {
  const m = rec?.[key];
  return isObj(m) ? m[exam] : undefined;
};
const strList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String)
    : [];

/** Per exam id the entries that differ; `'*'` for any other key. */
export function changedExams(old: Rec, next: Rec): Set<string> {
  const out = new Set<string>();
  const keys = new Set([...Object.keys(old ?? {}), ...Object.keys(next ?? {})]);
  for (const key of keys) {
    if (FREE_KEYS.has(key)) continue;
    const a = old?.[key];
    const b = next?.[key];
    if (
      !(EXAM_KEYS as readonly string[]).includes(key) ||
      (a !== undefined && !isObj(a)) ||
      (b !== undefined && !isObj(b))
    ) {
      if (!same(a, b)) out.add('*');
      continue;
    }
    const am = (a ?? {}) as Record<string, unknown>;
    const bm = (b ?? {}) as Record<string, unknown>;
    for (const exam of new Set([...Object.keys(am), ...Object.keys(bm)]))
      if (!same(am[exam], bm[exam])) out.add(exam);
  }
  return out;
}

const nothingFor = (rec: Rec, exam: string) =>
  EXAM_KEYS.every((k) => entry(rec, k, exam) === undefined);

function keep(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
}

function clean(v: unknown): unknown {
  return isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => keep(x))) : v;
}

/** The projectgroep's part of a PO entry, empty values left out (as the core). */
export function groupGrading(rec: Rec, exam: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const scores = clean(entry(rec, 'scores', exam));
  if (keep(scores)) out.scores = scores;
  const obs = entry(rec, 'observations', exam);
  if (keep(obs)) out.observations = obs;
  const po = entry(rec, 'po', exam);
  if (isObj(po))
    for (const [k, v] of Object.entries(po))
      if (k !== 'projectgroep' && k !== 'ownLines' && keep(v)) out[`po.${k}`] = clean(v);
  for (const k of Object.keys(out)) if (!keep(out[k])) delete out[k];
  return out;
}

const sortedJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x,
  );

/** Equal as JSON values (key order does not matter, as in the core). */
const same = (a: unknown, b: unknown) => sortedJson(a) === sortedJson(b);

export interface ScoreWriteContext {
  /** The students of the user's groups of the score file's vak. */
  own: ReadonlySet<string>;
  exam: (examId: string) => ExamLike | null;
  /** Another member's score record of the same vak. */
  record: (studentId: string) => Rec;
}

/**
 * Whether a teacher (not bestuur of the vak, not the admin) may write `next` over `old` for
 * `student`: as `maatwerk_core::rights::check_json_write`.
 */
export function teacherMayWrite(
  student: string,
  old: Rec,
  next: Rec,
  ctx: ScoreWriteContext,
): boolean {
  const changed = changedExams(old, next);
  if (!changed.size || ctx.own.has(student)) return true;
  for (const examId of changed) {
    if (examId === '*' || !examChangeAllowed(student, examId, old, next, ctx)) return false;
  }
  return true;
}

function examChangeAllowed(
  student: string,
  examId: string,
  old: Rec,
  next: Rec,
  ctx: ScoreWriteContext,
): boolean {
  const exam = ctx.exam(examId);
  if (!exam) return nothingFor(next, examId);
  if (exam.kind !== 'po') {
    for (const k of ['scores', 'overrides', 'po'])
      if (!same(entry(old, k, examId), entry(next, k, examId))) return false;
    const before = strList(entry(old, 'observations', examId));
    const after = strList(entry(next, 'observations', examId));
    const listed = exam.obs_ids ?? [];
    return (
      after.every((o) => before.includes(o)) &&
      before.filter((o) => !after.includes(o)).every((o) => !listed.includes(o))
    );
  }
  const group = (exam.projectgroepen ?? []).find((g) =>
    g.student_ids.map(String).includes(student),
  );
  if (!group) return nothingFor(next, examId);
  // Absent, null and [] are the same: no own lines.
  const own = (r: Rec) => {
    const v = (entry(r, 'po', examId) as Rec)?.ownLines;
    return Array.isArray(v) && v.length === 0 ? undefined : (v ?? undefined);
  };
  if (!same(own(old), own(next))) return false;
  if (group.student_ids.some((m) => ctx.own.has(String(m)))) return true;
  const pg = (r: Rec) => (entry(r, 'po', examId) as Rec)?.projectgroep;
  if (pg(old) === group.id) return false;
  const grading = groupGrading(next, examId);
  // Clearing is a move only out of another projectgroep, or when there was nothing (review m3).
  if (!Object.keys(grading).length)
    return pg(old) !== undefined || !Object.keys(groupGrading(old, examId)).length;
  if (pg(next) !== group.id) return false;
  const want = sortedJson(grading);
  return group.student_ids
    .map(String)
    .filter((m) => m !== student)
    .some((m) => sortedJson(groupGrading(ctx.record(m), examId)) === want);
}

/**
 * Which students' scores the session may change (step 35, decision 78): `null` = every student
 * (bestuur of the vak, the admin), else the own students of the vak.
 */
export function editableStudents(
  groups: readonly GroupLike[],
  vak: string,
  userId: string,
  bestuurOrAdmin: boolean,
): Set<string> | null {
  return bestuurOrAdmin ? null : ownStudentIds(groups, vak, userId);
}

/**
 * The lock tooltip of a group heading: who may change these scores (the group's teachers, the
 * voorzitter and the secretaris), in Dutch.
 */
export function lockTitle(teachers: readonly string[], bestuur: readonly string[]): string {
  const who = [...teachers, ...bestuur.filter((b) => !teachers.includes(b))];
  if (!who.length)
    return 'Alleen-lezen: alleen de sectievoorzitter of -secretaris kan deze scores wijzigen.';
  const list =
    who.length === 1 ? who[0]! : `${who.slice(0, -1).join(', ')} of ${who[who.length - 1]!}`;
  return `Alleen-lezen: ${list} kan deze scores wijzigen.`;
}

/** The forbidden message (the core's text). */
export function forbiddenMessage(student: string): string {
  return (
    `Je mag de scores van leerling ${student} niet wijzigen: die leerling zit niet in een van ` +
    'je groepen. De docent van de leerling, de sectievoorzitter of de sectiesecretaris kan dat wel.'
  );
}
