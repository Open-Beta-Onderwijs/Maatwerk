// SPDX-License-Identifier: AGPL-3.0-or-later

// Numbering of an exam's questions in the question editor: a question starts
// a new section (a "boundary") or continues the one before it, and the mode
// decides how section and number read.

import type { Question } from './types';

export const SEC_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const SEC_ALPHA2 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/** `roman` I1 I2 II3, `alpha` 1a 1b 2a, `alpha2` A1 A2 B3, `seq` 1 2 3. */
export type StructureMode = 'roman' | 'alpha' | 'alpha2' | 'seq';

export const STRUCTURE_OPTIONS: readonly { value: StructureMode; label: string }[] = [
  { value: 'roman', label: 'I1 I2 II3 … (Romeins cijfer + Volgnummer)' },
  { value: 'alpha', label: '1a 1b 2a … (Opgave + Letter)' },
  { value: 'alpha2', label: 'A1 A2 B3 … (Sectieletter + Volgnummer)' },
  { value: 'seq', label: '1, 2, 3, … (Volgnummer)' },
];

/** A question with its place in the exam. */
export type NumberedQuestion = Question & { section?: string; number?: string | number };

/** The mode of an old exam without `structureMode`, from its first question. */
export function guessStructureMode(firstSection: string | null | undefined): StructureMode {
  const first = firstSection ?? '';
  if (SEC_ROMAN.includes(first)) return 'roman';
  if (SEC_ALPHA2.includes(first)) return 'alpha2';
  return first === '' ? 'seq' : 'alpha';
}

/** The section buttons of a mode. */
export function sectionLabels(mode: string): string[] {
  if (mode === 'roman') return SEC_ROMAN;
  if (mode === 'alpha2') return SEC_ALPHA2;
  return Array.from({ length: 10 }, (_, i) => (mode === 'seq' ? '' : String(i + 1)));
}

/** The 1-based section a question is in. */
export function secIndexOf(q: NumberedQuestion, mode: string): number {
  if (mode === 'seq') return 1;
  if (mode === 'roman') {
    const idx = SEC_ROMAN.indexOf(q.section ?? '');
    return idx >= 0 ? idx + 1 : 1;
  }
  if (mode === 'alpha2') {
    const idx = SEC_ALPHA2.indexOf(q.section ?? '');
    return idx >= 0 ? idx + 1 : 1;
  }
  const n = parseInt(q.section ?? '', 10);
  return isNaN(n) ? 1 : n;
}

/** Per question: the section it starts, or null when it continues the one before it. */
export function extractBoundaries(
  questions: readonly NumberedQuestion[],
  mode: string,
): (number | null)[] {
  const b = new Array<number | null>(questions.length).fill(null);
  const first = questions[0];
  if (!first) return b;
  b[0] = 1;
  let lastSec = secIndexOf(first, mode);
  questions.forEach((q, i) => {
    const sec = secIndexOf(q, mode);
    if (i > 0 && sec !== lastSec) {
      b[i] = sec;
      lastSec = sec;
    }
  });
  return b;
}

/** Writes section and number of every question from the boundaries. */
export function cascadeStructure(
  questions: NumberedQuestion[],
  boundaries: readonly (number | null | undefined)[],
  mode: string,
): void {
  let currentSec = 1;
  let letterIdx = 0;
  questions.forEach((q, i) => {
    const b = boundaries[i];
    if (b !== null && b !== undefined) {
      if (b !== currentSec) letterIdx = 0;
      currentSec = b;
    }
    if (mode === 'seq') {
      q.section = '';
      q.number = i + 1;
    } else if (mode === 'roman') {
      q.section = SEC_ROMAN[Math.min(currentSec - 1, 14)];
      q.number = i + 1;
    } else if (mode === 'alpha2') {
      q.section = SEC_ALPHA2[Math.min(currentSec - 1, 14)];
      q.number = i + 1;
    } else {
      // alpha: 1a 1b 2a ...
      q.section = String(currentSec);
      q.number = String.fromCharCode(96 + letterIdx + 1);
      letterIdx++;
    }
  });
}

/** The label of a question: `II3`, `1a`, or `3` when numbered straight through. */
export function questionLabel(q: NumberedQuestion, mode: string): string {
  return mode === 'seq' ? String(q.number) : `${q.section}${q.number}`;
}

/** The questions of a new exam or attempt: `count` times 2 points, T1. */
export function blankQuestions(count: number): NumberedQuestion[] {
  return Array.from({ length: count }, (_, i): NumberedQuestion => ({
    id: `q${i + 1}`,
    section: 'I',
    number: i + 1,
    max_points: 2,
    rtti: 'T1',
  }));
}
