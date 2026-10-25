// SPDX-License-Identifier: AGPL-3.0-or-later
// Rapport (per-student exam report) data: who is included, per-question rows,
// class averages, leeradvies brackets, and the exact studentData/examInfo the
// renderer hands to `renderRapportPdf` (business-rules.md section 8,
// typst-contract.md 2.1, candidates 41-43). Step 2b feeds these to Typst.

import fs from 'node:fs';
import path from 'node:path';
import { Suite } from '../golden.mjs';
import { bindFunctions, extractConst, extractFunction } from '../extract.mjs';
import { openReference } from '../session.mjs';
import { YEAR, buildData, exam, student } from '../scenario.mjs';

const RAPPORT = 'renderer/modals/rapport.js';

const EXAM3 = exam(
  'nat-rapport-2025-2026',
  [
    [3, 'R'],
    [3, 'R'],
    [5, 'T1'],
    [10, 'T2'],
    [4, 'I'],
    [2, 'T1', 'bonus'],
    [1, 'R', 'diag'],
  ],
  { title: 'Toets H2 "Elektriciteit" #1 $5 @home <b>', n_term: 1.3, obs_ids: ['obs-1', 'obs-2', 'obs-3'] },
);
EXAM3.questions[2].section = 'II';
const EXAM4 = exam(
  'nat-rapport-4-2025-2026',
  [
    [2, 'R'],
    [2, 'T1'],
  ],
  { jaarlaag: '4', title: 'Toets zonder sjabloon' },
);
const EXAM_NO_JL = exam('wi-rapport-2025-2026', [[4, 'T2']], { jaarlaag: '', subject: 'wi', title: 'Wiskunde zonder jaarlaag' });

// [id, name, stamklas, scores on EXAM3, override, observaties, in group]
const ROWS = [
  [1, ['Anna', 'van der', 'Berg'], '3a', { q1: 1, q2: 1, q3: 2, q4: 4, q5: 4, q6: 2, q7: 1 }, null, ['obs-1'], 'g3a'],
  [2, ['Bram', '', 'Appel'], '3a', { q1: 1, q2: 1, q3: 3.5, q4: 7, q5: 0 }, null, ['obs-2', 'obs-3', 'obs-weg'], 'g3a'],
  [3, ['Chloé', '', 'Zwart'], '3b', { q1: 2, q2: 2, q3: 5, q4: 10, q5: 2, q6: 1 }, { cijfer: 9.9, berekend: 9.5 }, [], 'g3b'],
  [4, ['Hash#Tag', '', 'Dollar$ "Quote" \\Back'], '3b', { q1: 3, q2: 0, q3: 'abc', q4: 12 }, null, [], 'g3b'],
  [5, ['Alleen', '', 'Ennen'], '3a', { q1: null, q2: null }, null, ['obs-1'], 'g3a'],
  [6, ['Alleen', '', 'Override'], '3a', {}, { cijfer: 7, berekend: null }, [], 'g3a'],
  [7, ['Geen', '', 'Groep'], '3c', { q1: 2, q2: 1 }, null, [], null],
  [8, ['Vierde', '', 'Klasser'], '4a', { q1: 3 }, null, [], 'g3a'],
  [9, ['@At', '', '<Angle> *ster* _under_'], '3a', { q1: -1, q2: 'N', q3: 5 }, null, ['obs-1'], 'g3a'],
];

const TEMPLATE = {
  uitleg: { R: 'Reproductie: *vet* en _cursief_.', T1: 'Toepassen 1 $x$.', T2: 'Toepassen 2 met $ los dollarteken.', I: 'Inzicht.' },
  leeradvies: {
    R: { laag: 'R laag.', midden: 'R midden.', hoog: 'R hoog.' },
    T1: { laag: 'T1 laag $a$ en $b.', midden: '  ', hoog: 'T1 hoog.' },
    T2: { laag: 'T2 laag.', midden: 'T2 midden.', hoog: '' },
    I: { laag: 'I laag.', midden: 'I midden.', hoog: 'I hoog.' },
  },
  grenswaarden: {
    R: { laag_midden: 40, midden_hoog: 70 },
    T1: { laag_midden: 40, midden_hoog: 70 },
    T2: { laag_midden: 50, midden_hoog: 80 },
    I: { laag_midden: 40, midden_hoog: 70 },
  },
};

function spec() {
  const recs = {};
  for (const [id, , , sc, ov, obs] of ROWS) {
    recs[id] = {
      scores: { [EXAM3.id]: sc, [EXAM4.id]: { q1: 2, q2: 1 }, [EXAM_NO_JL.id]: { q1: 3 } },
      observations: { [EXAM3.id]: obs },
      ...(ov ? { overrides: { [EXAM3.id]: ov } } : {}),
    };
  }
  const group = (gid, name) => ({ id: gid, name, jaarlaag: '3', subject: 'nat', student_ids: ROWS.filter((r) => r[6] === gid).map((r) => r[0]) });
  return {
    observaties: [
      { id: 'obs-1', naam: 'Eenheden', icon: '📏', uitleg: 'Eenheid vergeten.', leeradvies: 'Schrijf de eenheid op.', subjects: ['nat'], jaarlagen: [] },
      { id: 'obs-2', naam: 'Formule $v$', icon: '👩‍🔬', uitleg: 'Formule ontbreekt.', subjects: ['nat'], jaarlagen: [] },
      { id: 'obs-3', naam: 'Andere vak', icon: '🇳🇱', uitleg: 'x', leeradvies: 'y', subjects: ['bio'], jaarlagen: [] },
    ],
    years: {
      [YEAR]: {
        students: ROWS.map(([id, n, klas]) => student(id, { voornaam: n[0], tussenvoegsel: n[1], achternaam: n[2], stamklas: klas, jaarlaag: klas[0] })),
        exams: [EXAM3, EXAM4, EXAM_NO_JL],
        groups: [group('g3b', '3b nat'), group('g3a', '3a nat')],
        scores: { nat: recs, wi: { 1: { scores: { [EXAM_NO_JL.id]: { q1: 3 } }, observations: {} } } },
      },
    },
  };
}

export default async function rapport() {
  const suite = new Suite('rapport', 'Data the rapport dialog builds for the Typst report.');
  const data = spec();
  const s = await openReference({
    fixture: (dir) => {
      buildData(dir, data);
      const t = path.join(dir, 'templates', 'RTTI explanations and advices');
      fs.mkdirSync(t, { recursive: true });
      fs.writeFileSync(path.join(t, 'rtti_expl_adv_nat_3.json'), JSON.stringify(TEMPLATE, null, 2));
    },
    subject: 'nat',
  });
  try {
    const { Store, qKind } = s;
    const calls = [];
    const realRtti = globalThis.window.rtti;
    const window = {
      rtti: {
        ...realRtti,
        renderRapportPdf: async (examId, studentData, examInfo) => {
          calls.push({ examId, studentData: structuredClone(studentData), examInfo: structuredClone(examInfo) });
          return { success: true, pdfPath: 'captured' };
        },
      },
    };
    const defs = [
      extractConst(RAPPORT, 'RTTI_COLORS'),
      extractConst(RAPPORT, 'WI_SUB_DISPLAY'),
      ...['lerpHex', 'scoreDotColor', 'assembleVragen', 'subjectDisplayName', 'calcCategoryTotals', 'getScoreBracket', 'fmtNum', 'sanitizeTypstMarkup', 'buildLeeradviesRows', 'rttiExplFilePath', 'defaultTabData', 'compileRapport'].map((n) =>
        extractFunction(RAPPORT, n),
      ),
    ];
    const { fns, refs } = bindFunctions(defs, { Store, qKind, window });
    suite.ref(refs);
    suite.add('data', 'BR 8', { ...data, template: TEMPLATE }, null);

    for (const [label, e] of [
      ['exam-jaarlaag-3', EXAM3],
      ['exam-jaarlaag-4-default-template', EXAM4],
    ]) {
      calls.length = 0;
      const result = await fns.compileRapport(e, YEAR);
      suite.add(`compileRapport-${label}`, 'BR 8, 11.41-43, TC 2.1', { exam: e.id, year: YEAR }, { result, renderRapportPdf: calls[0] ?? null });
    }
    Store.setActiveSubject('wi');
    await Store.initSubject('wi');
    calls.length = 0;
    await fns.compileRapport(EXAM_NO_JL, YEAR);
    suite.add('compileRapport-no-jaarlaag-wi', 'BR 8', { exam: EXAM_NO_JL.id }, calls[0] ?? null);

    const brackets = [
      [0, 10],
      [4, 10],
      [3.99, 10],
      [6.99, 10],
      [7, 10],
      [10, 10],
      [1, 0],
    ];
    const grenzen = { laag_midden: 40, midden_hoog: 70 };
    suite.add('getScoreBracket', 'BR 8, 11.42', { brackets, grenzen }, brackets.map(([a, b]) => fns.getScoreBracket(a, b, grenzen)));
    const nums = [0, 1, 2.5, 2.25, 2.05, -1.5, 10, 1e21, NaN];
    suite.add('fmtNum', 'BR 8', { nums }, nums.map((n) => fns.fmtNum(n)));
    const markup = ['', 'geen dollars', '$x$', '$x', 'a $b$ c $d', '$$', '\\$ ontsnapt $'];
    suite.add('sanitizeTypstMarkup', 'BR 8, TC 2.2', { markup }, markup.map((m) => fns.sanitizeTypstMarkup(m)));
    const subjects = ['nat', 'bio', 'schk', 'wi', 'wisa', 'wisb', 'wisob', 'onbekend', undefined];
    suite.add('subjectDisplayName', 'BR 8', { subjects }, subjects.map((x) => fns.subjectDisplayName(x)));
    const dots = [
      [null, 4],
      [0, 4],
      [-1, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
      [0.5, 0],
    ];
    suite.add('scoreDotColor', 'BR 8', { dots }, dots.map(([a, b]) => fns.scoreDotColor(a, b)));
  } finally {
    s.dispose();
  }
  return suite;
}
