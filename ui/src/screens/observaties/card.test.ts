// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { Exam, Opdracht } from '../../domain/types';
import { obsCardHtml, obsDeleteBlock, obsUse, type ObsFields } from './card';
import { filterObservaties, type ObsFilters } from './filter';

const exam = (id: string, obs: string[], parent?: string) =>
  ({ id, obs_ids: obs, ...(parent ? { parent_id: parent } : {}) }) as unknown as Exam;

describe('obsUse', () => {
  const use = obsUse(
    [exam('t1', ['a', 'b']), exam('t2', ['a', 'a']), exam('t1-h', ['a', 'b'], 't1')],
    [
      { id: 'o1', naam: 'Zwaartekracht', observaties: ['a'] },
      { id: 'o2', naam: 'Atomen', observaties: ['a', 'c'] },
    ] as Opdracht[],
  );

  it('counts tests once each, resits with their original', () => {
    expect(use('a').tests).toBe(2);
    expect(use('b').tests).toBe(1);
    expect(use('c').tests).toBe(0);
  });

  it('lists the linked opdrachten alphabetically', () => {
    expect(use('a').opdrachten).toEqual(['Atomen', 'Zwaartekracht']);
    expect(use('x')).toEqual({ tests: 0, opdrachten: [] });
  });
});

describe('obsDeleteBlock', () => {
  it('keeps the rule of today: a test first, then a rubric', () => {
    expect(obsDeleteBlock(true, true)).toMatch(/toets/);
    expect(obsDeleteBlock(false, true)).toMatch(/rubric/);
    expect(obsDeleteBlock(false, false)).toBeNull();
  });
});

describe('obsCardHtml', () => {
  const o: ObsFields = {
    id: 'obs-1',
    naam: 'Rekenfout <x>',
    icon: '🧮',
    uitleg: 'Verkeerd uitgerekend.',
    schoolsoort: ['Havo', 'Vwo'],
    jaarlagen: [4, 5],
    toetstypes: ['toets', 'po'],
  };
  const all = (html: string, cls: string) =>
    [...html.matchAll(new RegExp(`class="${cls}"[^>]*>([^<]*)<`, 'g'))].map((m) => m[1]);

  it('shows the pills, jaarlagen and use', () => {
    const html = obsCardHtml(o, { tests: 1, opdrachten: ['Atomen', 'Machten'] });
    expect(html).toContain('data-action="edit-obs" data-id="obs-1">Rekenfout &lt;x&gt;</button>');
    expect(all(html, 'icard-pill icard-pill--(?:toets|po)')).toEqual(['Toets', 'PO']);
    expect(all(html, 'icard-jl icard-jl--on')).toEqual(['4', '5']);
    expect(all(html, 'icard-ss')).toEqual(['Havo, Vwo']);
    expect(html).toContain('<span class="icard-ss" title="Havo, Vwo">');
    expect(all(html, 'icard-use')).toEqual(['1 toets', '· 2 opdrachten']);
    expect(html).toContain('title="Gekoppelde opdrachten: Atomen, Machten"');
  });

  it('says "nog niet gebruikt" when nothing links it', () => {
    const html = obsCardHtml({ ...o, toetstypes: undefined }, { tests: 0, opdrachten: [] });
    expect(all(html, 'icard-use')).toEqual(['nog niet gebruikt']);
    expect(all(html, 'icard-pill icard-pill--(?:toets|po)')).toEqual(['Toets']);
  });
});

describe('filterObservaties', () => {
  const list: ObsFields[] = [
    { id: '1', naam: 'beta', toetstypes: ['po'], schoolsoort: ['Havo'], jaarlagen: [4] },
    { id: '2', naam: 'Alfa', schoolsoort: ['Vwo'], jaarlagen: [2] },
    { id: '3', naam: 'gamma', subjects: ['nat'] },
  ];
  const base: ObsFilters = {
    toetstype: 'alle',
    subject: 'nat',
    schoolsoort: new Set(['Havo', 'Vwo']),
    jaarlagen: new Set(['1', '2', '3', '4', '5', '6']),
    jaarlagenKlas: new Set(),
    ownGroups: null,
  };
  const ids = (f: Partial<ObsFilters>) =>
    filterObservaties(list, { ...base, ...f }).map((o) => o.id);

  it('sorts by name, case-insensitive', () => {
    expect(ids({})).toEqual(['2', '1', '3']);
  });

  it('filters on toetstype, schoolsoort and jaarlaag; empty fields pass', () => {
    expect(ids({ toetstype: 'po' })).toEqual(['1']);
    expect(ids({ toetstype: 'toets' })).toEqual(['2', '3']);
    expect(ids({ schoolsoort: new Set(['Vwo']) })).toEqual(['2', '3']);
    expect(ids({ jaarlagen: new Set(['4']) })).toEqual(['1', '3']);
  });

  it('wiskunde: klas 1-6 and OB / WisX', () => {
    const wi = { subject: 'wi', jaarlagenKlas: new Set(['1', '2', '3', '4', '5', '6']) };
    expect(ids({ ...wi, jaarlagen: new Set(['OB']) })).toEqual(['2', '3']);
    expect(ids({ ...wi, jaarlagen: new Set(['WisB']) })).toEqual(['1', '3']);
    expect(ids({ ...wi, jaarlagen: new Set(['OB']), jaarlagenKlas: new Set(['3']) })).toEqual([
      '3',
    ]);
  });

  it('eigen groepen: vak, schoolsoort and jaarlaag of one of the groups', () => {
    const own = [{ subject: 'nat', schoolsoort: ['Havo'], jaarlaag: 4 }];
    const withSubject = list.map((o) => ({ ...o, subjects: ['nat'] }));
    expect(filterObservaties(withSubject, { ...base, ownGroups: own }).map((o) => o.id)).toEqual([
      '1',
    ]);
  });
});
