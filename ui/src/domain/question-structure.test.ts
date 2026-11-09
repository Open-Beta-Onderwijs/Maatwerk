// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  blankQuestions,
  cascadeStructure,
  extractBoundaries,
  guessStructureMode,
  questionLabel,
  sectionLabels,
} from './question-structure';

describe('question structure', () => {
  it('numbers in each mode from the same boundaries', () => {
    const labels = (mode: string) => {
      const qs = blankQuestions(3);
      cascadeStructure(qs, [1, null, 2], mode);
      return qs.map((q) => questionLabel(q, mode));
    };
    expect(labels('roman')).toEqual(['I1', 'I2', 'II3']);
    expect(labels('alpha2')).toEqual(['A1', 'A2', 'B3']);
    expect(labels('alpha')).toEqual(['1a', '1b', '2a']);
    expect(labels('seq')).toEqual(['1', '2', '3']);
  });

  it('reads the boundaries back from numbered questions', () => {
    const qs = blankQuestions(4);
    cascadeStructure(qs, [1, null, 3, null], 'roman');
    expect(extractBoundaries(qs, 'roman')).toEqual([1, null, 3, null]);
    expect(extractBoundaries([], 'roman')).toEqual([]);
  });

  it('guesses the mode of an old exam from its first question', () => {
    expect(guessStructureMode('II')).toBe('roman');
    expect(guessStructureMode('B')).toBe('alpha2');
    expect(guessStructureMode('3')).toBe('alpha');
    expect(guessStructureMode('')).toBe('seq');
    expect(guessStructureMode(null)).toBe('seq');
  });

  it('has ten section buttons in every mode', () => {
    for (const mode of ['roman', 'alpha2', 'alpha', 'seq']) {
      expect(sectionLabels(mode)).toHaveLength(10);
    }
  });
});
