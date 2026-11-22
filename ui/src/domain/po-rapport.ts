// SPDX-License-Identifier: AGPL-3.0-or-later

// The data of the PO rapport (step 24; design spec 4.13 "PO rapport", PLAN-2 decision 26), as
// buildRapportData (rapport.ts) builds the toets rapport's. The field contract is at the top of
// crates/maatwerk-core/assets/templates/rapport-po.typ. Every number comes from the core
// (crates/maatwerk-grades through WebAssembly): grades, points, averages and their rounding.

import { coreCall, round0 } from './core';
import { formatGrade } from './format';
import { poLineValid, type Results } from './grades';
import { fullName } from './ids';
import { compareStudents, groupName } from './po';
import { gradedGroupOf, gradingOf, gradingStatus, ownLinesOf, signedPoints } from './po-grading';
import { sanitizeTypstMarkup, scoreDotColor, subjectDisplayName } from './rapport';
import type { Rubric, RubricCategory } from './rubric';
import { classQuestions } from './statistics';
import type { Exam, Observatie, PoLine, Question, ScoreRecord, Student } from './types';
import { esc } from '../utils/html';

/** What the builder reads of one PO (a `PoContext` of the score table fits). */
export interface PoRapportInput {
  exam: Exam;
  rubric: Rubric | null;
  students: ReadonlyMap<string, Student>;
  /** Score files by student id: every student of the PO's matching classes and projectgroepen. */
  records: ReadonlyMap<string, ScoreRecord>;
  /** The student's class name, or "—". */
  classTag: (id: string) => string;
  observaties: readonly Observatie[];
  /** A herkansing or inhaal: its original (same rubric), for who counts as unplaced (m6). */
  original?: Exam;
}

export interface PoRapportObservatie {
  icon: string;
  naam: string;
  uitleg: string;
  leeradvies: string;
}

export interface PoRapportCategory {
  name: string;
  soort: string;
  max: number;
  score: number | null;
  avg: number;
  avg_pct: number;
  dot_color: string;
  levels: { min: number | null; max: number | null; title: string; text: string }[];
  comment: string;
  observaties: PoRapportObservatie[];
}

export interface PoRapportLine {
  voor: 'Projectgroep' | 'Persoonlijk';
  label: string;
  value: number;
  text: string;
}

export interface PoRapportStudent {
  name: string;
  student_nr: string;
  klas: string;
  grade: string;
  grade_overridden: boolean;
  grade_only: boolean;
  points: number;
  max: number;
  pct: number | null;
  rubric_grade: string | null;
  group_size: number;
  projectgroep: { naam: string; members: { name: string; klas: string }[] };
  categories: PoRapportCategory[];
  lines: PoRapportLine[];
  comment: string;
  observaties: PoRapportObservatie[];
}

export interface PoRapportData {
  poInfo: { name: string; subject_display: string; scale_max: number };
  students: PoRapportStudent[];
  skipped: PoRapportSkipped;
}

/** Who gets no rapport, by name and reason, and the projectgroepen graded only in part. */
export interface PoRapportSkipped {
  /** Not in a projectgroep (decision 18: no grade). On a resit: only without an original grade. */
  unplaced: string[];
  /** In a projectgroep, without a grade yet. */
  ungraded: string[];
  /** Graded in another projectgroep than their own (review 24 m4). */
  otherGroup: string[];
  /** Projectgroepen with a rapport but not every normal category scored (Bezig, review 24 m3). */
  partial: string[];
}

/**
 * One category as the core counts it (review 24 m1: no second copy of the score rules): its
 * max (`whole_max`) and the points a raw score earns (`ScoreValue`: "2" is 2, `null` and `N` are
 * 0, a fraction or text is 0). Asked through `calcResults` on the rubric with only this category,
 * as a normal one. No score at all, or an empty one, is `null`: not scored.
 */
function coreCategory(
  exam: Exam,
  cat: RubricCategory,
  raw?: unknown,
): { max: number; score: number | null } {
  const rubric = { categories: [{ ...cat, soort: 'normaal' }] };
  const scores = raw === undefined ? {} : { [cat.id]: raw };
  const r = coreCall<Results>('calcResults', { ...exam, rubric }, scores, null, null);
  return { max: r.normalMax, score: raw === undefined || raw === '' ? null : r.scored };
}

function observatie(o: Observatie): PoRapportObservatie {
  const advice = typeof o.leeradvies === 'string' ? o.leeradvies.trim() : '';
  return {
    icon: o.icon ?? '',
    naam: o.naam ?? '',
    uitleg: typeof o.uitleg === 'string' ? o.uitleg : '',
    leeradvies: advice ? sanitizeTypstMarkup(advice) : '',
  };
}

function lines(voor: PoRapportLine['voor'], list: PoLine[]): PoRapportLine[] {
  return list
    .filter((l) => l.value !== null && poLineValid(l.value))
    .map((l) => ({ voor, label: l.label.trim(), value: l.value!, text: signedPoints(l.value!) }));
}

/**
 * The PO rapport's data: every student in a projectgroep with a grade, sorted by class, then
 * achternaam. Students without a projectgroep get no grade (decision 18), so no rapport; they
 * and the placed students without a grade yet are named in `skipped`.
 */
export function buildPoRapportData(input: PoRapportInput): PoRapportData {
  const { exam, rubric, students, records, classTag, observaties } = input;
  const cats = rubric?.categories ?? [];
  const maxes = cats.map((c) => coreCategory(exam, c).max);
  const graded = { ...exam, rubric };
  const nameOf = (id: string) => {
    const s = students.get(id);
    return s ? fullName(s) : `Leerling ${id}`;
  };
  const byName = (a: string, b: string) => compareStudents(students.get(a), students.get(b));
  const obsById = new Map(observaties.map((o) => [o.id, o]));
  const obsOf = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const o = obsById.get(id);
      return o ? [observatie(o)] : [];
    });

  const groups = exam.projectgroepen ?? [];
  const placed = new Set(groups.flatMap((g) => g.student_ids.map(String)));
  // On a resit most of the jaarlaag is unplaced: only who has no grade on the original counts.
  const original = input.original;
  const hasOriginalGrade = (id: string) => {
    if (!original) return false;
    const rec = records.get(id);
    const r = coreCall<Results>(
      'calcResults',
      { ...original, rubric },
      rec?.scores?.[original.id] ?? {},
      rec?.overrides?.[original.id] ?? null,
      rec?.po?.[original.id] ?? null,
    );
    return r.grade !== null;
  };
  const unplaced = [...records.keys()]
    .filter((id) => !placed.has(id) && !hasOriginalGrade(id))
    .sort(byName);
  const ungraded: string[] = [];
  const otherGroup: string[] = [];
  const partial: string[] = [];

  interface Entry {
    id: string;
    group: { naam: string; ids: string[] };
    rec: ScoreRecord | undefined;
    res: Results;
    scores: Record<string, number | null>;
  }
  const entries: Entry[] = [];
  groups.forEach((g, i) => {
    const ids = g.student_ids.map(String);
    const naam = groupName(g, i);
    for (const id of ids) {
      const rec = records.get(id);
      // Graded in another projectgroep: that grading is not this group's (review 24 m4).
      const from = gradedGroupOf(rec, exam.id);
      if (from !== null && from !== g.id) {
        otherGroup.push(id);
        continue;
      }
      const res = coreCall<Results>(
        'calcResults',
        graded,
        rec?.scores?.[exam.id] ?? {},
        rec?.overrides?.[exam.id] ?? null,
        rec?.po?.[exam.id] ?? null,
      );
      if (res.grade === null) {
        ungraded.push(id);
        continue;
      }
      const scores = Object.fromEntries(
        cats.map((c) => [c.id, coreCategory(exam, c, rec?.scores?.[exam.id]?.[c.id]).score]),
      );
      entries.push({ id, group: { naam, ids }, rec, res, scores });
      const status = gradingStatus(rubric, gradingOf(rec, exam.id));
      if (status === 'busy' && !partial.includes(naam)) partial.push(naam);
    }
  });

  // The averages over every graded student with scores (an overwritten grade alone has none).
  // An empty normal or bonus category counts as 0, as in the grade, so the averages add up to the
  // average points; a diagnostic one (not in the grade) is averaged over who has a score (review
  // 24 m5, user 2026-11-22).
  const withScores = entries.filter((e) => Object.values(e.scores).some((v) => v !== null));
  const questions = cats.map((c, i) => ({ id: c.id, max_points: maxes[i] }) as unknown as Question);
  const inGrade = new Set(cats.filter((c) => c.soort !== 'diagnostisch').map((c) => c.id));
  const classResults = classQuestions(
    questions,
    withScores.map((e) =>
      Object.fromEntries(
        Object.entries(e.scores)
          .map(([id, v]) => [id, v === null && inGrade.has(id) ? 0 : v] as const)
          .filter(([, v]) => v !== null),
      ),
    ),
  );

  entries.sort(
    (a, b) =>
      classTag(a.id).localeCompare(classTag(b.id), 'nl', { numeric: true }) || byName(a.id, b.id),
  );

  const studentData = entries.map((e): PoRapportStudent => {
    const g = gradingOf(e.rec, exam.id);
    const others = e.group.ids.filter((m) => m !== e.id).sort(byName);
    const res = e.res;
    return {
      name: nameOf(e.id),
      student_nr: e.id,
      klas: classTag(e.id),
      grade: formatGrade(res.grade),
      grade_overridden: res.overridden,
      grade_only: !Object.values(e.scores).some((v) => v !== null),
      points: res.scored,
      max: res.normalMax,
      pct: res.normalMax > 0 ? round0((res.scored / res.normalMax) * 100) : null,
      rubric_grade: typeof res.rubricGrade === 'number' ? formatGrade(res.rubricGrade) : null,
      group_size: e.group.ids.length,
      projectgroep: {
        naam: e.group.naam,
        members: [e.id, ...others].map((m) => ({ name: nameOf(m), klas: classTag(m) })),
      },
      categories: cats.map((c, i) => {
        const max = maxes[i]!;
        const score = e.scores[c.id] ?? null;
        const { classAvg, classPct } = classResults[i]!;
        return {
          name: c.naam,
          soort: c.soort,
          max,
          score,
          avg: classAvg,
          avg_pct: classPct,
          dot_color: scoreDotColor(score, max),
          levels: c.niveaus.map((n) => ({
            min: n.min,
            max: n.max,
            title: n.titel?.trim() ?? '',
            text: n.uitleg,
          })),
          comment: g.categoryComments[c.id]?.trim() ?? '',
          observaties: obsOf(g.categoryObs[c.id] ?? []),
        };
      }),
      // An overwritten grade replaces the lines too: they did not count (review 24 m2).
      lines: res.overridden
        ? []
        : [
            ...lines('Projectgroep', g.groupLines),
            ...lines('Persoonlijk', ownLinesOf(e.rec, exam.id)),
          ],
      comment: g.comment.trim(),
      observaties: obsOf(g.observations),
    };
  });

  return {
    poInfo: {
      name: exam.title ?? '',
      subject_display: subjectDisplayName(exam.subject) ?? '',
      scale_max: Math.max(1, ...maxes),
    },
    students: studentData,
    skipped: {
      unplaced: unplaced.map(nameOf),
      ungraded: ungraded.sort(byName).map(nameOf),
      otherGroup: otherGroup.sort(byName).map(nameOf),
      partial,
    },
  };
}

/** "Lotte Bakker en Daan Jansen": names as one line. */
function names(list: readonly string[]): string {
  return list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} en ${list.at(-1)}`;
}

/** The notice above the rapport: who gets none and why, and groups graded in part (24 n1). */
export function skippedNoticeHtml(s: PoRapportSkipped): string {
  const p = (text: string) => `<p class="rapport-skipped">${text}</p>`;
  const none = (list: string[], why: string) =>
    list.length ? p(`Geen rapport voor ${esc(names(list))}: ${why}`) : '';
  return (
    none(s.unplaced, 'niet ingedeeld in een projectgroep.') +
    none(s.ungraded, 'nog geen cijfer.') +
    none(
      s.otherGroup,
      'beoordeeld in een andere projectgroep. Beoordeel de eigen projectgroep opnieuw via Scores invoeren.',
    ) +
    (s.partial.length
      ? p(
          `Let op: ${esc(names(s.partial))} ${s.partial.length === 1 ? 'is' : 'zijn'} nog niet helemaal beoordeeld. Een categorie zonder score staat in het rapport als —.`,
        )
      : '')
  );
}
