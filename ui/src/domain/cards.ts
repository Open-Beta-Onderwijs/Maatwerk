// SPDX-License-Identifier: AGPL-3.0-or-later

// The numbers on the student and group cards (F-07, F-08, F-09; design spec
// 4.3, 4.4). No rules here: the year average, SE average, trend and group
// statistics are computed in Rust (`maatwerk_core::numbers`, step 38; the rules
// are crates/maatwerk-grades, decisions 9, 10, 12, 13, 21, 91-93); this file
// only turns them into what the card draws.

import { formatGrade } from './format';
import type { Formats, StudentNumbers } from './numbers';
import type { AverageFormat, Stats, Trend } from './statistics';
import type { Exam } from './types';

/** One bar of a student card: one test (its best attempt), in volgnummer order. */
export interface CardBar {
  grade: number;
  /** "3 · Elektriciteit: 6,8" (the bar's tooltip). */
  title: string;
  /** A diagnostic test: grey, counts for nothing (decision 6). */
  diagnostic: boolean;
}

/** A student average as the card shows it: the core's shown value under the school's format. */
export interface ShownAverage {
  value: number;
  fails: boolean;
  fmt: AverageFormat;
}

/** A student card from the Rust numbers (step 38): what `studentGradesHtml` draws. */
export interface StudentCard {
  bars: CardBar[];
  average: ShownAverage | null;
  /** The grade of the most recent counted test (the trend's "last"). */
  last: number | null;
  trend: Trend | null;
  /** Years 4-6 only. */
  se: ShownAverage | null;
}

/** The card of one student from `VakNumbers.students[id]`; `exams` names the bars. */
export function studentCard(
  n: StudentNumbers | undefined,
  exams: readonly Exam[],
  formats: Formats,
): StudentCard {
  if (!n) return { bars: [], average: null, last: null, trend: null, se: null };
  const byId = new Map(exams.map((e) => [e.id, e]));
  const bars = n.bars.map((b) => {
    const exam = byId.get(b.examId);
    const nr = exam?.volgnummer != null ? `${exam.volgnummer} · ` : '';
    return {
      grade: b.grade,
      title: `${nr}${exam?.title ?? ''}: ${formatGrade(b.grade)}`,
      diagnostic: b.diagnostic,
    };
  });
  const shown = (s: StudentNumbers['average'], fmt: AverageFormat): ShownAverage | null =>
    s ? { value: s.shown, fails: s.fails, fmt } : null;
  return {
    bars,
    average: shown(n.average, formats.r),
    last: n.trend?.last ?? null,
    trend: n.trend,
    se: n.upper ? shown(n.se, formats.se) : null,
  };
}

/** Years 4-6: SE averages on the cards (spec 4.3, 4.4). */
export function isUpperSchool(jaarlaag: string | number | null | undefined): boolean {
  const n = Number(jaarlaag);
  return n >= 4 && n <= 6;
}

export interface GroupCardNumbers {
  /** Mean ± SD and % onvoldoende of the year averages (the line the list showed). */
  year: Stats | null;
  /** The same of the SE averages (upper school only). */
  se: Stats | null;
}

/** % onvoldoende is shown in the danger colour from 20% (spec 4.4). */
export const FAILS_ALARM = 20;

/** The trend levels as words (aria-label, spec 2.4). */
export const TREND_WORDS: Record<Trend['level'], string> = {
  strongUp: 'sterk omhoog',
  slightUp: 'licht omhoog',
  level: 'gelijk',
  slightDown: 'licht omlaag',
  strongDown: 'sterk omlaag',
};
