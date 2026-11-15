// SPDX-License-Identifier: AGPL-3.0-or-later

// Exam overview, tabs RTTI-analyse and Observaties (spec 4.6.5, 4.6.6; decisions 32, 36). RTTI:
// cards for Alle leerlingen and each group (three per row), then the RTTI-verloop of the
// jaarlaag over this school year with this test highlighted (PO's left out). Observaties: bars
// for all students, a bar per group under each observatie, and a card per observatie with a
// vertical histogram of the six grade groups (`maatwerk-grades::grade_group`), one shared scale.

import type { HistoryEntry } from '../../domain/attempts';
import { isPo } from '../../domain/po';
import { RTTI_CATS, RTTI_NAMES } from '../../domain/rtti-names';
import {
  pooledRtti,
  rttiByGradeGroup,
  rttiPercents,
  type StatAttempt,
} from '../../domain/statistics';
import type { Exam, ScoreRecord, Student } from '../../domain/types';
import { emptyHtml } from '../../overview/common';
import { obsBarsHtml, obsGroupBarsHtml } from '../../overview/obs-bars';
import { rttiCardHtml } from '../../overview/rtti-card';
import {
  rttiLegendHtml,
  rttiLineHtml,
  rttiLineModel,
  type RttiLinePoint,
} from '../../overview/rtti-line';
import { esc } from '../../utils/html';
import { GRADE_GROUP_LABELS, gradeGroupIdx as gradeGroupOf } from '../../utils/grades';
import { groupColor } from './charts';
import { hasPoints, type ExamOverviewData } from './data';

const pctsOf = (list: StatAttempt[]) => rttiPercents(pooledRtti(list), [...RTTI_CATS]);

/** The cards and an empty verloop card; `fillVerloop` draws the chart once the data is there. */
export function rttiHtml(data: ExamOverviewData): string {
  if (!hasPoints(data.attempts)) return emptyHtml('Geen RTTI data beschikbaar.');
  const cards = [
    rttiCardHtml({ title: 'Alle leerlingen', pcts: pctsOf(data.attempts) }),
    ...data.groups
      .filter((g) => hasPoints(g.attempts))
      .map((g) => rttiCardHtml({ title: g.group.name, pcts: pctsOf(g.attempts) })),
  ].join('');
  return (
    `<div class="ov-stack">${rttiLegendHtml()}<div class="ov-grid ov-grid--3 ov-grid--flush">${cards}</div>` +
    `<div class="ov-card xo-verloop"><div class="ov-card__head"><h3 class="ov-card__h3">RTTI-verloop dit schooljaar, jaarlaag ${esc(String(data.exam.jaarlaag ?? ''))}</h3>` +
    `<span class="ov-card__spacer"></span><span class="ov-meanline">deze toets gemarkeerd</span></div>${rttiLegendHtml()}` +
    `<div class="xo-verloop__chart"><p class="hint">Laden…</p></div>` +
    `<div class="ov-note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>` +
    `<span>Praktische opdrachten hebben geen RTTI-verdeling en staan niet in het verloop.</span></div></div>` +
    rttiGradeGroupsHtml(data) +
    `</div>`
  );
}

/** "(n)" per grade group in a legend: the group sizes of the graded students. */
function gradeGroupLegend(grades: readonly number[]): string {
  const sizes = Array(6).fill(0) as number[];
  for (const g of grades) sizes[gradeGroupOf(g)]!++;
  return GRADE_GROUP_LABELS.map(
    (l, i) =>
      `<span><span class="ov-legend__key" data-bg="${GRADE_GROUP_COLORS[i]}"></span>${esc(l)} <span class="ov-meanline">(${sizes[i]})</span></span>`,
  ).join('');
}

/** A card per grade-group histogram: a bar per grade group, `value` its height in 0-100. */
function gradeGroupCard(
  headHtml: string,
  label: string,
  bars: { text: string; v: number | null; title: string }[],
): string {
  const cols = bars
    .map(
      (b, i) =>
        `<div class="ov-hist__col" title="${esc(b.title)}"><span class="ov-hist__n${b.v ? '' : ' ov-hist__n--zero'}">${esc(b.text)}</span>` +
        `<div class="ov-hist__bar${b.v ? '' : ' ov-hist__bar--empty'}" data-h="${b.v ? Math.round(b.v * 0.92) + 4 : 2}px"${b.v ? ` data-bg="${GRADE_GROUP_COLORS[i]}"` : ''}></div></div>`,
    )
    .join('');
  const labels = GRADE_GROUP_LABELS.map((l) => `<span>${esc(l)}</span>`).join('');
  return (
    `<div class="ov-card ov-card--small"><div class="ov-card__head">${headHtml}</div>` +
    `<div class="ov-hist__bars xo-gg" role="img" aria-label="${esc(label)}" data-h="120px">${cols}</div>` +
    `<div class="ov-hist__labels xo-gg__labels">${labels}</div></div>`
  );
}

/**
 * "RTTI per cijfergroep" (user 2026-11-15, back from the old overview): a card per RTTI
 * category with the pooled percentage of each grade group, laid out as "Observaties per
 * cijfergroep". `rttiByGradeGroup` is the core's (pooled points of the normal questions).
 */
export function rttiGradeGroupsHtml(data: ExamOverviewData): string {
  const graded = data.attempts.filter((a) => a.grade !== null);
  if (!graded.length) return '';
  const pcts = rttiByGradeGroup(graded).map((p) => rttiPercents(p, [...RTTI_CATS]));
  const cards = RTTI_CATS.map((c, ci) =>
    gradeGroupCard(
      `<span class="ov-rtti-key ov-rtti--${c.toLowerCase()}" aria-hidden="true"></span><span class="ov-card__title">${c} <span class="ov-rtti-legend__name">${RTTI_NAMES[c]}</span></span>`,
      `${c} ${RTTI_NAMES[c]} per cijfergroep`,
      pcts.map((row, gi) => {
        const v = row[ci] ?? null;
        return {
          v,
          text: v === null ? '—' : `${v}%`,
          title: `${GRADE_GROUP_LABELS[gi]}: ${v === null ? 'geen punten' : `${v}%`}`,
        };
      }),
    ),
  ).join('');
  return (
    `<div class="ov-card__head xo-gg__head"><h3 class="ov-card__h3">RTTI per cijfergroep</h3><span class="ov-card__spacer"></span><div class="ov-legend ov-legend--inline">${gradeGroupLegend(data.grades)}</div><span class="ov-meanline">· percentage van de punten; tussen haakjes de groepsgrootte</span></div>` +
    `<div class="ov-grid ov-grid--4 ov-grid--flush">${cards}</div>`
  );
}

/**
 * The verloop's points: per original test of the jaarlaag (no PO's), by volgnummer, the RTTI of
 * every student's attempt of that test, pooled. Tests without RTTI points are left out.
 */
export async function verloopPoints(
  exams: Exam[],
  jaarlaag: string,
  students: Student[],
  scoresOf: (s: Student) => Promise<ScoreRecord | null>,
): Promise<RttiLinePoint[]> {
  const tests = exams
    .filter((e) => String(e.jaarlaag) === jaarlaag && !e.parent_id && !isPo(e))
    .sort((a, b) => (a.volgnummer ?? 0) - (b.volgnummer ?? 0));
  const recs: (ScoreRecord | null)[] = [];
  for (const s of students) recs.push(await scoresOf(s));
  return tests
    .map((exam) => {
      const entries: HistoryEntry[] = recs
        .map((rec) => rec?.scores?.[exam.id])
        .filter((qs): qs is NonNullable<typeof qs> => !!qs)
        .map((questionScores) => ({ exam, questionScores }));
      return { exam, pcts: rttiPercents(pooledRtti(entries), [...RTTI_CATS]) };
    })
    .filter((p) => p.pcts.some((v) => v !== null));
}

export function verloopHtml(points: RttiLinePoint[], width: number, currentId: string): string {
  if (!points.length) return '<p class="hint">Geen data voor vergelijking.</p>';
  return rttiLineHtml(
    rttiLineModel(points, Math.max(400, Math.round(width)), 240, currentId),
    'RTTI-verloop over het schooljaar',
  );
}

/** Colours of the six grade groups (spec 4.6.6). */
export const GRADE_GROUP_COLORS = [
  '#C62828',
  '#E5736B',
  '#F2C94C',
  '#CFC255',
  '#A6C266',
  '#6DBE77',
];

export function observatiesHtml(data: ExamOverviewData): string {
  const { observaties, obs } = data;
  if (!observaties.length) return emptyHtml('Geen observaties gekoppeld aan deze toets.');
  if (!observaties.some((o) => obs[o.id]!.count > 0))
    return emptyHtml('Nog geen observaties ingevoerd voor deze toets.');
  const nScored = data.attempts.length;
  const all = obsBarsHtml(
    observaties.map((o) => ({
      obs: o,
      n: obs[o.id]!.count,
      of: nScored,
    })),
  );
  const groups = data.groups;
  const perGroup = groups.length
    ? `<div class="ov-card"><div class="ov-card__head"><h3 class="ov-card__h3">Observaties per groep</h3><span class="ov-card__spacer"></span><span class="ov-meanline">percentage van de groep</span></div>` +
      obsGroupBarsHtml(
        groups.map((g, i) => ({ name: g.group.name, color: groupColor(i, groups.length) })),
        observaties.map((o) => ({
          obs: o,
          values: groups.map((g) => {
            const n = obs[o.id]!.byGroup[g.group.id] ?? 0;
            return { n, of: g.attempts.length };
          }),
        })),
      ) +
      `</div>`
    : '';
  // Per grade group: the group sizes in the legend, one scale for every card.
  const sizes = Array(6).fill(0) as number[];
  for (const g of data.grades) sizes[gradeGroupOf(g)]!++;
  const max = Math.max(1, ...observaties.flatMap((o) => obs[o.id]!.byGradeGroup));
  const legend = GRADE_GROUP_LABELS.map(
    (l, i) =>
      `<span><span class="ov-legend__key" data-bg="${GRADE_GROUP_COLORS[i]}"></span>${esc(l)} <span class="ov-meanline">(${sizes[i]})</span></span>`,
  ).join('');
  const cards = observaties
    .map((o) => {
      const counts = obs[o.id]!.byGradeGroup;
      const bars = counts
        .map(
          (n, i) =>
            `<div class="ov-hist__col" title="${esc(`${GRADE_GROUP_LABELS[i]}: ${n} ${n === 1 ? 'leerling' : 'leerlingen'}`)}"><span class="ov-hist__n${n ? '' : ' ov-hist__n--zero'}">${n}</span>` +
            `<div class="ov-hist__bar${n ? '' : ' ov-hist__bar--empty'}" data-h="${n ? Math.round((n / max) * 92) + 4 : 2}px"${n ? ` data-bg="${GRADE_GROUP_COLORS[i]}"` : ''}></div></div>`,
        )
        .join('');
      const labels = GRADE_GROUP_LABELS.map((l) => `<span>${esc(l)}</span>`).join('');
      return (
        `<div class="ov-card ov-card--small"><div class="ov-card__head"><span class="ov-obs__icon" aria-hidden="true">${esc(o.icon ?? '')}</span><span class="ov-card__title">${esc(o.naam ?? '')}</span></div>` +
        `<div class="ov-hist__bars xo-gg" role="img" aria-label="${esc(`${o.naam ?? ''} per cijfergroep`)}" data-h="120px">${bars}</div>` +
        `<div class="ov-hist__labels xo-gg__labels">${labels}</div></div>`
      );
    })
    .join('');
  return (
    `<div class="ov-stack">` +
    `<div class="ov-card"><div class="ov-card__head"><h3 class="ov-card__h3">Observaties, alle leerlingen</h3><span class="ov-card__spacer"></span><span class="ov-meanline">percentage van de ${nScored} leerlingen met een score</span></div>${all}</div>` +
    perGroup +
    `<div class="ov-card__head xo-gg__head"><h3 class="ov-card__h3">Observaties per cijfergroep</h3><span class="ov-card__spacer"></span><div class="ov-legend ov-legend--inline">${legend}</div><span class="ov-meanline">· aantal leerlingen; tussen haakjes de groepsgrootte</span></div>` +
    `<div class="ov-grid ov-grid--3 ov-grid--flush">${cards}</div></div>`
  );
}
