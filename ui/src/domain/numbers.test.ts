// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, readFormat, readFormats } from './numbers';

// The same cases as maatwerk_core::numbers::format (Rust).
describe('the Cijfergemiddelden setting as the core reads it', () => {
  it('missing is afronden 1', () => {
    expect(readFormats(null)).toEqual({ r: DEFAULT_FORMAT, se: DEFAULT_FORMAT });
    expect(readFormats({})).toEqual({ r: DEFAULT_FORMAT, se: DEFAULT_FORMAT });
    expect(readFormats({ gemiddelden: {} }).r).toEqual(DEFAULT_FORMAT);
  });

  it('each average has its own format', () => {
    const v = {
      snapshots: {},
      gemiddelden: {
        r: { methode: 'afkappen', decimalen: 0 },
        se: { methode: 'afronden', decimalen: 2 },
      },
    };
    expect(readFormats(v)).toEqual({
      r: { methode: 'afkappen', decimalen: 0 },
      se: { methode: 'afronden', decimalen: 2 },
    });
  });

  it('an unusable value is the default for that average only', () => {
    const v = {
      gemiddelden: { r: { methode: 'afkappen', decimalen: 7 }, se: { methode: 'afkappen' } },
    };
    expect(readFormats(v)).toEqual({
      r: DEFAULT_FORMAT,
      se: { methode: 'afkappen', decimalen: 1 },
    });
    expect(readFormats({ gemiddelden: 'afkappen' })).toEqual({
      r: DEFAULT_FORMAT,
      se: DEFAULT_FORMAT,
    });
    expect(readFormat({ methode: 'x' })).toEqual(DEFAULT_FORMAT);
    expect(readFormat({ decimalen: 1.5 })).toEqual(DEFAULT_FORMAT);
    expect(readFormat([])).toEqual(DEFAULT_FORMAT);
  });
});
