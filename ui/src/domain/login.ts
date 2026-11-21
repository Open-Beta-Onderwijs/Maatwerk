// SPDX-License-Identifier: AGPL-3.0-or-later

// What the login screen shows (V-04, design spec 4.2): the vak tiles and, for
// the chosen vak, the users in groups (DOCENTEN, SECTIEVOORZITTER,
// SECTIESECRETARIS (step 35), BEHEER). Pure: the screen (screens/login/) draws it.

export interface LoginUser {
  id: string;
  voornaam: string;
  tussenvoegsel?: string;
  achternaam?: string;
  afkorting?: string | null;
  kleur?: string | null;
  foto?: string | null;
  isAdmin?: boolean;
  actief?: boolean;
  vakken?: string[];
  pinHash?: string | null;
}

/**
 * How a user logs in: as a teacher, as the vak's sectievoorzitter or sectiesecretaris (the same
 * rights, decision 80), or as the admin.
 */
export type LoginRole = 'docent' | 'voorzitter' | 'secretaris' | 'beheer';

export interface LoginGroup {
  role: LoginRole;
  /** The heading, as on board 5. */
  label: string;
  users: LoginUser[];
}

export interface VakTile {
  key: string;
  name: string;
  emoji: string;
  /** No teachers for this vak (and other vakken have some): shown but not clickable. */
  disabled: boolean;
}

export const VAK_EMOJI: Readonly<Record<string, string>> = {
  nat: '⚡',
  bio: '🌱',
  schk: '⚗️',
  wi: '📐',
};

const ROLE_LABEL: Record<LoginRole, string> = {
  docent: 'Docent',
  voorzitter: 'Sectievoorzitter',
  secretaris: 'Sectiesecretaris',
  beheer: 'Beheerder',
};

/** The role the backend checks at login (`maatwerk_core::rights::Role`). */
export function backendRole(role: LoginRole, vak: string): string {
  if (role === 'voorzitter' || role === 'secretaris') return `bestuur:${vak}`;
  return role;
}

/** The previous login's vak among the tiles, when it can be chosen (highlighted at the start). */
export function rememberedTile(
  tiles: readonly VakTile[],
  remembered: string | null,
): string | null {
  return tiles.find((t) => t.key === remembered && !t.disabled)?.key ?? null;
}

/** "Docent", "Sectievoorzitter", "Sectiesecretaris" or "Beheerder" (under the name in the PIN block). */
export function roleLabel(role: LoginRole): string {
  return ROLE_LABEL[role];
}

function teachersOf(users: readonly LoginUser[], vak: string): LoginUser[] {
  return users.filter((u) => u.actief && !u.isAdmin && (u.vakken ?? []).includes(vak));
}

/**
 * The tiles in `display` order. A vak without teachers is disabled, unless no
 * vak has any: then the admin (who sets up the users) must still get in.
 */
export function vakTiles(
  users: readonly LoginUser[],
  display: Readonly<Record<string, string>>,
): VakTile[] {
  const keys = Object.keys(display);
  const counts = new Map(keys.map((k) => [k, teachersOf(users, k).length]));
  const anyTeachers = [...counts.values()].some((n) => n > 0);
  return keys.map((key) => ({
    key,
    name: display[key] ?? key,
    emoji: VAK_EMOJI[key] ?? '',
    disabled: anyTeachers && counts.get(key) === 0,
  }));
}

/**
 * The user groups of `vak`: its active teachers, its sectievoorzitter and
 * sectiesecretaris (active teachers of the vak, decisions 13 and 80) and the
 * active admin. Empty groups are left out.
 */
export function loginGroups(
  users: readonly LoginUser[],
  vak: string,
  voorzitterId: string | null,
  secretarisId: string | null = null,
): LoginGroup[] {
  const teachers = teachersOf(users, vak);
  const voorzitter = teachers.find((u) => u.id === voorzitterId);
  const secretaris = teachers.find((u) => u.id === secretarisId && u.id !== voorzitterId);
  const admin = users.find((u) => u.isAdmin && u.actief);
  const groups: LoginGroup[] = [
    { role: 'docent', label: 'DOCENTEN', users: teachers },
    { role: 'voorzitter', label: 'SECTIEVOORZITTER', users: voorzitter ? [voorzitter] : [] },
    { role: 'secretaris', label: 'SECTIESECRETARIS', users: secretaris ? [secretaris] : [] },
    { role: 'beheer', label: 'BEHEER', users: admin ? [admin] : [] },
  ];
  return groups.filter((g) => g.users.length > 0);
}
