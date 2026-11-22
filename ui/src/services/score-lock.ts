// SPDX-License-Identifier: AGPL-3.0-or-later

// The score lock of the session (step 35, PLAN-2 decisions 78-79): which students' scores the
// logged-in teacher may change, and who may change the others. The rule is
// `domain/rights.ts` (the core enforces the same, `maatwerk-core::rights`); this module feeds it
// the Store's groups, users and roles.

import { editableStudents, lockTitle } from '../domain/rights';
import type { Group } from '../domain/types';
import { Store } from '../store.js';

interface UserLike {
  id: string;
  isAdmin?: boolean;
  [key: string]: unknown;
}

export interface ScoreLock {
  /** The student's scores are read-only for this session. */
  locked(studentId: string): boolean;
  /** Nothing is locked (voorzitter, secretaris, admin). */
  readonly free: boolean;
  /** Who may change the scores of students with these teachers (a tooltip). */
  title(docenten: readonly string[]): string;
}

/** The lock for the scores of `vak` in school year `year`. */
export function scoreLock(vak: string, year: string): ScoreLock {
  const user = Store.getActiveUser() as UserLike | null;
  if (Store.isGast()) {
    return {
      free: false,
      locked: () => true,
      title: () => 'Alleen lezen: je bent ingelogd als gast.',
    };
  }
  const userId = user?.id ?? '';
  const free = !user || user.isAdmin === true || (Store.isSectiebestuurActive(vak) as boolean);
  const own = editableStudents(Store.getGroupsSync(year) as Group[], vak, userId, free);
  const users = (Store.getUsersSync() ?? []) as UserLike[];
  const name = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? (Store.fullName(u) as string) : id;
  };
  const bestuur = (
    [
      [Store.voorzitterOf(vak), 'voorzitter'],
      [Store.secretarisOf(vak), 'secretaris'],
    ] as const
  ).flatMap(([id, role]) => (id ? [{ name: name(id), role }] : []));
  return {
    free: own === null,
    locked: (id) => own !== null && !own.has(String(id)),
    title: (docenten) => lockTitle(docenten.map(name), bestuur),
  };
}

export const LOCK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
