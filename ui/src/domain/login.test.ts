// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  backendRole,
  loginGroups,
  rememberedTile,
  roleLabel,
  vakTiles,
  type LoginUser,
} from './login';

const DISPLAY = { nat: 'Natuurkunde', bio: 'Biologie', schk: 'Scheikunde', wi: 'Wiskunde' };

const users: LoginUser[] = [
  { id: 'mk', voornaam: 'Mila', actief: true, vakken: ['nat', 'wi'] },
  { id: 'tw', voornaam: 'Tom', actief: true, vakken: ['nat'] },
  { id: 'old', voornaam: 'Oud', actief: false, vakken: ['bio'] },
  { id: 'admin', voornaam: 'Beheerder', actief: true, isAdmin: true, vakken: [] },
];

describe('login screen model (V-04)', () => {
  it('disables a vak without active teachers', () => {
    const tiles = vakTiles(users, DISPLAY);
    expect(tiles.map((t) => [t.key, t.disabled])).toEqual([
      ['nat', false],
      ['bio', true],
      ['schk', true],
      ['wi', false],
    ]);
    expect(tiles[0]?.emoji).toBe('⚡');
  });

  it('keeps every vak open when there are no teachers at all (the admin sets them up)', () => {
    const tiles = vakTiles(users.slice(3), DISPLAY);
    expect(tiles.every((t) => !t.disabled)).toBe(true);
  });

  it('groups teachers, the sectievoorzitter and the admin', () => {
    const groups = loginGroups(users, 'nat', 'tw');
    expect(groups.map((g) => [g.label, g.users.map((u) => u.id)])).toEqual([
      ['DOCENTEN', ['mk', 'tw']],
      ['SECTIEVOORZITTER', ['tw']],
      ['BEHEER', ['admin']],
    ]);
  });

  it('leaves out a sectievoorzitter who is not an active teacher of the vak', () => {
    expect(loginGroups(users, 'wi', 'tw').map((g) => g.role)).toEqual(['docent', 'beheer']);
    expect(loginGroups(users, 'bio', 'old').map((g) => g.role)).toEqual(['beheer']);
  });

  it('names the roles', () => {
    expect([roleLabel('docent'), roleLabel('voorzitter'), roleLabel('beheer')]).toEqual([
      'Docent',
      'Sectievoorzitter',
      'Beheerder',
    ]);
  });

  it('adds the sectiesecretaris group (step 35), never the voorzitter twice', () => {
    const groups = loginGroups(users, 'nat', 'tw', 'mk');
    expect(groups.map((g) => [g.label, g.users.map((u) => u.id)])).toEqual([
      ['DOCENTEN', ['mk', 'tw']],
      ['SECTIEVOORZITTER', ['tw']],
      ['SECTIESECRETARIS', ['mk']],
      ['BEHEER', ['admin']],
    ]);
    expect(loginGroups(users, 'nat', 'tw', 'tw').map((g) => g.role)).not.toContain('secretaris');
    expect(roleLabel('secretaris')).toBe('Sectiesecretaris');
  });

  it('maps the login role to the backend role', () => {
    expect(backendRole('docent', 'nat')).toBe('docent');
    expect(backendRole('voorzitter', 'nat')).toBe('bestuur:nat');
    expect(backendRole('secretaris', 'bio')).toBe('bestuur:bio');
    expect(backendRole('beheer', 'nat')).toBe('beheer');
  });

  it('highlights the remembered vak only when it can be chosen', () => {
    const tiles = vakTiles(users, DISPLAY);
    expect(rememberedTile(tiles, 'wi')).toBe('wi');
    expect(rememberedTile(tiles, 'bio')).toBeNull();
    expect(rememberedTile(tiles, null)).toBeNull();
  });
});
