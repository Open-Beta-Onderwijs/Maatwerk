// SPDX-License-Identifier: AGPL-3.0-or-later

// Exam badge colour by type. Replaced by the test-type badge (V-11) in
// step 13 sub-task 4; grade colours are in domain/grade-colors.ts.

/**
 * Returns the badge/bar colour for an exam based on its type field.
 *   'pta' → red, 'po' → amber/yellow, anything else → blue
 */
export function examTypeColor(exam) {
  if (exam?.type === 'pta') return '#d9534f';
  if (exam?.type === 'po') return '#f0ad4e';
  return '#4A90D9'; // regular toets
}
