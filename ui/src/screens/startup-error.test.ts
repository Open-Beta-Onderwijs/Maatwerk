// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { asFolderError, startupErrorText } from './startup-error';

describe('startup error screen (review 4b m5)', () => {
  it('names the schema version of a newer data folder', () => {
    const text = startupErrorText({
      code: 'unsupported_schema',
      message: 'x',
      details: { found: '3' },
    });
    expect(text.title).toBe('Maatwerk kan de gegevensmap niet openen');
    expect(text.advice).toContain('nieuwere versie van Maatwerk (schemaversie 3)');
  });

  it('gives OneDrive advice for an I/O error and anything unknown', () => {
    for (const code of ['io', 'corrupt_json', 'unknown']) {
      const text = startupErrorText({ code, message: 'x', details: {} });
      expect(text.advice).toContain('OneDrive klaar is met synchroniseren');
    }
  });

  it('keeps the code and message of a rejected read', () => {
    const backend = Object.assign(new Error('cannot read'), { code: 'io', details: {} });
    expect(asFolderError(backend)).toEqual({ code: 'io', message: 'cannot read', details: {} });
    expect(asFolderError('boom')).toEqual({ code: 'unknown', message: 'boom', details: {} });
  });
});
