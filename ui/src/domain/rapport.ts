// SPDX-License-Identifier: AGPL-3.0-or-later

// Data the rapport dialog builds for the Typst report (business-rules.md
// section 8, typst-contract.md section 2). Ported from modals/rapport.js;
// pinned by tests/golden/logic/rapport.json, except the quirks fixed in the
// port: T26 (non-numeric score), T27 (`$` guard) and B9 (wiskunde advice file).

import { calcResults, qKind } from './grades';
import { fullName, jaarlaagFromStamklas } from './ids';
import {
  sameId,
  type Exam,
  type Group,
  type Observatie,
  type QuestionScores,
  type ScoreRecord,
  type Student,
} from './types';

export const RTTI_COLORS: Record<string, string> = {
  R: '#5cb85c',
  T1: '#5bc0de',
  T2: '#f0ad4e',
  I: '#d9534f',
};

export function lerpHex(hex1: string, hex2: string, t: number): string {
  const h = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = h(hex1) as [number, number, number],
    [r2, g2, b2] = h(hex2) as [number, number, number];
  return (
    '#' +
    [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Dot colour of a question: grey (not entered), red (0) via yellow to green (full marks). */
export function scoreDotColor(score: number | null, max: number): string {
  // T26: a score that is not a number is shown like an empty one (was "#NaNNaNNaN").
  if (score === null || Number.isNaN(score)) return '#b0b8c1'; // grey — not entered
  if (score <= 0) return '#e57373'; // red — zero
  if (score >= max) return '#66bb6a'; // green — full marks
  const t = score / max;
  return t <= 0.5
    ? lerpHex('#e57373', '#ffd54f', t * 2)
    : lerpHex('#ffd54f', '#66bb6a', (t - 0.5) * 2);
}

export interface Vraag {
  label: string;
  rtti: string;
  kind: string;
  rtti_color: string;
  /** Points, or null when not entered (also for a score that is not a number, T26). */
  score: number | null;
  max: number;
  class_avg: number;
  class_pct: number;
  dot_color: string;
}

const isNotEntered = (v: unknown) =>
  v === undefined || v === null || String(v).toUpperCase() === 'N';

/**
 * The per-question data of one student. `allQuestionScores` holds the scores of
 * every participant, for the class averages.
 */
export function assembleVragen(
  exam: Pick<Exam, 'questions'>,
  questionScores: QuestionScores | undefined,
  allQuestionScores: QuestionScores[],
): Vraag[] {
  return exam.questions.map((q) => {
    const raw = questionScores?.[q.id];
    const num = isNotEntered(raw) ? NaN : Number(raw);
    // T26: a score that is not a number counts as not entered: no points and a
    // grey dot, like calcResults (BR 3.1). The reference produced NaN here.
    const score = Number.isNaN(num) ? null : Math.max(0, num);

    // Class average for this question across all participants
    let sum = 0,
      count = 0;
    for (const qs of allQuestionScores) {
      const v = qs[q.id];
      if (isNotEntered(v)) continue;
      const n = Number(v);
      if (!isNaN(n)) {
        sum += n;
        count++;
      }
    }
    const classAvg = count > 0 ? parseFloat((sum / count).toFixed(1)) : 0;
    const classPct = q.max_points > 0 ? Math.round((classAvg / q.max_points) * 100) : 0;

    const label = q.section ? `${q.section}${q.number}` : String(q.number);

    return {
      label,
      rtti: q.rtti,
      kind: qKind(q),
      rtti_color: RTTI_COLORS[q.rtti] ?? '#888888',
      score,
      max: q.max_points,
      class_avg: classAvg,
      class_pct: classPct,
      dot_color: scoreDotColor(score, q.max_points),
    };
  });
}

export const WI_SUB_DISPLAY: Record<string, string> = {
  wisob: 'Wiskunde',
  wisa: 'Wiskunde A',
  wisb: 'Wiskunde B',
  wisc: 'Wiskunde C',
  wisd: 'Wiskunde D',
};

export const SUBJECT_DISPLAY: Record<string, string> = {
  nat: 'Natuurkunde',
  bio: 'Biologie',
  schk: 'Scheikunde',
  wi: 'Wiskunde',
};

export function subjectDisplayName<S extends string | undefined>(subject: S): string | S {
  if (subject === undefined) return subject;
  return WI_SUB_DISPLAY[subject] ?? SUBJECT_DISPLAY[subject] ?? subject;
}

type Totals = Record<'R' | 'T1' | 'T2', { scored: number; max: number }>;

/** Points per category R, T1, T2 over the normal questions (no I row, quirk B11). */
export function calcCategoryTotals(vragen: Vraag[]): Totals {
  const totals: Totals = {
    R: { scored: 0, max: 0 },
    T1: { scored: 0, max: 0 },
    T2: { scored: 0, max: 0 },
  };
  for (const q of vragen) {
    if (q.kind !== 'normal') continue;
    const t = totals[q.rtti as keyof Totals];
    if (!t) continue;
    t.scored += q.score ?? 0;
    t.max += q.max;
  }
  return totals;
}

export interface Grenzen {
  laag_midden: number;
  midden_hoog: number;
}

export function getScoreBracket(
  scored: number,
  max: number,
  grenzen: Grenzen,
): 'laag' | 'midden' | 'hoog' {
  const pct = (scored / max) * 100;
  if (pct < grenzen.laag_midden) return 'laag';
  if (pct < grenzen.midden_hoog) return 'midden';
  return 'hoog';
}

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

/**
 * Guards a text that the template evaluates as Typst markup against an
 * unclosed math delimiter: with an odd number of `$` they are all escaped and
 * a red warning is put in front. T27: the warning's own `$` is escaped too;
 * in the reference it was not, so the guard itself broke the rapport.
 */
/**
 * Prepares the rapport payload for JSON (review 5a M1). The reference serialised it with
 * `toTypst` (main.js:558-574): `undefined` became `none` and a non-finite number became `0`.
 * JSON would drop `undefined` keys (the template then fails on the missing key) and turn `NaN`
 * into `null`; this restores the `toTypst` values: `undefined` -> `null`, non-finite -> `0`.
 */
export function normaliseForTypst(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (Array.isArray(value)) return value.map(normaliseForTypst);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normaliseForTypst(v)]));
  }
  return value;
}

export function sanitizeTypstMarkup(text: string): string {
  // An escape (`\` plus any character, so `\$` and `\\`) is matched first and kept as it is;
  // only unescaped `$` count (review 5a M2). Same rule as `_guard_markup` in rapport.typ.
  const escapeOrDollar = /\\[\s\S]|\$/g;
  const dollarCount = (text.match(escapeOrDollar) ?? []).filter((m) => m === '$').length;
  if (dollarCount % 2 !== 0) {
    const escaped = text.replace(escapeOrDollar, (m) => (m === '$' ? '\\$' : m));
    return `#text(fill: red, weight: "bold")[\\$-teken niet gesloten — controleer de tekst: ] ${escaped}`;
  }
  return text;
}

/** One RTTI explanation and advice file (templates/RTTI explanations and advices/). */
export interface AdviesData {
  uitleg: Record<string, string>;
  leeradvies: Record<string, Record<'laag' | 'midden' | 'hoog', string>>;
  grenswaarden: Record<string, Grenzen>;
}

export interface RapportObservatie {
  icon: string;
  naam: string;
  uitleg: unknown;
  leeradvies: string;
}

export interface LeeradviesRow {
  cat: string;
  score_str: string;
  advies: string;
}

export function buildLeeradviesRows(
  vragen: Vraag[],
  adviesData: AdviesData | null,
  observaties: RapportObservatie[],
): LeeradviesRow[] {
  const rows: LeeradviesRow[] = [];
  const totals = calcCategoryTotals(vragen);

  for (const cat of ['R', 'T1', 'T2'] as const) {
    const { scored, max } = totals[cat];
    if (max === 0) continue;

    const pct = Math.round((scored / max) * 100);
    const score_str = `${fmtNum(scored)} / ${max} (${pct}%)`;

    let advies = '—';
    if (adviesData) {
      const bracket = getScoreBracket(scored, max, adviesData.grenswaarden[cat]!);
      const text = (adviesData.leeradvies[cat]?.[bracket] ?? '').trim();
      advies = text ? sanitizeTypstMarkup(text) : '—';
    }

    rows.push({ cat, score_str, advies });
  }

  for (const obs of observaties) {
    const obsAdvies = obs.leeradvies.trim();
    rows.push({
      cat: obs.icon,
      score_str: '',
      advies: obsAdvies ? sanitizeTypstMarkup(obsAdvies) : '—',
    });
  }

  return rows;
}

export const RTTI_EXPL_DIR = 'templates/RTTI explanations and advices';

/** Path of an explanation/advice file; the editor uses fileKey `wisa`..`wisd` for wiskunde 4-6. */
export function rttiExplFilePath(fileKey: string | undefined, jaar: string | number | undefined) {
  return `${RTTI_EXPL_DIR}/rtti_expl_adv_${fileKey}_${jaar}.json`;
}

/**
 * Advice files to try for an exam, first match wins. B9: the editor saves
 * bovenbouw wiskunde under `wisa`..`wisd` but the reference rapport read
 * `wi_<jaar>`, so those reports had no advice. The port reads the variant
 * file first and falls back to the old key (ADR-0003 C11: both schemes).
 */
export function rttiExplFileCandidates(
  exam: Pick<Exam, 'subject' | 'subcategory' | 'jaarlaag'>,
): string[] {
  const subject = exam.subject;
  const sub = exam.subcategory;
  const variant = subject === 'wi' && sub && /^wis[a-d]$/.test(sub) ? sub : null;
  return [
    ...(variant ? [rttiExplFilePath(variant, exam.jaarlaag)] : []),
    rttiExplFilePath(subject, exam.jaarlaag),
  ];
}

export function defaultTabData(): AdviesData {
  return {
    uitleg: { R: '', T1: '', T2: '', I: '' },
    leeradvies: {
      R: { laag: '', midden: '', hoog: '' },
      T1: { laag: '', midden: '', hoog: '' },
      T2: { laag: '', midden: '', hoog: '' },
      I: { laag: '', midden: '', hoog: '' },
    },
    grenswaarden: {
      R: { laag_midden: 40, midden_hoog: 70 },
      T1: { laag_midden: 40, midden_hoog: 70 },
      T2: { laag_midden: 40, midden_hoog: 70 },
      I: { laag_midden: 40, midden_hoog: 70 },
    },
  };
}

export interface RapportInput {
  exam: Exam;
  students: Student[];
  groups: Group[];
  recordOf: (student: Student) => ScoreRecord | null | undefined;
  observaties: Observatie[];
  adviesData: AdviesData;
}

/**
 * The students and exam info passed to renderRapportPdf (typst-contract.md
 * 2.1). Only students of the exam's jaarlaag (by stamklas) with at least one
 * entered score are included (quirk B10), sorted by group, then achternaam.
 */
export function buildRapportData({
  exam,
  students,
  groups,
  recordOf,
  observaties,
  adviesData,
}: RapportInput) {
  const examId = exam.id;
  const inJaarlaag = exam?.jaarlaag
    ? students.filter((s) => jaarlaagFromStamklas(s.stamklas) === String(exam.jaarlaag))
    : students;

  const entries = inJaarlaag
    .map((s) => {
      const rec = recordOf(s);
      const questionScores = rec?.scores?.[examId];
      if (!questionScores) return null;
      const hasEntry = Object.values(questionScores).some((v) => v !== null && v !== undefined);
      if (!hasEntry) return null;
      const { scored, normalMax, grade, overridden } = calcResults(
        exam,
        questionScores,
        rec?.overrides?.[examId],
      );
      const group = groups.find((g) => g.student_ids.some((id) => sameId(id, s.id)));
      const obsIds = rec?.observations?.[examId] ?? [];
      const obs = obsIds
        .map((id) => observaties.find((o) => o.id === id))
        .filter((o): o is Observatie => Boolean(o))
        .map((o) => ({
          icon: o.icon as string,
          naam: o.naam as string,
          uitleg: o.uitleg,
          leeradvies: (o.leeradvies as string | undefined) ?? '',
        }));
      return {
        student: s,
        group,
        scored,
        normalMax,
        grade,
        overridden,
        questionScores,
        observaties: obs,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  entries.sort((a, b) => {
    const gCmp = (a.group?.name ?? '').localeCompare(b.group?.name ?? '', 'nl');
    if (gCmp !== 0) return gCmp;
    return (a.student.achternaam ?? '').localeCompare(b.student.achternaam ?? '', 'nl');
  });

  const allQuestionScores = entries.map((e) => e.questionScores);
  const globalMax = exam?.questions?.length
    ? Math.max(...exam.questions.map((q) => q.max_points))
    : 1;

  const studentData = entries.map((e) => {
    const vragen = assembleVragen(exam, e.questionScores, allQuestionScores);
    return {
      name: fullName(e.student),
      student_nr: String(e.student.id),
      group: e.group?.name ?? '—',
      score: e.scored,
      max_score: e.normalMax,
      grade: e.grade !== null ? (Math.round(e.grade * 10) / 10).toFixed(1).replace('.', ',') : '—',
      grade_num: e.grade !== null ? Math.round(e.grade * 10) / 10 : null,
      grade_overridden: e.overridden,
      vragen,
      observaties: e.observaties,
      leeradvies_rows: buildLeeradviesRows(vragen, adviesData, e.observaties),
    };
  });

  const examInfo = {
    name: exam?.title ?? '',
    subject_display: subjectDisplayName(exam.subject),
    global_max_points: globalMax,
    n_term: exam?.n_term ?? 1,
    uitleg_rtti: {
      R: adviesData.uitleg?.R ?? '',
      T1: adviesData.uitleg?.T1 ?? '',
      T2: adviesData.uitleg?.T2 ?? '',
      I: adviesData.uitleg?.I ?? '',
    },
  };

  return { studentData, examInfo };
}
