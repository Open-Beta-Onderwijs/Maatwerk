// SPDX-License-Identifier: AGPL-3.0-or-later
// CSV import: parseCSV, student rows, group rows, group assignment rows
// (business-rules.md section 9, candidates 44-45).

import { Suite } from '../golden.mjs';
import { bindFunctions, extractConst, extractFunction, extractSnippet } from '../extract.mjs';
import { openReference } from '../session.mjs';
import { YEAR, buildData, student } from '../scenario.mjs';

const CSV = 'renderer/utils/csv.js';
const LE = 'renderer/modals/leerling-edit.js';
const GE = 'renderer/modals/groep-edit.js';
const APP = 'renderer/app.js';

const TEXTS = {
  semicolon: 'a;b;c\n1;2;3\n',
  comma: 'a,b,c\n1,2,3',
  tie: 'a;b,c\n1;2,3',
  'tie-none': 'abc\n1',
  'quoted-delimiter': 'naam;plaats\n"Jansen; Piet";"Den Haag"',
  'doubled-quotes': 'naam;quote\n"Piet";"Hij zei ""hoi"""',
  bom: '﻿Leerlingnummer;Achternaam\n123;Jansen',
  crlf: 'a;b\r\n1;2\r\n3;4\r\n',
  'trailing-empty-lines': 'a;b\n1;2\n\n\n',
  'blank-middle-line': 'a;b\n1;2\n   \n3;4',
  'short-row': 'a;b;c\n1',
  'long-row': 'a;b\n1;2;3;4',
  'header-only': 'a;b;c',
  empty: '',
  'whitespace-fields': ' a ; b \n 1 ;  2  ',
  'quoted-header': '"a";"b"\n"1";2',
  'unbalanced-quote': 'a;b\n"1;2\n3;4',
  'duplicate-headers': 'a;a\n1;2',
  'leading-blank-lines': '\n\na;b\n1;2',
};

const STUDENT_CSV = [
  'Leerlingnummer;Voornaam;Tussenvoegsel;Achternaam;Geslacht;Stamklas;Jaarlaag;Schoolsoort',
  '00123;Anna;van der;Berg;V;3a;3;"Havo,Vwo"',
  '124;Bram;;;M;3a;3;Havo',
  'abc;Chloé;;Zwart;V;3b; 3 ;',
  ';Daan;;Dijk;M;3b;3;Vwo',
  '0;Nul;;Nul;X;3b;3;Vwo',
  '125;Emma;;Bakker;V;3c;3; Havo , ,Vwo ',
  '1.5e2;Exp;;Onent;X;3c;3;Havo',
].join('\n');
const STUDENT_CSV_LOWER =
  'leerlingnummer,voornaam,achternaam,jaarlaag,schoolsoort\n200,piet,puk,4,"havo"';

const GROUP_CSV = [
  'Naam;Schoolsoort;Vak;Leerjaar;Docent',
  '3a nat;Havo;nat;3;Docent van Natuur',
  '3b nat;havo;Natuurkunde;3;docent van natuur',
  '4 wisb;Vwo;Wiskunde;4;Onbekende Docent',
  ';Havo;nat;3;',
  '3c nat;Mavo;nat;3;',
  '3d nat;Havo;scheikunde;3;',
  '3e nat;Havo;Aardrijkskunde;3;',
  '7a nat;Havo;nat;7;',
  '3f nat;Havo;nat; 3;',
  'Groep ü;Vmbo-tl;bio;2;',
].join('\n');

const ASSIGN_CSV = [
  'Naam;Leerlingnummer',
  '3a nat;1',
  '3a nat;2',
  '3a nat;1',
  'bestaat niet;1',
  '3b nat;999',
  '3B NAT;2',
  '3b nat; 3 ',
  '3b nat;003',
].join('\n');

export default async function csv() {
  const suite = new Suite('csv', 'CSV parsing and import row mapping.');
  const { fns: p, refs: pRefs } = bindFunctions([extractFunction(CSV, 'parseCSV')]);
  suite.ref(pRefs);
  for (const [id, text] of Object.entries(TEXTS))
    suite.add(`parseCSV-${id}`, 'BR 9.1, 11.44', { text }, p.parseCSV(text));

  const studentRows = extractSnippet(LE, {
    start: 250,
    end: 269,
    name: 'studentRows',
    params: ['parsed'],
    contains: [
      "Number(r['Leerlingnummer'] ?? r['leerlingnummer'])",
      '.filter((s) => s.id && s.achternaam);',
    ],
    epilogue: 'return students;',
  });
  const st = bindFunctions([studentRows]);
  suite.ref(st.refs);
  for (const [id, text] of [
    ['student-csv', STUDENT_CSV],
    ['student-csv-lowercase-comma', STUDENT_CSV_LOWER],
  ]) {
    const parsed = p.parseCSV(text).rows;
    suite.add(
      id,
      'BR 9.2, 11.45',
      { text },
      { rows: parsed, students: st.fns.studentRows(parsed) },
    );
  }

  const s = await openReference({
    fixture: (dir) =>
      buildData(dir, {
        years: {
          [YEAR]: {
            students: [student(1), student(2), student(3)],
            groups: [
              {
                id: '3a-nat-2025-2026',
                name: '3a nat',
                jaarlaag: '3',
                subject: 'nat',
                student_ids: [2],
              },
              {
                id: '3b-nat-2025-2026',
                name: '3b nat',
                jaarlaag: '3',
                subject: 'nat',
                student_ids: [],
              },
            ],
          },
        },
      }),
    subject: 'nat',
  });
  try {
    const { Store } = s;
    const users = [
      { id: 'admin', voornaam: 'Administrator', tussenvoegsel: '', achternaam: '' },
      { id: 'gebr-1', voornaam: 'Docent', tussenvoegsel: 'van', achternaam: 'Natuur' },
    ];
    const groupRows = extractSnippet(GE, {
      start: 483,
      end: 545,
      name: 'groupRows',
      params: ['rows', 'users', 'year'],
      contains: [
        "const naam = (r['Naam'] ?? '').trim();",
        'subcategory: parsed.subcategory ?? undefined,',
      ],
      prologue: 'const toImport = [];',
      epilogue: 'return toImport;',
    });
    const assignRows = extractSnippet(GE, {
      start: 605,
      end: 629,
      name: 'assignRows',
      params: ['rows', 'year'],
      contains: [
        'const groups = Store.getGroupsSync(year, null);',
        'assignments.push({ groupId: group.id, studentId: student.id });',
      ],
      prologue: 'let assignments = null;',
      epilogue: 'return assignments;',
    });
    const applyAssign = extractSnippet(GE, {
      start: 641,
      end: 653,
      name: 'applyAssignments',
      params: ['assignments', 'year'],
      contains: ['const newIds = [...new Set([...group.student_ids, ...studentIds])];'],
    });
    applyAssign.source = applyAssign.source.replace(/^function /, 'async function ');
    const toasts = [];
    const ge = bindFunctions(
      [
        extractConst(GE, 'VALID_SCHOOLSOORTEN'),
        extractConst(GE, 'VAKKEN_MAP'),
        extractConst(GE, 'VALID_JAARLAGEN'),
        extractFunction(APP, 'escHtml'),
        groupRows,
        assignRows,
        applyAssign,
      ],
      { Store, toast: (...a) => toasts.push(a) },
    );
    suite.ref(ge.refs);
    const gRows = p.parseCSV(GROUP_CSV).rows;
    suite.add(
      'group-csv',
      'BR 9.3',
      { text: GROUP_CSV, users, year: YEAR },
      { groups: ge.fns.groupRows(gRows, users, YEAR), toasts: toasts.splice(0) },
    );

    // The import runs in the admin view, which loads all groups of the year.
    await Store.loadYear(YEAR, null);
    const aRows = p.parseCSV(ASSIGN_CSV).rows;
    const assignments = ge.fns.assignRows(aRows, YEAR);
    const aToasts = toasts.splice(0);
    await ge.fns.applyAssignments(assignments, YEAR);
    const after = (await Store.getGroups(YEAR, null)).map((g) => ({
      id: g.id,
      student_ids: g.student_ids,
    }));
    suite.add(
      'group-assignment-csv',
      'BR 9.4',
      { text: ASSIGN_CSV, groupsBefore: { '3a nat': [2], '3b nat': [] } },
      { assignments, toasts: aToasts, groupsAfter: after },
    );
  } finally {
    s.dispose();
  }
  return suite;
}
