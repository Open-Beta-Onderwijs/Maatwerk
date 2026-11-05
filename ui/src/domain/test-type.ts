// SPDX-License-Identifier: AGPL-3.0-or-later

// Test type of an exam, for its badge and chart colour (design spec 2.5,
// V-11). Until step 18 adds `kind` and `diagnostic`, the data only tells a
// toets from an SE toets (`type: "pta"`).

export type TestKind = 'toets' | 'se' | 'po' | 'se-po' | 'diagnostic';

export function testKind(exam: { type?: string | null } | null | undefined): TestKind {
  return exam?.type === 'pta' ? 'se' : 'toets';
}

/** Classes of the `.test-badge` for an exam. */
export function testBadgeClass(exam: { type?: string | null } | null | undefined): string {
  const kind = testKind(exam);
  return kind === 'toets' ? 'test-badge' : `test-badge test-badge--${kind}`;
}

/** The colour token of a kind (chart bars read it with cssToken). */
export function testKindToken(kind: TestKind): '--accent' | '--anti' | '--grade-diagnostic-border' {
  if (kind === 'diagnostic') return '--grade-diagnostic-border';
  return kind === 'se' || kind === 'se-po' ? '--anti' : '--accent';
}
