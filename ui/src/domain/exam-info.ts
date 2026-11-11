// SPDX-License-Identifier: AGPL-3.0-or-later

// What the Toetsen screen and the test modals say about an exam: attempt code
// and label, the meta line, the points line and the RTTI totals with
// percentages (design spec 4.7, 4.11), and how the original's observaties reach
// its attempts (F-12).

import { clean, round0 } from './core';
import { formatNTerm, formatNumber } from './format';
import { qKind, type RttiCategory } from './grades';
import type { Exam, Question } from './types';

const RTTI: readonly RttiCategory[] = ['R', 'T1', 'T2', 'I'];

export interface PointTotals {
  /** Points of the normal questions: the maximum, as the grade rules count it (decision 5). */
  normal: number;
  bonus: number;
  byRtti: Record<RttiCategory, number>;
}

export function pointTotals(questions: readonly Question[]): PointTotals {
  const sum = (filter: (q: Question) => boolean) =>
    clean(questions.filter(filter).reduce((s, q) => s + (Number(q.max_points) || 0), 0));
  const normal = (q: Question) => qKind(q) === 'normal';
  return {
    normal: sum(normal),
    bonus: sum((q) => qKind(q) === 'bonus'),
    byRtti: {
      R: sum((q) => normal(q) && q.rtti === 'R'),
      T1: sum((q) => normal(q) && q.rtti === 'T1'),
      T2: sum((q) => normal(q) && q.rtti === 'T2'),
      I: sum((q) => normal(q) && q.rtti === 'I'),
    },
  };
}

/** "38p · R: 8p · T1: 18p": the points line of a card; categories without points are left out. */
export function pointsLine(questions: readonly Question[]): string {
  const t = pointTotals(questions);
  const total = formatNumber(t.normal);
  const head = t.bonus > 0 ? `${total}p (+${formatNumber(t.bonus)}p bonus)` : `${total}p`;
  const cats = RTTI.filter((c) => t.byRtti[c] > 0).map(
    (c) => `${c}: ${formatNumber(t.byRtti[c])}p`,
  );
  return [head, ...cats].join(' · ');
}

/**
 * "12 vragen · 41 punten · R: 3 (7%) · …": the footer of the question editor. The percentages are
 * of the normal points, whole, and need not add up to 100.
 */
export function questionSummary(questions: readonly Question[]): string {
  const t = pointTotals(questions);
  const n = questions.length;
  const points = `${formatNumber(t.normal)} punten${t.bonus > 0 ? ` (+${formatNumber(t.bonus)} bonus)` : ''}`;
  const cats = RTTI.map((c) => {
    const pct = t.normal > 0 ? round0((100 * t.byRtti[c]) / t.normal) : 0;
    return `${c}: ${formatNumber(t.byRtti[c])} (${pct}%)`;
  });
  return [`${n} ${n === 1 ? 'vraag' : 'vragen'}`, points, ...cats].join(' · ');
}

/** The meta line of a card; a diagnostic test says it does not count instead of its wegingen. */
export function metaLine(e: Exam): string {
  const parts: string[] = [];
  if (e.schoolsoort?.length) parts.push(e.schoolsoort.join(' / '));
  if (e.periode) parts.push(`Periode ${e.periode}`);
  if (e.diagnostic) {
    parts.push('telt niet mee voor rapport of SE');
    return parts.join(' · ');
  }
  parts.push(`N-term ${formatNTerm(e.n_term ?? 1)}`);
  parts.push(`Weging ${formatNumber(e.weging ?? 1)}`);
  if (e.type === 'pta') parts.push(`Weging SE ${formatNumber(e.weging_se ?? e.weging ?? 1)}`);
  return parts.join(' · ');
}

/** The fields of an exam that name an attempt. */
export interface AttemptFields {
  parent_id?: string;
  volgnummer?: number;
  description?: string;
}

/** The code on an attempt's badge: `501`, or `501-I` for a resit (first letter of its description). */
export function attemptCode(e: AttemptFields): string {
  const nr = String(e.volgnummer ?? '');
  if (!e.parent_id) return nr;
  const letter = (e.description ?? '').trim().charAt(0).toUpperCase() || '?';
  return `${nr}-${letter}`;
}

/** The label of an attempt on the tree: Origineel, Inhaal, Herkansing or its own description. */
export function attemptLabel(e: AttemptFields): string {
  if (!e.parent_id) return 'Origineel';
  const description = (e.description ?? '').trim();
  if (description === 'INHAAL') return 'Inhaal';
  if (description === 'HERKANSING') return 'Herkansing';
  return description || 'Poging';
}

/**
 * A resit's observaties after its original's changed: what the original lost goes, what it gained
 * comes. Observaties only the resit has (from before format v3, migration "original's + own") stay.
 * Applying it twice gives the same result, so a save that failed halfway can be repeated.
 */
export function resitObsIds(
  resit: readonly string[],
  before: readonly string[],
  after: readonly string[],
): string[] {
  const kept = resit.filter((id) => !before.includes(id) || after.includes(id));
  return [...kept, ...after.filter((id) => !kept.includes(id))];
}
