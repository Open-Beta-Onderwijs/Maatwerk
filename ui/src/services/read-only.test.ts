// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  READ_ONLY_SAVE_TEXT,
  isReadOnlyError,
  parseVersion,
  readOnlyBannerText,
  readOnlyError,
  requiredVersion,
} from './read-only';

describe('read-only (minimum app version)', () => {
  it('parses versions as maatwerk-core does', () => {
    expect(parseVersion('0.6.0')).toEqual([0, 6, 0]);
    expect(parseVersion('v1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('0.9.0-rc.1')).toEqual([0, 9, 0]);
    expect(parseVersion('0.10.0')).toEqual([0, 10, 0]);
    expect(parseVersion('1.x')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('requires a newer app only when the minimum is above this version', () => {
    expect(requiredVersion({}, '0.6.0')).toBeNull();
    expect(requiredVersion(null, '0.6.0')).toBeNull();
    expect(requiredVersion({ minAppVersion: '' }, '0.6.0')).toBeNull();
    expect(requiredVersion({ minAppVersion: '0.6.0' }, '0.6.0')).toBeNull();
    expect(requiredVersion({ minAppVersion: '0.5.9' }, '0.6.0')).toBeNull();
    expect(requiredVersion({ minAppVersion: '0.9.0' }, '0.6.0')).toBe('0.9.0');
    expect(requiredVersion({ minAppVersion: '0.10.0' }, '0.9.0')).toBe('0.10.0');
    expect(requiredVersion({ minAppVersion: 'next' }, '0.6.0')).toBe('next');
    expect(requiredVersion({ minAppVersion: 3 }, '0.6.0')).toBe('3');
    expect(requiredVersion({ minAppVersion: 0.5 }, '0.6.0')).toBe('0.5');
  });

  it('recognises a read-only refusal', () => {
    expect(isReadOnlyError(readOnlyError())).toBe(true);
    expect(isReadOnlyError({ code: 'read_only', message: 'x' })).toBe(true);
    expect(isReadOnlyError('read_only')).toBe(true);
    expect(isReadOnlyError({ code: 'conflict' })).toBe(false);
    expect(isReadOnlyError(new Error('read_only'))).toBe(false);
    expect(isReadOnlyError(null)).toBe(false);
  });

  it('Dutch texts name both versions', () => {
    expect(readOnlyBannerText('0.9.0', '0.6.0')).toContain('Maatwerk 0.9.0 of nieuwer');
    expect(readOnlyBannerText('0.9.0', '0.6.0')).toContain('deze versie: 0.6.0');
    expect(READ_ONLY_SAVE_TEXT).toMatch(/^Niet opgeslagen/);
  });
});
