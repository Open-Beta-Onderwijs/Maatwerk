// SPDX-License-Identifier: AGPL-3.0-or-later

// PO grading in a student's score file (step 23; PLAN-2 decisions 17, 19, 24; grade rules decision
// 28; docs/reference/data-files-v3.md "PO grading"). The projectgroep's grading (category scores,
// general and category observaties, comments, group lines) is copied into every member's file;
// own lines are the student's. Pure: the Store does the reading and the CAS writes.

import type { Rubric } from './rubric';
import type { PoGrading, PoLine, ScoreRecord } from './types';

/** What a projectgroep's members share for one PO (decision 19). */
export interface GroupGrading {
  /** Whole points per category id; a category without an entry is not scored yet. */
  scores: Record<string, number>;
  /** General observaties (as for a test: `observations[examId]`). */
  observations: string[];
  categoryObs: Record<string, string[]>;
  categoryComments: Record<string, string>;
  comment: string;
  groupLines: PoLine[];
}

export function emptyGrading(): GroupGrading {
  return {
    scores: {},
    observations: [],
    categoryObs: {},
    categoryComments: {},
    comment: '',
    groupLines: [],
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Lines as stored, damaged entries left out. */
export function linesOf(v: unknown): PoLine[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObject).map((l) => ({
    label: typeof l.label === 'string' ? l.label : '',
    value: typeof l.value === 'number' && Number.isFinite(l.value) ? l.value : null,
  }));
}

/** The group grading a record holds for `examId` (empty parts for anything missing). */
export function gradingOf(rec: ScoreRecord | null | undefined, examId: string): GroupGrading {
  const g = emptyGrading();
  const scores = rec?.scores?.[examId];
  if (isObject(scores)) {
    for (const [id, v] of Object.entries(scores)) if (typeof v === 'number') g.scores[id] = v;
  }
  g.observations = strings(rec?.observations?.[examId]);
  const po: unknown = rec?.po?.[examId];
  if (isObject(po)) {
    if (isObject(po.categoryObs))
      for (const [id, v] of Object.entries(po.categoryObs)) {
        const list = strings(v);
        if (list.length) g.categoryObs[id] = list;
      }
    if (isObject(po.categoryComments))
      for (const [id, v] of Object.entries(po.categoryComments))
        if (typeof v === 'string' && v.trim()) g.categoryComments[id] = v;
    if (typeof po.comment === 'string') g.comment = po.comment;
    g.groupLines = linesOf(po.groupLines);
  }
  return g;
}

/** A student's own lines for `examId`. */
export function ownLinesOf(rec: ScoreRecord | null | undefined, examId: string): PoLine[] {
  return linesOf(rec?.po?.[examId]?.ownLines);
}

/** The projectgroep a record's grading was copied from, if any. */
export function gradedGroupOf(rec: ScoreRecord | null | undefined, examId: string): string | null {
  const g = rec?.po?.[examId]?.projectgroep;
  return typeof g === 'string' && g ? g : null;
}

/** A canonical form, to compare two gradings (key order and empty parts do not matter). */
export function gradingKey(g: GroupGrading): string {
  const sorted = <T>(o: Record<string, T>) =>
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]);
  return JSON.stringify([
    sorted(g.scores),
    [...g.observations].sort(),
    sorted(
      Object.fromEntries(
        Object.entries(g.categoryObs)
          .filter(([, v]) => v.length)
          .map(([k, v]) => [k, [...v].sort()]),
      ),
    ),
    sorted(Object.fromEntries(Object.entries(g.categoryComments).filter(([, v]) => v.trim()))),
    g.comment.trim(),
    g.groupLines.map((l) => [l.label.trim(), l.value]),
  ]);
}

/** Whether a record's grading is empty (nothing scored, observed, written or added). */
export function isEmptyGrading(g: GroupGrading): boolean {
  return gradingKey(g) === gradingKey(emptyGrading());
}

/**
 * Writes the group's grading into `rec` for `examId` (in place): the scores, the general
 * observaties and `po[examId]`. The student's own lines are kept unless `ownLines` is given.
 * Nothing at all left: the PO's entries are removed.
 */
export function writeGrading(
  rec: ScoreRecord,
  examId: string,
  groupId: string,
  g: GroupGrading,
  ownLines?: PoLine[],
): void {
  const own = ownLines ?? ownLinesOf(rec, examId);
  rec.scores ??= {};
  if (Object.keys(g.scores).length) rec.scores[examId] = { ...g.scores };
  else delete rec.scores[examId];
  if (g.observations.length) (rec.observations ??= {})[examId] = [...g.observations];
  else if (rec.observations) delete rec.observations[examId];
  if (isEmptyGrading(g) && !own.length) {
    if (rec.po) delete rec.po[examId];
    return;
  }
  const entry: PoGrading = { projectgroep: groupId };
  const categoryObs = Object.fromEntries(Object.entries(g.categoryObs).filter(([, v]) => v.length));
  if (Object.keys(categoryObs).length) entry.categoryObs = structuredClone(categoryObs);
  const comments = Object.fromEntries(
    Object.entries(g.categoryComments).filter(([, v]) => v.trim()),
  );
  if (Object.keys(comments).length) entry.categoryComments = comments;
  if (g.comment.trim()) entry.comment = g.comment;
  entry.groupLines = g.groupLines.map((l) => ({ label: l.label, value: l.value }));
  entry.ownLines = own.map((l) => ({ label: l.label, value: l.value }));
  (rec.po ??= {})[examId] = entry;
}

/** Removes the group's grading from `rec` and keeps only the student's own lines (decision 19). */
export function clearGrading(rec: ScoreRecord, examId: string, groupId: string): void {
  writeGrading(rec, examId, groupId, emptyGrading());
}

/**
 * A PO's observaties for opdrachten genereren (step 23): the general ones (the rubric's and the
 * exam's own) and every category's, each once.
 */
export function poObsIds(
  exam: { obs_ids?: string[] },
  rubric: Pick<Rubric, 'obs_ids' | 'categories'> | null | undefined,
): string[] {
  return [
    ...new Set([
      ...(rubric?.obs_ids ?? []),
      ...(exam.obs_ids ?? []),
      ...(rubric?.categories ?? []).flatMap((c) => c.obs_ids ?? []),
    ]),
  ];
}

/** A student's observaties of a PO: the general ones and those of every category. */
export function poStudentObs(rec: ScoreRecord | null | undefined, examId: string): string[] {
  const g = gradingOf(rec, examId);
  return [...new Set([...g.observations, ...Object.values(g.categoryObs).flat()])];
}

export type GradingStatus = 'none' | 'busy' | 'done';

/**
 * Nog niet beoordeeld (no category scored), Bezig, or Beoordeeld (every normal category scored;
 * bonus and diagnostic categories may stay empty).
 */
export function gradingStatus(rubric: Rubric | null | undefined, g: GroupGrading): GradingStatus {
  const scored = (id: string) => typeof g.scores[id] === 'number';
  const cats = rubric?.categories ?? [];
  if (!cats.some((c) => scored(c.id))) return 'none';
  return cats.filter((c) => c.soort === 'normaal').every((c) => scored(c.id)) ? 'done' : 'busy';
}

export const STATUS_TEXT: Record<GradingStatus, string> = {
  none: 'Nog niet beoordeeld',
  busy: 'Bezig',
  done: 'Beoordeeld',
};

/** A line or sum in grade points: "+0,5", "−1,0"; empty for 0. */
export function signedPoints(n: number): string {
  if (!n) return '';
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(1).replace('.', ',')}`;
}

/** A typed line value ("-0,5", "+1", "0.3") as a number, or null when it is not one. */
export function parseLineValue(text: string): number | null {
  const t = text.trim().replace('−', '-').replace(',', '.');
  if (!/^[+-]?\d+(\.\d*)?$|^[+-]?\.\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The record a group's grading is taken from: a member graded in this group; else a member with
 * a grading that names no group (scores written before step 23, or by hand); else none.
 */
export function groupSource<R extends ScoreRecord>(
  records: readonly (R | null | undefined)[],
  examId: string,
  groupId: string,
): R | null {
  return (
    records.find((r): r is R => !!r && gradedGroupOf(r, examId) === groupId) ??
    records.find(
      (r): r is R =>
        !!r && gradedGroupOf(r, examId) === null && !isEmptyGrading(gradingOf(r, examId)),
    ) ??
    null
  );
}
