// SPDX-License-Identifier: AGPL-3.0-or-later

// The data of the PO rapport (step 24; design spec 4.13 "PO rapport", PLAN-2 decision 26), as
// buildRapportData (rapport.ts) builds the toets rapport's. The field contract is at the top of
// crates/maatwerk-core/assets/templates/rapport-po.typ. Every number comes from the core
// (crates/maatwerk-grades through WebAssembly): grades, points, averages and their rounding.

import { coreCall, round0, round1 } from './core';
import { formatGrade } from './format';
import { poLineValid, type Results } from './grades';
import { fullName } from './ids';
import { compareStudents, groupName } from './po';
import { gradingOf, ownLinesOf, signedPoints } from './po-grading';
import { sanitizeTypstMarkup, scoreDotColor, subjectDisplayName } from './rapport';
import type { Rubric, RubricCategory } from './rubric';
import { classQuestions, mean } from './statistics';
import type { Exam, Observatie, PoLine, Question, ScoreRecord, Student } from './types';

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
  total: { avg: number; avg_pct: number };
  lines: PoRapportLine[];
  comment: string;
  observaties: PoRapportObservatie[];
}

export interface PoRapportData {
  poInfo: { name: string; subject_display: string; scale_max: number };
  students: PoRapportStudent[];
  /** Students without a rapport, by name: not in a projectgroep, or without a grade yet. */
  skipped: { unplaced: string[]; ungraded: string[] };
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
  const unplaced = [...records.keys()].filter((id) => !placed.has(id)).sort(byName);
  const ungraded: string[] = [];

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
    for (const id of ids) {
      const rec = records.get(id);
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
      entries.push({ id, group: { naam: groupName(g, i), ids }, rec, res, scores });
    }
  });

  // The averages over every graded student with scores (an overwritten grade alone has none).
  const withScores = entries.filter((e) => Object.values(e.scores).some((v) => v !== null));
  const questions = cats.map((c, i) => ({ id: c.id, max_points: maxes[i] }) as unknown as Question);
  const classResults = classQuestions(
    questions,
    withScores.map((e) =>
      Object.fromEntries(Object.entries(e.scores).filter(([, v]) => v !== null)),
    ),
  );
  const normalMax = entries[0]?.res.normalMax ?? 0;
  const totalAvg = mean(withScores.map((e) => e.res.scored)) ?? 0;

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
      total: {
        avg: round1(totalAvg),
        avg_pct: normalMax > 0 ? round0((100 * totalAvg) / normalMax) : 0,
      },
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
    skipped: { unplaced: unplaced.map(nameOf), ungraded: ungraded.sort(byName).map(nameOf) },
  };
}
