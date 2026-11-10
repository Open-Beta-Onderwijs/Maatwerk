// SPDX-License-Identifier: AGPL-3.0-or-later

// The rubric rules reach the UI through WebAssembly (step 21).

import { describe, expect, it } from 'vitest';
import seed from 'virtual:maatwerk-fixtures';
import {
  checkRubric,
  duplicateRubric,
  lockedChanges,
  newRubric,
  normaliseRubric,
  obsHasToetstype,
  obsToetstypes,
  poGrade,
  totalsText,
  usageText,
  type Rubric,
} from './rubric';

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing in the fixture');
  return v;
}

/** A rubric of the mock fixture (tools/fixtures/to-current.mjs). */
function fixtureRubric(id = 'rubric-onderzoek'): Rubric {
  const file = must(seed.files[`rubrics/${id}.json`]);
  if (!('text' in file)) throw new Error('not text');
  return JSON.parse(file.text) as Rubric;
}

describe('rubric rules (WebAssembly)', () => {
  it('the fixture rubric is valid with totals per soort', () => {
    const r = fixtureRubric();
    const check = checkRubric(r);
    expect(check.valid).toBe(true);
    expect(check.totals).toEqual({ categories: 4, normal: 17, bonus: 4, diagnostic: 3 });
    expect(totalsText(check.totals)).toBe('17 punten + 4 bonus');
    expect(totalsText(check.totals, 'card')).toBe('4 categorieën · 17 punten · bonus 4');
  });

  it('reports shared bounds and gaps per category, with the uncovered scores', () => {
    const r = fixtureRubric();
    const theorie = must(r.categories[0]);
    must(theorie.niveaus[2]).min = 3;
    must(theorie.niveaus[1]).max = 4;
    const check = checkRubric(r);
    expect(check.valid).toBe(false);
    expect(must(check.categories[0]).errors).toEqual(['Twee niveaus beginnen bij 3']);
    must(theorie.niveaus[2]).min = 7;
    expect(checkRubric(r).categories[0]).toMatchObject({
      errors: ['Niet gedekt: 5, 6'],
      gaps: [[5, 6]],
    });
  });

  it('a huge max is checked at once (review 21 M1)', () => {
    const r = fixtureRubric();
    must(r.categories[0]).max = 400_000_000;
    expect(must(checkRubric(r).categories[0]).gaps).toEqual([[9, 400_000_000]]);
  });

  it('a damaged file reads as an invalid rubric, not an exception (review 21 m5)', () => {
    const r = normaliseRubric({ id: 'x', categories: [null, { max: '4', niveaus: 'kapot' }] });
    expect(r.categories).toHaveLength(1);
    expect(r.categories[0]).toMatchObject({ max: 4, soort: 'normaal', niveaus: [] });
    expect(checkRubric(r).valid).toBe(false);
    expect(normaliseRubric(null).categories).toEqual([]);
  });

  it('a new rubric is invalid until its fields and levels are filled in', () => {
    const check = checkRubric(newRubric('nat'));
    expect(check.valid).toBe(false);
    expect(check.errors).toContain('Geef de rubric een naam');
    expect(must(check.categories[0]).errors).toContain('Naam ontbreekt');
  });

  it('lock: max and soort, not names', () => {
    const before = fixtureRubric();
    const after = structuredClone(before);
    must(after.categories[0]).naam = 'Kennis';
    expect(lockedChanges(before, after)).toEqual([]);
    must(after.categories[1]).max = 10;
    expect(lockedChanges(before, after)).toEqual([
      'Het maximum van "Uitvoering" is gewijzigd (9 → 10)',
    ]);
  });

  it('duplicate gets new ids and no _meta', () => {
    const r = fixtureRubric();
    const copy = duplicateRubric(r);
    expect(copy.naam).toBe('Onderzoeksverslag (kopie)');
    expect(copy.id).not.toBe(r.id);
    expect(copy._meta).toBeUndefined();
    expect(copy.categories.map((c) => c.id)).not.toContain(must(r.categories[0]).id);
    expect(checkRubric(copy).valid).toBe(true);
  });

  it('PO grade (decision 16)', () => {
    expect(poGrade(14, 17)).toBeCloseTo(8.235, 3);
    expect(poGrade(0, 17)).toBe(1);
    expect(poGrade(21, 17)).toBe(10);
    expect(poGrade(3, 0)).toBeNull();
  });

  it('toetstypes: absent or empty means toets', () => {
    expect(obsToetstypes({})).toEqual(['toets']);
    expect(obsToetstypes({ toetstypes: [] })).toEqual(['toets']);
    expect(obsToetstypes({ toetstypes: ['po', 'x'] })).toEqual(['po']);
    expect(obsHasToetstype({ toetstypes: ['toets', 'po'] }, 'po')).toBe(true);
    expect(obsHasToetstype({}, 'po')).toBe(false);
    expect(usageText(1)).toBe('In gebruik bij 1 PO');
    expect(usageText(2)).toBe("In gebruik bij 2 PO's");
  });
});
