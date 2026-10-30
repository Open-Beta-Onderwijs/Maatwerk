// SPDX-License-Identifier: AGPL-3.0-or-later

// What a group import changes in existing groups (quirk D34: a re-import
// overwrites them; the user confirms an overview of old vs new first).

import type { Group, StudentId } from './types';
import { opaqueId } from './v2';

/** Group fields shown in the overview, in display order. */
export const GROUP_FIELDS = [
  'name',
  'jaarlaag',
  'subject',
  'schoolsoort',
  'subcategory',
  'docenten',
] as const;

export type GroupField = (typeof GROUP_FIELDS)[number];

export interface GroupFieldChange {
  field: GroupField;
  before: unknown;
  after: unknown;
}

export interface GroupOverwrite {
  id: string;
  /** Name of the existing group. */
  name: string;
  fields: GroupFieldChange[];
  removedStudentIds: StudentId[];
  addedStudentIds: StudentId[];
}

// Missing, null and empty values all mean "not set".
function normalize(v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return v.length ? v.map(String) : null;
  return String(v);
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

/**
 * The incoming groups that replace an existing group (same id) and change it,
 * with what changes. Incoming groups that are new or identical are left out.
 * Student ids compare as strings (C8).
 */
export function groupOverwrites(existing: Group[], incoming: Group[]): GroupOverwrite[] {
  const byId = new Map(existing.map((g) => [g.id, g]));
  const result: GroupOverwrite[] = [];
  for (const next of incoming) {
    const old = byId.get(next.id);
    if (!old) continue;
    const fields = GROUP_FIELDS.filter((f) => !same(old[f], next[f])).map((field) => ({
      field,
      before: old[field],
      after: next[field],
    }));
    const oldIds = new Set((old.student_ids ?? []).map(String));
    const newIds = new Set((next.student_ids ?? []).map(String));
    const removedStudentIds = (old.student_ids ?? []).filter((id) => !newIds.has(String(id)));
    const addedStudentIds = (next.student_ids ?? []).filter((id) => !oldIds.has(String(id)));
    if (fields.length || removedStudentIds.length || addedStudentIds.length) {
      result.push({ id: old.id, name: old.name, fields, removedStudentIds, addedStudentIds });
    }
  }
  return result;
}

/** Group names compare trimmed and case-insensitively. */
const nameKey = (name: unknown) =>
  String(name ?? '')
    .trim()
    .toLowerCase();

/**
 * Ids for imported groups (C10): an existing group with the same name in the
 * year keeps its id, so a re-import replaces it (D34) as the v1 id scheme did;
 * a new name gets a fresh opaque id. Returns new objects.
 */
export function withImportIds<T extends Pick<Group, 'name'>>(
  existing: Pick<Group, 'id' | 'name'>[],
  incoming: T[],
): (T & { id: string })[] {
  const byName = new Map(existing.map((g) => [nameKey(g.name), g.id]));
  return incoming.map((g) => {
    const key = nameKey(g.name);
    let id = byName.get(key);
    if (!id) {
      id = opaqueId('groep');
      byName.set(key, id); // the same name twice in one file is one group
    }
    return { ...g, id };
  });
}
