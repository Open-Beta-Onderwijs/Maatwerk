// SPDX-License-Identifier: AGPL-3.0-or-later

// The name of a printed copy (ADR-0002 section 9): "Afdrukken" saves the PDF
// as rapporten/<schooljaar>/<YYYY-MM-DD HHmm> <soort> <vak> <groep> <toets>.pdf.
// The backend cleans each part for the file system.

/** What a printed copy is called; the backend's `print_pdf` argument. */
export interface PrintName {
  schooljaar: string;
  soort: 'Rapport' | 'Opdrachten' | 'Antwoordsleutel';
  vak: string;
  groep: string;
  toets: string;
}

/** At most this many group names go into a file name; more give none. */
const MAX_GROUPS = 3;

/**
 * The groep part: the distinct group names in order of appearance, joined by a
 * space. Empty for none or for more than three (a whole jaarlaag).
 */
export function printGroupPart(names: readonly (string | null | undefined)[]): string {
  const distinct = [
    ...new Set(names.map((n) => String(n ?? '').trim()).filter((n) => n && n !== '—')),
  ];
  return distinct.length <= MAX_GROUPS ? distinct.join(' ') : '';
}

/** The print name for an output of `exam` in `year`. */
export function printName(
  soort: PrintName['soort'],
  year: string,
  exam: { subject?: string | null; title?: string | null },
  groupNames: readonly (string | null | undefined)[],
): PrintName {
  return {
    schooljaar: year,
    soort,
    vak: exam.subject ?? '',
    groep: printGroupPart(groupNames),
    toets: exam.title ?? '',
  };
}
