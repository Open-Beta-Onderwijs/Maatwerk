// SPDX-License-Identifier: AGPL-3.0-or-later
// Observaties -> opdrachten: opdrachtMatchesExam, getOpdrachtCoupling, grade
// cards and getOpdrachtAssignments (business-rules.md section 7, candidates 35, 37-40).

import { Suite, capture } from '../golden.mjs';
import { extractFunction, refOf } from '../extract.mjs';
import { openReference } from '../session.mjs';
import { TEN_BY_TEN, YEAR, buildData, exam, student, tenByTen } from '../scenario.mjs';

const STORE = 'renderer/store.js';

const obs = (id, extra = {}) => ({ id, naam: `Observatie ${id}`, icon: '📏', subjects: ['nat'], jaarlagen: [], ...extra });
const op = (id, extra = {}) => ({
  id,
  naam: `Opdracht ${id}`,
  schoolsoort: [],
  vakken: ['nat'],
  jaarlagen: [],
  observaties: [],
  typFile: `${id}.typ`,
  ...extra,
});

const OBS = [obs('obs-a'), obs('obs-b'), obs('obs-c'), obs('obs-d', { subjects: ['bio'] })];
const OPS = [
  op('op-1', { observaties: ['obs-a'] }),
  op('op-2', { observaties: ['obs-a', 'obs-b'], jaarlagen: ['4'] }),
  op('op-3', { observaties: ['obs-b'] }),
  op('op-4', { observaties: ['obs-c'], vakken: ['bio'] }),
  op('op-5', { observaties: ['obs-a'], schoolsoort: ['Vwo'] }),
];

const EXAM = exam('nat-opd-2025-2026', TEN_BY_TEN, {
  obs_ids: ['obs-a', 'obs-b', 'obs-c', 'obs-weg'],
  opdrachten: { 'obs-b': [], 'obs-c': ['op-3', 'op-verwijderd'] },
  opdrachtenCijfer: [
    { id: 'cijfer-1', onder: 5.5, opdrachten: ['op-1', 'op-verwijderd'] },
    { id: 'cijfer-2', onder: 4, opdrachten: ['op-3'] },
  ],
});

// Students: grade (100-point exam: S * 0.09 + 1), observaties, group membership.
const STUDENTS = [
  { id: 1, name: ['Anna', 'de', 'Vries'], S: 49.44, obs: [], group: 'g-9a', why: '5.4496 rounds to 5.4: card' },
  { id: 2, name: ['Bram', '', 'Bakker'], S: 49.45, obs: [], group: 'g-9a', why: '5.4505 rounds to 5.5: no card' },
  { id: 3, name: ['Chloé', '', 'Smit'], S: 20, obs: ['obs-a'], group: 'g-10a', why: 'obs + both cards; op-1 twice' },
  { id: 4, name: ['Daan', 'van', 'Dijk'], S: 30, obs: ['obs-a', 'obs-c'], group: null, why: 'no group: sorts last' },
  { id: 5, name: ['Emma', '', 'Bakker'], S: null, obs: ['obs-b'], group: 'g-9a', why: 'no grade, obs-b coupled to []' },
  { id: 6, name: ['Finn', '', 'Visser'], S: 30, obs: [], group: 'g-9a', why: 'override 7 replaces 3.7', override: { cijfer: 7, berekend: 3.7 } },
  { id: 7, name: ['Gijs', '', 'Bakker'], S: 80, obs: ['obs-weg', 'obs-d'], group: 'g-9a', why: 'unknown observatie ids' },
  { id: 8, name: ['Anna', '', 'bakker'], S: 10, obs: [], group: 'g-9b', why: 'collation of lower-case name' },
];

function spec() {
  const groups = [
    { id: 'g-9a', name: '9a nat', jaarlaag: '3', subject: 'nat', schoolsoort: ['Havo'], student_ids: [1, 2, 5, 6, 7] },
    { id: 'g-10a', name: '10a nat', jaarlaag: '3', subject: 'nat', schoolsoort: ['Havo'], student_ids: [3] },
    { id: 'g-9b', name: '9b nat', jaarlaag: '3', subject: 'nat', schoolsoort: ['Havo'], student_ids: [8, 3] },
  ];
  const scores = {};
  for (const st of STUDENTS) {
    scores[st.id] = {
      scores: st.S === null ? {} : { [EXAM.id]: tenByTen(st.S) },
      observations: { [EXAM.id]: st.obs },
      ...(st.override ? { overrides: { [EXAM.id]: st.override } } : {}),
    };
  }
  return {
    observaties: OBS,
    opdrachten: OPS,
    years: {
      [YEAR]: {
        students: STUDENTS.map((st) =>
          student(st.id, { voornaam: st.name[0], tussenvoegsel: st.name[1], achternaam: st.name[2] }),
        ),
        exams: [EXAM],
        groups,
        scores: { nat: scores },
      },
    },
  };
}

const slimAssignments = (res) => ({
  students: res.students.map((x) => ({
    studentId: x.student.id,
    group: x.group?.id ?? null,
    items: x.items.map((it) => ({ opdracht: it.opdracht.id, reasons: it.obs.map((r) => r.id ?? r.naam) })),
  })),
  obsStudents: res.obsStudents,
  cijferStudents: res.cijferStudents,
});

export default async function opdrachten() {
  const suite = new Suite('opdrachten', 'Coupling observaties and grade cards to opdrachten per student.');
  suite.ref(
    [
      'opdrachtMatchesExam',
      'getOpdrachtCoupling',
      'getOpdrachtCijferCards',
      'cijferCardReason',
      'getOpdrachtAssignments',
    ].map((n) => refOf(extractFunction(STORE, n))),
  );
  const data = spec();
  const s = await openReference({ fixture: (dir) => buildData(dir, data), subject: 'nat' });
  try {
    const { Store } = s;
    await Store.getOpdrachten();

    // opdrachtMatchesExam matrix (candidate 40).
    const matrix = [];
    const exams = [
      { subject: 'nat', jaarlaag: '3', schoolsoort: ['Havo'] },
      { subject: 'wi', jaarlaag: '4', schoolsoort: ['Vwo'] },
      { jaarlaag: 3, schoolsoort: [] },
      { subject: 'nat' },
    ];
    const ops = [
      {},
      { vakken: ['nat'] },
      { vakken: ['wisb'] },
      { vakken: ['wi'] },
      { vakken: ['bio', 'nat'] },
      { jaarlagen: ['3'] },
      { jaarlagen: [3] },
      { jaarlagen: ['4', '5'] },
      { schoolsoort: ['Havo'] },
      { schoolsoort: ['Vwo', 'Gymnasium'] },
    ];
    for (const e of exams) for (const o of ops) matrix.push([o, e, Store.opdrachtMatchesExam(o, e)]);
    suite.add('opdrachtMatchesExam-matrix', 'BR 7.2, 11.40', { columns: ['opdracht', 'exam', 'fits'] }, matrix);

    suite.add('data', 'BR 7', data, null);
    const coupling = Store.getOpdrachtCoupling(EXAM);
    suite.add('getOpdrachtCoupling', 'BR 7.3, 11.37', { exam: EXAM.id }, coupling);
    const cards = Store.getOpdrachtCijferCards(EXAM);
    suite.add('getOpdrachtCijferCards', 'BR 7.4', { exam: EXAM.id }, cards);
    suite.add(
      'cijferCardReason',
      'BR 7.4',
      { onder: [5.5, 1, 10, 5.45, '6', 6.25] },
      [5.5, 1, 10, 5.45, '6', 6.25].map((onder) => Store.cijferCardReason({ onder })),
    );
    const res = await capture(() => Store.getOpdrachtAssignments(EXAM, YEAR, coupling, cards));
    suite.add(
      'getOpdrachtAssignments',
      'BR 7.5, 11.35, 11.38, 11.39',
      { exam: EXAM.id, students: STUDENTS.map(({ id, why }) => ({ id, why })) },
      res.$throws ? res : slimAssignments(res),
    );
    const noCards = await capture(() => Store.getOpdrachtAssignments(EXAM, YEAR, coupling));
    suite.add('getOpdrachtAssignments-no-cards', 'BR 7.5', { exam: EXAM.id }, noCards.$throws ? noCards : slimAssignments(noCards));
  } finally {
    s.dispose();
  }
  return suite;
}
