// SPDX-License-Identifier: AGPL-3.0-or-later

// Profile, tab Cijferverloop (spec 4.15.1, board 44). "Cijferverloop": a bar per test that
// counts (Onderbouw / Bovenbouw), grouped per school year with a label and a divider, the bar in
// the test type colour (PO striped, diagnostic grey with a border), the grade above it in the
// grade colour, badges under the axis, gridlines 2-10 and a dashed 5,5 line; no toetsgemiddelde.
// "Ten opzichte van het toetsgemiddelde" (a school year): per test a 1-10 track with the test
// average (◇) and its ±1 SD band, the student's dot and a green or red line between them.
// "Gemiddeld cijfer per jaar": the same per school year (and the examendossier) against the
// jaarlaag.

import { attemptCode } from '../../domain/exam-info';
import { formatFixed, formatGrade, formatHint, formatShown } from '../../domain/format';
import { gradeTextColor, PASS, shownTextColor } from '../../domain/grade-colors';
import { poLinesSum } from '../../domain/grades';
import { groupName, isPo, rubricOf } from '../../domain/po';
import { signedPoints } from '../../domain/po-grading';
import type { Rubric } from '../../domain/rubric';
import type { Shown } from '../../domain/numbers';
import { shownDifference, type AverageFormat, type Stats } from '../../domain/statistics';
import { testKind } from '../../domain/test-type';
import { axisPct, examBadgeHtml, kindClass } from '../../overview/common';
import type { TipContent } from '../../overview/tooltip';
import { esc } from '../../utils/html';
import type { ProfileTest, YearComparison } from './data';

export type Bouw = 'onderbouw' | 'bovenbouw';

/** Bar area height (px) and the room above a 10 for its label. */
const CH = 240;
const barH = (g: number) => Math.round((g / 10) * (CH - 22));

export function toggleHtml(name: string, options: [string, string][], current: string): string {
  return `<div class="btn-toggle-group" role="group">${options
    .map(
      ([v, label]) =>
        `<button type="button" class="tog-btn pf-tog${v === current ? ' selected' : ''}" data-${name}="${esc(v)}" aria-pressed="${v === current}">${esc(label)}</button>`,
    )
    .join('')}</div>`;
}

export const inBouw = (t: ProfileTest, bouw: Bouw): boolean => {
  const jl = parseInt(String(t.exam.jaarlaag ?? '0'), 10);
  return bouw === 'onderbouw' ? jl >= 1 && jl <= 3 : jl >= 4 && jl <= 6;
};

const signed = (n: number) => signedPoints(n) || formatFixed(0);

/** The tooltip of a bar: badge and title, the grade, a PO's build-up and category scores. */
export function barTip(t: ProfileTest): TipContent {
  const g = formatGrade(t.res.grade);
  const head = `${examBadgeText(t)}${t.exam.title ?? ''}`;
  if (t.exam.diagnostic)
    return { head, sub: `Cijfer ${g} · diagnostisch, telt niet mee`, obs: null };
  if (isPo(t.exam)) {
    const rubric = rubricOf(t.exam) as Rubric | undefined;
    const groups = t.exam.projectgroepen ?? [];
    const gi = groups.findIndex((pg) => pg.id === t.po?.projectgroep);
    const group = poLinesSum(t.po?.groupLines ?? []);
    const own = poLinesSum(t.po?.ownLines ?? []);
    const sub =
      `Cijfer ${g}` +
      (gi >= 0
        ? ` · projectgroep ${groupName(groups[gi]!, gi)} ${formatGrade(t.res.rubricGrade ?? null)}`
        : '') +
      (t.po?.groupLines?.length ? ` · groep ${signed(group)}` : '') +
      (t.po?.ownLines?.length ? ` · persoonlijk ${signed(own)}` : '');
    const rows = (rubric?.categories ?? []).map((c): [string, string] => {
      const v = t.questionScores[c.id];
      const kind = c.soort === 'normaal' ? '' : ` (${c.soort})`;
      return [`${c.naam}${kind}`, `${typeof v === 'number' ? v : '—'} / ${c.max ?? 0}`];
    });
    return { head, sub, obs: null, rows };
  }
  const se = t.exam.type === 'pta' ? ' · telt mee voor het examendossier' : '';
  return { head, sub: `Cijfer ${g}${se}`, obs: null };
}

const examBadgeText = (t: ProfileTest) => {
  const code = attemptCode(t.exam);
  return code ? `${code} ` : '';
};

/** The bar chart of the tests that count in one bouw; `key` per bar for its tooltip. */
export function barsHtml(tests: ProfileTest[], yearLabel: (yr: string) => string): string {
  if (!tests.length) return '<p class="hint ov-empty">Geen cijfers in deze bouw.</p>';
  const n = tests.length;
  const groups: { year: string; start: number; count: number }[] = [];
  tests.forEach((t, i) => {
    const yr = t.exam.academic_year ?? '';
    const last = groups[groups.length - 1];
    if (last && last.year === yr) last.count++;
    else groups.push({ year: yr, start: i, count: 1 });
  });
  const ticks = [2, 4, 6, 8, 10];
  const yLabels = ticks
    .map((g) => `<span class="pf-bars__tick" data-top="${CH - barH(g) - 7}px">${g}</span>`)
    .join('');
  const grid = ticks
    .map((g) => `<div class="pf-bars__grid" data-top="${CH - barH(g)}px"></div>`)
    .join('');
  const years = groups
    .map(
      (g, i) =>
        `<div class="pf-bars__year${i ? ' pf-bars__year--sep' : ''}" data-left="${((100 * g.start) / n).toFixed(2)}%"><span>${esc(yearLabel(g.year))}</span></div>`,
    )
    .join('');
  const slots = tests
    .map((t, i) => {
      const g = t.res.grade!;
      const diag = !!t.exam.diagnostic;
      return (
        `<div class="pf-bars__slot" data-tip="b${i}"${i >= n - 2 ? ' data-tip-align="right"' : ''} tabindex="0">` +
        `<span class="pf-bars__v"${diag ? '' : ` data-color="${gradeTextColor(g)}"`}>${formatGrade(g)}</span>` +
        `<div class="pf-bar ${kindClass(testKind(t.exam))}" data-h="${barH(g)}px"></div></div>`
      );
    })
    .join('');
  const badges = tests
    .map((t) => `<div class="pf-bars__badge">${examBadgeHtml(t.exam, t.exam.title)}</div>`)
    .join('');
  return (
    `<div class="pf-bars"><div class="pf-bars__y" data-h="${CH}px">${yLabels}</div><div class="pf-bars__main">` +
    `<div class="pf-bars__plot" data-h="${CH}px">${grid}` +
    `<div class="pf-bars__pass" title="Grens voldoende: 5,5" data-top="${CH - barH(PASS)}px"></div>` +
    `${years}<div class="pf-bars__slots">${slots}</div></div>` +
    `<div class="pf-bars__badges">${badges}</div></div></div>`
  );
}

export const BAR_LEGEND =
  `<div class="ov-legend pf-legend">` +
  `<span><span class="pf-key ov-kind--toets"></span>Toets</span>` +
  `<span><span class="pf-key ov-kind--se"></span>SE-toets</span>` +
  `<span><span class="pf-key ov-kind--po"></span>Praktische opdracht (beweeg erover voor de categorieën)</span>` +
  `<span><span class="pf-key ov-kind--diagnostic"></span>Diagnostisch (telt niet mee)</span></div>`;

export function dumbLegend(first: string, avg: string): string {
  return (
    `<div class="ov-legend pf-legend"><span><span class="pf-key-dot"></span>${esc(first)} (kleur = cijfer)</span>` +
    `<span><span class="pf-key-diamond"></span>${esc(avg)}</span>` +
    `<span><span class="pf-key-sd"></span>± 1 standaarddeviatie</span></div>`
  );
}

const pct = (g: number) => axisPct(g).toFixed(2);

/**
 * One track row: the label (HTML, escaped by the caller), the student's grade and the average.
 * `own`: the student's number is a shown average (a year or the SE, decisions 91-93), drawn with
 * the format's decimals and hover text; `g` is then its shown value. The delta is the difference
 * of the shown values (step 38 answer B), so it agrees with the two numbers on screen.
 */
export function dumbRowHtml(
  labelHtml: string,
  g: number | null,
  avg: Stats | null,
  avgLabel: string,
  who: string,
  own?: { shown: Shown; fmt: AverageFormat },
): string {
  const label = `<div class="pf-dumb__label">${labelHtml}</div>`;
  const color = (x: number) => (own ? shownTextColor(own.shown) : gradeTextColor(x));
  const text = (x: number) => (own ? formatShown(own.shown.shown, own.fmt) : formatGrade(x));
  const hint = own ? ` title="${esc(formatHint(own.fmt))}"` : '';
  if (g === null || !avg)
    return `<div class="pf-dumb__row">${label}<div class="pf-dumb__track"><div class="pf-dumb__line"></div></div><div class="pf-dumb__text ov-meanline">${g === null ? 'Geen cijfer' : `<b data-color="${color(g)}"${hint}>${text(g)}</b> · geen vergelijking`}</div></div>`;
  const lo = Math.max(1, avg.mean - avg.sd);
  const hi = Math.min(10, avg.mean + avg.sd);
  const delta = own
    ? shownDifference(own.shown.raw, own.fmt, avg.mean)
    : shownDifference(g, undefined, avg.mean);
  const up = delta >= 0;
  const a = axisPct(Math.min(g, avg.mean));
  const w = Math.abs(axisPct(g) - axisPct(avg.mean));
  const avgText = `${formatFixed(avg.mean)} ± ${formatFixed(avg.sd)}`;
  return (
    `<div class="pf-dumb__row">${label}<div class="pf-dumb__track">` +
    `<div class="pf-dumb__line"></div><div class="pf-dumb__pass" data-left="${pct(PASS)}%"></div>` +
    `<div class="pf-dumb__sd" title="${esc(`${avgLabel} ${avgText}`)}" data-left="${pct(lo)}%" data-w="${(axisPct(hi) - axisPct(lo)).toFixed(2)}%"></div>` +
    `<div class="pf-dumb__diff${up ? ' pf-dumb__diff--up' : ''}" data-left="${a.toFixed(2)}%" data-w="${w.toFixed(2)}%"></div>` +
    `<div class="pf-dumb__avg" title="${esc(`${avgLabel} ${formatFixed(avg.mean)}`)}" data-left="${pct(avg.mean)}%"></div>` +
    `<div class="pf-dumb__dot" title="${esc(`${who} ${text(g)}`)}" data-left="${pct(g)}%" data-bg="${color(g)}"></div></div>` +
    `<div class="pf-dumb__text"><b data-color="${color(g)}"${hint}>${text(g)}</b> <span class="po-ov-muted">vs ${formatFixed(avg.mean)}</span>` +
    `<span class="pf-dumb__delta${up ? ' pf-dumb__delta--up' : ''}">${signed(delta)}</span></div></div>`
  );
}

export function axisRowHtml(): string {
  const axis = Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join('');
  return `<div class="pf-dumb__row pf-dumb__axis-row"><div class="pf-dumb__label"></div><div class="pf-dumb__axis">${axis}</div><div class="pf-dumb__text"></div></div>`;
}

/** "Gemiddeld cijfer per jaar": a row per school year and the examendossier. */
export function yearRowsHtml(
  rows: YearComparison[],
  yearLabel: (yr: string) => string,
  who: string,
): string {
  if (!rows.length) return '<p class="hint ov-empty">Nog geen jaargemiddelde.</p>';
  return (
    rows
      .map((r) =>
        dumbRowHtml(
          `<span class="pf-dumb__title">${esc(r.key === 'se' ? 'Examendossier (SE)' : yearLabel(r.key))}</span>`,
          r.student?.shown ?? null,
          r.peers,
          'Jaarlaaggemiddelde',
          who,
          r.student ? { shown: r.student, fmt: r.fmt } : undefined,
        ),
      )
      .join('') + axisRowHtml()
  );
}
