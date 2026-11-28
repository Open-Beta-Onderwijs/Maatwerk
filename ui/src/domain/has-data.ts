// SPDX-License-Identifier: AGPL-3.0-or-later

// The "has data" rule of maatwerk-core::locks::has_data (step 41, decision 14), for records the
// Store already holds (projectgroepen). The core is the source: `has-data.test.ts` checks the
// same cases as its Rust test; exam and student checks ask the core (`examHasData`,
// `studentsWithData`).

type Rec = Record<string, unknown> | null | undefined;

const entry = (record: Rec, key: string, exam: string): unknown =>
  (record?.[key] as Record<string, unknown> | undefined)?.[exam];

const nonEmptyObject = (v: unknown): boolean =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;

/**
 * Whether a score record holds anything for `exam`: an entry in `scores[exam]` ("N" counts), an
 * override, a ticked observatie or PO grading. In memory "N" is `null` (C9): still an entry.
 */
export function hasData(record: Rec, exam: string): boolean {
  const observations = entry(record, 'observations', exam);
  const override = entry(record, 'overrides', exam);
  return (
    nonEmptyObject(entry(record, 'scores', exam)) ||
    (override !== undefined && override !== null) ||
    (Array.isArray(observations) && observations.length > 0) ||
    nonEmptyObject(entry(record, 'po', exam))
  );
}
