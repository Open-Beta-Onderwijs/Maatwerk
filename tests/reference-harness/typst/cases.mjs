// SPDX-License-Identifier: AGPL-3.0-or-later
// Typst golden cases (PLAN.md Step 2b, typst-contract.md section 10). Each case
// calls a real reference IPC handler (app:renderRapportPdf, renderAssignmentPdf,
// renderAssignmentSvg, renderAssignmentBatch) on the tiny fixture.

import fs from 'node:fs';
import path from 'node:path';
import { decode, readGolden } from '../golden.mjs';
import { refPath as refPathFor } from '../reference.mjs';
import { bindFunctions, extractConst, extractFunction } from '../extract.mjs';

const RAPPORT = 'renderer/modals/rapport.js';

/**
 * Typed scores that are not numbers (kept as strings, e.g. "abc") are replaced by
 * null (N), so the rapport compiles (quirk T26). Numeric strings stay as they are.
 */
function sanitizeScores(dataDir) {
  const dir = path.join(dataDir, '2025-2026', 'scores', 'nat');
  for (const f of fs.readdirSync(dir)) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const qs of Object.values(rec.scores)) {
      for (const [q, v] of Object.entries(qs))
        if (typeof v === 'string' && Number.isNaN(Number(v))) qs[q] = null;
    }
    fs.writeFileSync(path.join(dir, f), JSON.stringify(rec, null, 2));
  }
}

// Extra synthetic students for the class rapport: 12 in total (the grade histogram
// needs 10 or more, rtti_export.typ:494-496), with a long name, Typst-special
// characters and diacritics.
const EXTRA_STUDENTS = [
  ['Maximiliaan Alexander Constantijn', 'van der', 'Wiel-Brandsma de Clercq-Zubli van Hoogstraten'],
  ['Hash#Tag', '', 'Dollar$ "Quote" \\Back'],
  ['@At', '', '<Angle> *ster* _under_'],
  ['Ëlla', 'de', 'Ruïne'],
];

/** Adds EXTRA_STUDENTS to the tiny fixture (class 3a), with score records derived from 900001-900004. */
function addStudents(dataDir) {
  const year = path.join(dataDir, '2025-2026');
  const studentsFile = path.join(year, 'students-2025-2026.json');
  const students = JSON.parse(fs.readFileSync(studentsFile, 'utf8'));
  const groupFile = path.join(year, 'groups', '3a-nat-2025-2026.json');
  const group = JSON.parse(fs.readFileSync(groupFile, 'utf8'));
  EXTRA_STUDENTS.forEach(([voornaam, tussenvoegsel, achternaam], i) => {
    const id = 900009 + i;
    students.push({
      id,
      voornaam,
      tussenvoegsel,
      achternaam,
      stamklas: '3a',
      geslacht: 'X',
      jaarlaag: '3',
      schoolsoort: ['Havo'],
    });
    group.student_ids.push(id);
    const base = JSON.parse(
      fs.readFileSync(path.join(year, 'scores', 'nat', `${900001 + i}.json`), 'utf8'),
    );
    // Halve every numeric score, so the extra students spread the grades downwards.
    for (const qs of Object.values(base.scores)) {
      for (const [q, v] of Object.entries(qs)) if (typeof v === 'number') qs[q] = Math.floor(v) / 2;
    }
    base.student_id = id;
    fs.writeFileSync(path.join(year, 'scores', 'nat', `${id}.json`), JSON.stringify(base, null, 2));
  });
  fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
  fs.writeFileSync(groupFile, JSON.stringify(group, null, 2));
}

/** Opdrachten of the tiny fixture, by kind (tools/fixtures/generate.mjs makeOpdrachten). */
export function opdrachtenByKind(Store) {
  const out = {};
  for (const o of Store.getOpdrachtenSync()) out[/\((.+)\)$/.exec(o.naam)[1]] = o;
  return out;
}

/** Runs the reference compileRapport for `exam`; window.rtti is the real bridge. */
export function bindCompileRapport(Store, qKind, rtti) {
  const defs = [
    extractConst(RAPPORT, 'RTTI_COLORS'),
    extractConst(RAPPORT, 'WI_SUB_DISPLAY'),
    ...[
      'lerpHex',
      'scoreDotColor',
      'assembleVragen',
      'subjectDisplayName',
      'calcCategoryTotals',
      'getScoreBracket',
      'fmtNum',
      'sanitizeTypstMarkup',
      'buildLeeradviesRows',
      'rttiExplFilePath',
      'defaultTabData',
      'compileRapport',
    ].map((n) => extractFunction(RAPPORT, n)),
  ];
  return bindFunctions(defs, { Store, qKind, window: { rtti } });
}

const HEADER_OBS = [
  { icon: '📏', name: 'Eenheden vergeten' },
  { icon: '👩‍🔬', name: 'Formule "niet" genoteerd #1 $x$ @a <b> \\c' },
  { icon: '5️⃣', name: 'Cijfer onder 5,5' },
];

/**
 * Case list. Each case: { id, path, rule, run(ctx) -> { channel, args } }.
 * ctx: { Store, ops (opdrachten by kind), fns (compileRapport binding) }.
 */
export const CASES = [
  {
    id: 'rapport-tiny',
    path: 'A',
    rule: 'TC 2, quirk T26: tiny fixture as is; one typed invalid score breaks the whole rapport',
    rapport: async (ctx) => {
      const exam = ctx.Store.getExamsSync('2025-2026').find((e) =>
        e.questions.some((q) => q.kind === 'diag'),
      );
      return ctx.fns.compileRapport(exam, '2025-2026');
    },
  },
  {
    id: 'rapport-valid',
    path: 'A',
    rule: 'TC 2, 10.9: class rapport, 12 students (grade histogram), long and Typst-special names, an override, non-numeric scores replaced by N, leeradvies markup that compiles',
    prepare: (dataDir) => {
      addStudents(dataDir);
      sanitizeScores(dataDir);
      // Leeradvies markup that compiles: bold, number formatting, math; T1 uitleg empty.
      const file = path.join(
        dataDir,
        'templates',
        'RTTI explanations and advices',
        'rtti_expl_adv_nat_3.json',
      );
      const t = JSON.parse(fs.readFileSync(file, 'utf8'));
      t.uitleg.T1 = '';
      t.uitleg.R = 'Reproductie: *kennen* en _herkennen_.';
      t.leeradvies.R.laag = 'Leer de *begrippen*; oefen met #num[1234.5] en $v = s / t$.';
      t.leeradvies.T2.midden = 'Maak opgave 3 tot en met 5 en controleer je $E_k$.';
      fs.writeFileSync(file, JSON.stringify(t, null, 2));
    },
    rapport: async (ctx) => {
      const exam = ctx.Store.getExamsSync('2025-2026').find((e) =>
        e.questions.some((q) => q.kind === 'diag'),
      );
      return ctx.fns.compileRapport(exam, '2025-2026');
    },
  },
  {
    id: 'rapport-markup',
    path: 'A',
    rule: 'TC 2.2, quirk T11: captured rapport-suite payload (unclosed $, Typst-special names, no group)',
    args: () => {
      const g = readGolden('rapport').cases.find((c) => c.id === 'compileRapport-exam-jaarlaag-3');
      const call = g.output.renderRapportPdf;
      return ['app:renderRapportPdf', call.examId, decode(call.studentData), decode(call.examInfo)];
    },
  },
  {
    id: 'rapport-no-watermark',
    path: 'A',
    rule: 'quirk T4: a missing watermark fails the whole rapport',
    removeWatermark: true,
    args: () => {
      const g = readGolden('rapport').cases.find(
        (c) => c.id === 'compileRapport-exam-jaarlaag-4-default-template',
      );
      const call = g.output.renderRapportPdf;
      return ['app:renderRapportPdf', call.examId, decode(call.studentData), decode(call.examInfo)];
    },
  },
  {
    id: 'opdracht-images-student',
    path: 'D',
    rule: 'TC 3, 4.3: student mode with header, observaties (emoji), PNG/JPG/SVG images, answers upside down',
    args: (ctx) => [
      'app:renderAssignmentBatch',
      [
        {
          key: '900001',
          typFile: ctx.ops.images.typFile,
          label: ctx.ops.images.naam,
          mode: 'student',
          header: {
            title: ctx.ops.images.naam,
            student: "Marie-Claire 't Hart",
            group: '3a nat',
            exam: 'Toets H1 "Krachten" & Énergie',
            observaties: HEADER_OBS,
          },
        },
      ],
      { includeAnswers: true, duplex: true, outputName: 'opdrachten.pdf' },
    ],
  },
  {
    id: 'opdracht-grid-no-answers',
    path: 'D',
    rule: 'TC 3: student mode without answers, vragen in grid and figure, no observaties (empty header cell, quirk T19)',
    args: (ctx) => [
      'app:renderAssignmentBatch',
      [
        {
          key: 'a',
          typFile: ctx.ops.grid.typFile,
          label: ctx.ops.grid.naam,
          mode: 'student',
          header: {
            title: ctx.ops.grid.naam,
            student: 'Hash#Tag Dollar$ "Quote" \\Back',
            group: '',
            exam: 'Toets',
            observaties: [],
          },
        },
      ],
      { includeAnswers: false, duplex: true, outputName: 'opdrachten.pdf' },
    ],
  },
  {
    id: 'opdracht-grid-answers',
    path: 'D',
    rule: 'TC 3: answers mode (antwoordsleutel)',
    args: (ctx) => [
      'app:renderAssignmentBatch',
      [
        {
          key: ctx.ops.grid.id,
          typFile: ctx.ops.grid.typFile,
          label: ctx.ops.grid.naam,
          mode: 'answers',
          header: { title: ctx.ops.grid.naam },
        },
      ],
      { includeAnswers: true, duplex: false, outputName: 'antwoordsleutel.pdf' },
    ],
  },
  {
    id: 'opdracht-zero-vragen',
    path: 'D',
    rule: 'TC 5: opdracht without vragen (no answer block)',
    args: (ctx) => [
      'app:renderAssignmentBatch',
      [
        {
          key: 'a',
          typFile: ctx.ops['zero-vragen'].typFile,
          label: 'x',
          mode: 'student',
          header: {
            title: 'Zonder vragen',
            student: 'Anna',
            group: '3a nat',
            exam: 'Toets',
            observaties: HEADER_OBS.slice(0, 1),
          },
        },
      ],
      { includeAnswers: true, duplex: true, outputName: 'opdrachten.pdf' },
    ],
  },
  {
    id: 'opdracht-long-odd',
    path: 'D',
    rule: 'TC 3: multi-page opdracht (odd page count)',
    args: (ctx) => [
      'app:renderAssignmentBatch',
      [
        {
          key: 'a',
          typFile: ctx.ops['long-odd'].typFile,
          label: 'x',
          mode: 'student',
          header: {
            title: 'Lang oneven',
            student:
              'Maximiliaan Alexander Constantijn van der Wiel-Brandsma de Clercq-Zubli van Hoogstraten',
            group: '3a nat',
            exam: 'Toets',
            observaties: HEADER_OBS,
          },
        },
      ],
      { includeAnswers: true, duplex: true, outputName: 'opdrachten.pdf' },
    ],
  },
  {
    id: 'opdracht-placeholder-pdf',
    path: 'B',
    rule: 'TC 4.1: renderAssignmentPdf with the placeholder header (path unused by the UI)',
    args: (ctx) => ['app:renderAssignmentPdf', ctx.ops.plain.typFile, 'Titel met "quotes" en \\'],
  },
  {
    id: 'svg-preview',
    path: 'C',
    rule: 'TC 4.2: SVG preview of the editor text, placeholder header',
    args: (ctx) => [
      'app:renderAssignmentSvg',
      ctx.ops.grid.typFile,
      'Voorbeeld',
      ctx.typSource('grid'),
    ],
  },
  {
    id: 'svg-preview-cursor',
    path: 'C',
    rule: 'TC 4.2: SVG preview with the cursor marker (rtti-cursor link)',
    args: (ctx) => [
      'app:renderAssignmentSvg',
      ctx.ops.plain.typFile,
      'Voorbeeld',
      ctx
        .typSource('plain')
        .replace('Tweede vraag.', 'Tweede #metadata(none)<__rtti_cursor> vraag.'),
    ],
  },
  {
    id: 'svg-preview-error',
    path: 'C',
    rule: 'TC 4.2, 9: compile error in the editor text; preview file name mapped back',
    args: (ctx) => [
      'app:renderAssignmentSvg',
      ctx.ops.plain.typFile,
      'Voorbeeld',
      ctx
        .typSource('plain')
        .replace('#let render_opgaven() = [', '#let render_opgaven() = [ #onbekend()'),
    ],
  },
  {
    id: 'opdracht-base-template',
    path: 'B',
    rule: 'TC 10.1: base_assignment.typ unchanged, placeholderHeader("Remweg")',
    prepare: (dataDir) =>
      fs.copyFileSync(
        refPathFor('include/templates/base_assignment.typ'),
        path.join(dataDir, 'opdrachten', 'basis.typ'),
      ),
    args: () => ['app:renderAssignmentPdf', 'basis.typ', 'Remweg'],
  },
  {
    id: 'opdracht-base-template-answers',
    path: 'D',
    rule: 'TC 10.2: base_assignment.typ in answers mode',
    prepare: (dataDir) =>
      fs.copyFileSync(
        refPathFor('include/templates/base_assignment.typ'),
        path.join(dataDir, 'opdrachten', 'basis.typ'),
      ),
    args: () => [
      'app:renderAssignmentBatch',
      [
        {
          key: 'basis',
          typFile: 'basis.typ',
          label: 'Remweg',
          mode: 'answers',
          header: { title: 'Remweg' },
        },
      ],
      { includeAnswers: true, duplex: false, outputName: 'antwoordsleutel.pdf' },
    ],
  },
  {
    id: 'opdracht-lib-features',
    path: 'D',
    rule: 'TC 10.3, 10.5: lib.typ blocks, table figure, labels and refs, 1,5p, single-vraag opgave, vraag outside an opgave, opgave over a page break; header text injection',
    args: (ctx) => [
      'app:renderAssignmentBatch',
      [
        {
          key: 'a',
          typFile: ctx.ops.lib.typFile,
          label: 'lib',
          mode: 'student',
          header: {
            title: 'Titel "met" \\ tekens',
            student: 'x#y $z$ *b*',
            group: '3a nat\n',
            exam: 'Toets',
            observaties: [HEADER_OBS[2], { icon: '❌', name: 'Rekenfout' }],
          },
        },
      ],
      { includeAnswers: true, duplex: true, outputName: 'opdrachten.pdf' },
    ],
  },
  {
    id: 'svg-preview-many-pages',
    path: 'C',
    rule: 'TC 10.6: preview with 10+ pages (page files sorted numerically), cursor marker on a late page',
    args: (ctx) => [
      'app:renderAssignmentSvg',
      ctx.ops['long-even'].typFile,
      'Veel pagina',
      ctx
        .typSource('long-even')
        .replace(
          '#let render_uitleg() = [',
          `#let render_uitleg() = [\n${'  #lorem(450)\n\n'.repeat(14)}`,
        )
        .replace(
          '[Een vraag na veel tekst.]',
          '[Een vraag na #metadata(none)<__rtti_cursor> veel tekst.]',
        ),
    ],
  },
  {
    id: 'rapport-one-student',
    path: 'A',
    rule: 'TC 10.8: rapport for one student (no histogram), bonus question',
    prepare: (dataDir) => sanitizeScores(dataDir),
    rapport: async (ctx) =>
      ctx.fns.compileRapport(
        ctx.Store.getExamsSync('2025-2026').find((e) => e.title === 'Toets één leerling'),
        '2025-2026',
      ),
  },
  {
    id: 'batch-error',
    path: 'D',
    rule: 'TC 4.3, 10.7: a failing job stops the batch; error text prefixed with the opdracht label',
    prepare: (dataDir) =>
      fs.writeFileSync(
        path.join(dataDir, 'opdrachten', 'kapot.typ'),
        '#import "lib.typ": *\n#let setup_extra() = []\n#let render_uitleg() = [ Uitleg\n#let render_opgaven() = []\n',
      ),
    args: (ctx) => [
      'app:renderAssignmentBatch',
      [
        {
          key: '1',
          typFile: ctx.ops.plain.typFile,
          label: 'Goed',
          mode: 'student',
          header: { title: 'Goed', student: 'Anna', group: '', exam: 'Toets', observaties: [] },
        },
        {
          key: '2',
          typFile: 'kapot.typ',
          label: 'Kapotte opdracht',
          mode: 'student',
          header: { title: 'Kapot', student: 'Bram', group: '', exam: 'Toets', observaties: [] },
        },
      ],
      { includeAnswers: true, duplex: true, outputName: 'opdrachten.pdf' },
    ],
  },
  {
    id: 'batch-duplex',
    path: 'D',
    rule: 'TC 4.3: batch of 4 students; blank page before a new student when the page count so far is odd; jobs of one student are not padded',
    args: (ctx) => {
      const job = (key, kind, student) => ({
        key,
        typFile: ctx.ops[kind].typFile,
        label: ctx.ops[kind].naam,
        mode: 'student',
        header: {
          title: ctx.ops[kind].naam,
          student,
          group: '3a nat',
          exam: 'Toets',
          observaties: HEADER_OBS.slice(0, 2),
        },
      });
      return [
        'app:renderAssignmentBatch',
        [
          job('1', 'long-odd', 'Anna'),
          job('2', 'long-odd', 'Bram'),
          job('2', 'plain', 'Bram'),
          job('3', 'long-even', 'Chloé'),
          job('4', 'plain', 'Daan'),
        ],
        { includeAnswers: true, duplex: true, outputName: 'opdrachten.pdf' },
      ];
    },
  },
  {
    id: 'batch-answer-key',
    path: 'D',
    rule: 'TC 4.3: answer key batch, no duplex padding',
    args: (ctx) => {
      const job = (kind) => ({
        key: ctx.ops[kind].id,
        typFile: ctx.ops[kind].typFile,
        label: ctx.ops[kind].naam,
        mode: 'answers',
        header: { title: ctx.ops[kind].naam },
      });
      return [
        'app:renderAssignmentBatch',
        [job('grid'), job('images'), job('long-odd')],
        { includeAnswers: true, duplex: false, outputName: 'antwoordsleutel.pdf' },
      ];
    },
  },
];
