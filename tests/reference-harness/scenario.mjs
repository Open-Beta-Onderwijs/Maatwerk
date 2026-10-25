// SPDX-License-Identifier: AGPL-3.0-or-later
// Small hand-built data folders for golden scenarios (v1 layout,
// docs/reference/data-files.md). Use this when a case needs exact numbers;
// use tools/fixtures for volume.

import fs from 'node:fs';
import path from 'node:path';

export const YEAR = '2025-2026';

const write = (root, rel, data) => {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2));
};

export function student(id, extra = {}) {
  return {
    id,
    voornaam: `Leerling${id}`,
    tussenvoegsel: '',
    achternaam: `Achternaam${id}`,
    stamklas: '3a',
    geslacht: 'X',
    jaarlaag: '3',
    schoolsoort: ['Havo'],
    ...extra,
  };
}

/** questions: [max_points, rtti, kind?][] */
export function exam(id, questions, extra = {}) {
  return {
    id,
    title: id,
    jaarlaag: '3',
    schoolsoort: ['Havo'],
    n_term: 1,
    weging: 1,
    weging_se: 1,
    periode: '1',
    type: 'regular',
    structureMode: 'roman',
    questions: questions.map(([max, rtti, kind], i) => ({
      id: `q${i + 1}`,
      section: 'I',
      number: i + 1,
      max_points: max,
      rtti,
      ...(kind ? { kind } : {}),
    })),
    obs_ids: [],
    subject: 'nat',
    volgnummer: 301,
    ...extra,
  };
}

/** Points that give `grade` on a 100-point, n = 1 exam: S = (grade - 1) / 9 * 100. */
export const pointsFor = (grade) => Math.round(((grade - 1) / 9) * 100 * 100) / 100;

/** Ten 10-point questions; spreads `total` greedily. */
export function tenByTen(total) {
  const qs = {};
  let left = total;
  for (let i = 1; i <= 10 && left > 0; i++) {
    const x = Math.round(Math.min(10, left) * 100) / 100;
    qs[`q${i}`] = x;
    left -= x;
  }
  return qs;
}
export const TEN_BY_TEN = Array.from({ length: 10 }, (_, i) => [10, ['R', 'T1', 'T2', 'I'][i % 4]]);

/**
 * Writes a data folder. spec: { years: { [year]: { students, exams, groups,
 * scores: { [subject]: { [studentId]: record } } } }, observaties, opdrachten, config }.
 */
export function buildData(root, spec) {
  fs.mkdirSync(root, { recursive: true });
  write(root, 'config.json', spec.config ?? { activeYear: YEAR });
  for (const o of spec.observaties ?? []) write(root, `observaties/${o.id}.json`, o);
  for (const o of spec.opdrachten ?? []) write(root, `opdrachten/${o.id}.json`, o);
  for (const [year, y] of Object.entries(spec.years ?? {})) {
    write(root, `${year}/students-${year}.json`, y.students ?? []);
    for (const e of y.exams ?? []) write(root, `${year}/exams/${e.id}.json`, e);
    for (const g of y.groups ?? []) write(root, `${year}/groups/${g.id}.json`, g);
    for (const [subject, recs] of Object.entries(y.scores ?? {})) {
      for (const [sid, rec] of Object.entries(recs)) {
        write(root, `${year}/scores/${subject}/${sid}.json`, { student_id: Number(sid), ...rec });
      }
    }
  }
}
