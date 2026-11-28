// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { obsLockedValues } from './obs-locks';

// The cases of maatwerk-core `locks::tests::a_linked_observatie_keeps_what_its_tests_and_rubrics_use`
// and `a_wiskunde_test_keeps_one_wiskunde_variant`.
describe('obsLockedValues (maatwerk-core::locks::guard_obs)', () => {
  const scope = {
    jaarlagen: ['3', '4'],
    schoolsoort: ['havo', 'vwo'],
    subjects: ['nat', 'bio'],
  };

  it('locks what a linked test uses, nothing else', () => {
    const links = { tests: [{ jaarlaag: 3, schoolsoort: ['havo'], subject: 'nat' }], rubrics: [] };
    expect(obsLockedValues(links, scope)).toEqual({
      jaarlagen: ['3'],
      schoolsoort: ['havo'],
      vakken: ['nat'],
    });
  });

  it('locks what a linked rubric uses', () => {
    const links = {
      tests: [],
      rubrics: [{ jaarlagen: ['4', '5'], schoolsoort: ['vwo'], subject: 'bio' }],
    };
    expect(obsLockedValues(links, scope)).toEqual({
      jaarlagen: ['4'],
      schoolsoort: ['vwo'],
      vakken: ['bio'],
    });
  });

  it('locks nothing without links, or for a link that already did not fit', () => {
    expect(obsLockedValues({ tests: [], rubrics: [] }, scope)).toEqual({
      jaarlagen: [],
      schoolsoort: [],
      vakken: [],
    });
    const misfit = {
      tests: [{ jaarlaag: '6', schoolsoort: ['vmbo'], subject: 'schk' }],
      rubrics: [],
    };
    expect(obsLockedValues(misfit, scope)).toEqual({ jaarlagen: [], schoolsoort: [], vakken: [] });
  });

  it('an empty schoolsoort (all) has nothing to lock', () => {
    const links = {
      tests: [{ jaarlaag: '3', schoolsoort: ['havo'], subject: 'nat' }],
      rubrics: [],
    };
    expect(obsLockedValues(links, { ...scope, schoolsoort: [] }).schoolsoort).toEqual([]);
  });

  it('a wiskunde test keeps the last wiskunde variant, whichever it is', () => {
    const links = { tests: [{ jaarlaag: '3', schoolsoort: [], subject: 'wi' }], rubrics: [] };
    const wi = { jaarlagen: ['3'], schoolsoort: [], subjects: ['wisob', 'wisa'] };
    expect(obsLockedValues(links, wi).vakken).toEqual([]);
    expect(obsLockedValues(links, wi, { ...wi, subjects: ['wisa'] }).vakken).toEqual(['wisa']);
    expect(obsLockedValues(links, wi, { ...wi, subjects: ['wisob', 'nat'] }).vakken).toEqual([
      'wisob',
    ]);
    // Without a wiskunde variant to start with, the link already did not fit.
    expect(obsLockedValues(links, { ...wi, subjects: ['nat'] }).vakken).toEqual([]);
  });
});
