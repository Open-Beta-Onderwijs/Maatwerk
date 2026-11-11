// SPDX-License-Identifier: AGPL-3.0-or-later

// Test type of an exam, for its badge, pill and chart colour (design spec 2.5,
// V-11). A diagnostic test is never an SE test (PLAN-2 decisions 6 and 14).

export type TestKind = 'toets' | 'se' | 'po' | 'se-po' | 'diagnostic';

/** The fields of an exam that decide its type. */
export interface TestTypeFields {
  type?: string | null;
  kind?: string | null;
  diagnostic?: boolean | null;
}

export function testKind(exam: TestTypeFields | null | undefined): TestKind {
  if (exam?.diagnostic) return 'diagnostic';
  const se = exam?.type === 'pta';
  if (exam?.kind === 'po') return se ? 'se-po' : 'po';
  return se ? 'se' : 'toets';
}

/** Classes of the `.test-badge` for a kind. */
export function testKindBadgeClass(kind: TestKind): string {
  return kind === 'toets' ? 'test-badge' : `test-badge test-badge--${kind}`;
}

/** Classes of the `.test-badge` for an exam. */
export function testBadgeClass(exam: TestTypeFields | null | undefined): string {
  return testKindBadgeClass(testKind(exam));
}

/** The kinds in the order of the Toetsen legend, with their pill text (spec 4.7). */
export const TEST_KINDS: readonly { kind: TestKind; label: string }[] = [
  { kind: 'toets', label: 'Toets' },
  { kind: 'po', label: 'Praktische opdracht' },
  { kind: 'se', label: 'SE-toets' },
  { kind: 'se-po', label: 'SE praktische opdracht' },
  { kind: 'diagnostic', label: 'Diagnostisch' },
];

export function testKindLabel(kind: TestKind): string {
  return TEST_KINDS.find((k) => k.kind === kind)?.label ?? '';
}

/** The colour token of a kind (chart bars read it with cssToken). */
export function testKindToken(kind: TestKind): '--accent' | '--anti' | '--grade-diagnostic-border' {
  if (kind === 'diagnostic') return '--grade-diagnostic-border';
  return kind === 'se' || kind === 'se-po' ? '--anti' : '--accent';
}
