// SPDX-License-Identifier: AGPL-3.0-or-later

// What an exam card on the Toetsen screen says (design spec 4.7, PLAN-2 decision 42): line 1
// (points, wegingen), line 2 (points per RTTI category), the mini histogram, the most given
// observaties and the average block. Pure; cards.ts makes the HTML.

import { pointTotals } from '../../domain/exam-info';
import { formatFixed, formatNumber } from '../../domain/format';
import { gradeBarColor } from '../../domain/grade-colors';
import type { RttiCategory } from '../../domain/grades';
import { isPo, rubricOf } from '../../domain/po';
import { checkRubric } from '../../domain/rubric';
import { histogram, stats } from '../../domain/statistics';
import type { Exam, Observatie } from '../../domain/types';

const RTTI: readonly RttiCategory[] = ['R', 'T1', 'T2', 'I'];
const RTTI_NAME: Record<RttiCategory, string> = {
  R: 'reproductie',
  T1: 'training',
  T2: 'transfer',
  I: 'inzicht',
};

const punten = (n: number) => `${formatNumber(n)} ${n === 1 ? 'punt' : 'punten'}`;

/** The maximum and bonus points: of the questions, or of the PO's rubric. */
function maxPoints(e: Exam): { normal: number; bonus: number } | null {
  if (!isPo(e)) return pointTotals(e.questions ?? []);
  const r = rubricOf(e);
  return r ? checkRubric(r).totals : null;
}

/**
 * Line 1: "48 punten · weging rapport 2 · SE 10"; no SE part without an SE weging; a diagnostic
 * test "30 punten · telt niet mee". A PO without its rubric says so instead of points.
 */
export function cardLine1(e: Exam): string {
  const pts = maxPoints(e);
  const head = !pts
    ? 'Rubric ontbreekt'
    : pts.bonus > 0
      ? `${punten(pts.normal)} + ${formatNumber(pts.bonus)} bonus`
      : punten(pts.normal);
  if (e.diagnostic) return `${head} · telt niet mee`;
  const parts = [head, `weging rapport ${formatNumber(e.weging ?? 1)}`];
  if (e.type === 'pta') parts.push(`SE ${formatNumber(e.weging_se ?? e.weging ?? 1)}`);
  return parts.join(' · ');
}

export interface RttiPart {
  cat: RttiCategory;
  /** "12p" */
  text: string;
}

/** Line 2: the points per RTTI category; null for a PO (rubrics can have many categories). */
export function cardRtti(e: Exam): { parts: RttiPart[]; title: string } | null {
  if (isPo(e)) return null;
  const t = pointTotals(e.questions ?? []);
  return {
    parts: RTTI.map((cat) => ({ cat, text: `${formatNumber(t.byRtti[cat])}p` })),
    title: RTTI.map((c) => `${c} (${RTTI_NAME[c]}): ${punten(t.byRtti[c])}`).join('\n'),
  };
}

export interface MiniBar {
  /** Height in px; an empty bin is a 1 px line. */
  height: number;
  /** Hex colour; null for an empty bin (the border colour). */
  color: string | null;
  /** "≥5,5 en <6,5: 3" */
  title: string;
}

/** Height of the mini histogram (spec: 104 × 46). */
export const MINI_HIST_H = 46;

/** The mini histogram: the bins of spec 3.10 with step 1 and grade colours. */
export function miniHistogram(grades: number[]): { bars: MiniBar[]; passPct: number } {
  const { bins, upper, passBin } = histogram(grades, 1);
  const max = Math.max(1, ...bins);
  const label = (i: number) => (i === upper.length - 1 ? '≤' : '<') + formatFixed(upper[i]!);
  const bars = bins.map((n, i) => ({
    height: n ? Math.round((n / max) * (MINI_HIST_H - 6)) + 2 : 1,
    color: n ? gradeBarColor(0.5 + (i + 0.5)) : null,
    title: `${i ? `≥${formatFixed(upper[i - 1]!)} en ` : ''}${label(i)}: ${n}`,
  }));
  return { bars, passPct: (passBin / bins.length) * 100 };
}

export interface TopObs {
  icon: string;
  count: number;
  /** "Eenheid vergeten: 6 leerlingen" */
  title: string;
}

/** The three most given observaties (most first, then by name); unknown ids are left out. */
export function topObservaties(
  counts: ReadonlyMap<string, number>,
  observaties: readonly Observatie[],
  limit = 3,
): TopObs[] {
  const byId = new Map(observaties.map((o) => [o.id, o]));
  return [...counts]
    .flatMap(([id, count]) => {
      const o = byId.get(id);
      return o && count > 0 ? [{ o, count }] : [];
    })
    .sort((a, b) => b.count - a.count || (a.o.naam ?? '').localeCompare(b.o.naam ?? '', 'nl'))
    .slice(0, limit)
    .map(({ o, count }) => ({
      icon: o.icon || '•',
      count,
      title: `${o.naam ?? ''}: ${count} ${count === 1 ? 'leerling' : 'leerlingen'}`,
    }));
}

/** The numbers behind a card, read from the score files. */
export interface CardNumbers {
  /** The grades that count (a Verzamelkaart: the best attempt per student). */
  grades: number[];
  /** Observatie id -> number of students. */
  obs: Map<string, number>;
}

export interface CardSummary {
  /** "24 leerlingen", "beste poging · 24 leerlingen" */
  countText: string;
  /** null without grades. */
  mean: number | null;
  meanText: string;
  sdText: string;
  failText: string;
}

/** The bottom of a card: the student count and the average block. */
export function cardSummary(numbers: CardNumbers, best: boolean): CardSummary {
  const st = stats(numbers.grades);
  const n = st?.n ?? 0;
  const count = `${n} ${n === 1 ? 'leerling' : 'leerlingen'}`;
  return {
    countText: best ? `beste poging · ${count}` : count,
    mean: st ? st.mean : null,
    meanText: st ? formatFixed(st.mean) : '—',
    sdText: st ? formatFixed(st.sd) : '—',
    failText: st ? `${st.fails}% onvoldoende` : 'nog geen cijfers',
  };
}
