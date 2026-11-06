// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isSchoolYear, savedActiveYear, savedLook, withPreferences } from './preferences';

describe('preferences (F-18, F-21)', () => {
  it('reads a saved look; none saved is null', () => {
    expect(savedLook({})).toBeNull();
    expect(savedLook({ preferences: null })).toBeNull();
    expect(savedLook({ preferences: { theme: 'dark', accent: 'groen' } })).toEqual({
      theme: 'dark',
      accent: 'groen',
    });
    // One valid part: the other takes its default.
    expect(savedLook({ preferences: { accent: 'paars' } })).toEqual({
      theme: 'light',
      accent: 'paars',
    });
    expect(savedLook({ preferences: { theme: 'neon', accent: 'regenboog' } })).toBeNull();
  });

  it('reads the active year only when it is a school year', () => {
    expect(savedActiveYear({ preferences: { activeYear: '2024-2025' } })).toBe('2024-2025');
    expect(savedActiveYear({ preferences: { activeYear: '2024-2026' } })).toBeNull();
    expect(savedActiveYear({ preferences: { activeYear: 2024 } })).toBeNull();
    expect(savedActiveYear(null)).toBeNull();
    expect(isSchoolYear('2025-2026')).toBe(true);
  });

  it('merges into the preferences and keeps every other field', () => {
    const user = {
      id: 'u',
      pinHash: 'x',
      future: { a: 1 },
      preferences: { theme: 'dark', editorSplit: 0.4 },
    };
    const next = withPreferences(user, { accent: 'groen' });
    expect(next).toEqual({
      id: 'u',
      pinHash: 'x',
      future: { a: 1 },
      preferences: { theme: 'dark', editorSplit: 0.4, accent: 'groen' },
    });
    expect(user.preferences).toEqual({ theme: 'dark', editorSplit: 0.4 }); // not changed
  });
});
