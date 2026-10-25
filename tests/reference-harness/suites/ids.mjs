// SPDX-License-Identifier: AGPL-3.0-or-later
// Ids, slugs, names, dates: makeExamId, makeGroupId, currentSchoolYear,
// volgnummer and _meta on upsertExam, student name helpers
// (business-rules.md section 10, data-files.md "IDs and slugs", candidates 46-47).

import { Suite, capture } from '../golden.mjs';
import { extractFunction, refOf } from '../extract.mjs';
import { DEFAULT_NOW, freezeClock } from '../environment.mjs';
import { openReference } from '../session.mjs';
import { YEAR, buildData, exam, student } from '../scenario.mjs';

const STORE = 'renderer/store.js';

export default async function ids() {
  const suite = new Suite('ids', 'Ids, slugs, names, school year and exam sequence numbers.');
  suite.ref(
    [
      'makeExamId',
      'makeGroupId',
      'currentSchoolYear',
      'fullName',
      'jaarlaagFromStamklas',
      'sortStudents',
      'subjectFromGroupName',
      'parseGroupName',
      'upsertExam',
      'stampMeta',
      'saveEntity',
    ].map((n) => refOf(extractFunction(STORE, n))),
  );
  const existing = [
    exam('nat-a-2025-2026', [[2, 'R']], { jaarlaag: '4', volgnummer: 401 }),
    exam('nat-b-2025-2026', [[2, 'R']], { jaarlaag: 4, volgnummer: 402 }),
    exam('nat-c-2025-2026', [[2, 'R']], { jaarlaag: '5', volgnummer: 599 }),
    exam('bio-d-2025-2026', [[2, 'R']], { jaarlaag: '4', volgnummer: 410, subject: 'bio' }),
  ];
  const s = await openReference({
    fixture: (dir) =>
      buildData(dir, { years: { [YEAR]: { students: [student(1)], exams: existing } } }),
    subject: 'nat',
  });
  try {
    const { Store } = s;

    const titles = [
      'Toets H1 Krachten & Énergie',
      '  --Spaties--  ',
      'ÄÖÜ',
      '',
      'SE 2: H3/H4',
      'Toets — INHAAL',
      'a_b.c',
    ];
    suite.add(
      'makeExamId',
      'DF ids, BR 11.47',
      { titles, years: [YEAR, '2025/2026'], subjects: [undefined, 'wi'] },
      titles.flatMap((t) =>
        [YEAR, '2025/2026'].flatMap((y) => [Store.makeExamId(t, y), Store.makeExamId(t, y, 'wi')]),
      ),
    );
    const groupNames = ['3a nat', '3A-NAT', 'Groep ü 1', '', '4 wisB cluster'];
    suite.add(
      'makeGroupId',
      'DF ids',
      { names: groupNames, years: [YEAR, '2025/2026'] },
      groupNames.flatMap((n) => [Store.makeGroupId(n, YEAR), Store.makeGroupId(n, '2025/2026')]),
    );

    const clocks = [
      '2026-07-31T23:59:59',
      '2026-08-01T00:00:00',
      '2026-01-01T00:00:00',
      '2025-12-31T23:59:59',
      '2026-07-31T23:30:00Z',
    ];
    suite.add(
      'currentSchoolYear',
      'BR 10, 11.46 (local time Europe/Amsterdam)',
      { clocks },
      clocks.map((c) => {
        const restore = freezeClock(c);
        try {
          return Store.currentSchoolYear();
        } finally {
          restore();
          freezeClock(DEFAULT_NOW);
        }
      }),
    );

    const people = [
      { voornaam: 'Anna', tussenvoegsel: 'van der', achternaam: 'Berg' },
      { voornaam: 'Anna', tussenvoegsel: '', achternaam: '' },
      { voornaam: '', tussenvoegsel: 'de', achternaam: 'Vries' },
      { id: 7, name: 'Oude Naam' },
      { id: 8 },
      { id: 9, voornaam: null, achternaam: undefined },
    ];
    suite.add(
      'fullName',
      'store.js fullName',
      { people },
      people.map((p) => Store.fullName(p)),
    );

    const klassen = ['3a', '10b', 'a3', '', null, undefined, 4, '05c'];
    suite.add(
      'jaarlaagFromStamklas',
      'store.js',
      { klassen },
      klassen.map((k) => Store.jaarlaagFromStamklas(k)),
    );

    const list = [
      { id: 1, stamklas: '10a', achternaam: 'Zwart' },
      { id: 2, stamklas: '9b', achternaam: 'Appel' },
      { id: 3, stamklas: '9a', achternaam: 'Ösch' },
      { id: 4, stamklas: '9a', achternaam: 'Oost' },
      { id: 5, stamklas: '9a', achternaam: 'de Boer' },
      { id: 6, achternaam: 'Geen' },
      { id: 7, stamklas: '9A', achternaam: 'Hoofd' },
    ];
    suite.add(
      'sortStudents',
      'store.js sortStudents (default locale pinned to nl-NL)',
      { list },
      Store.sortStudents(structuredClone(list)).map((x) => x.id),
    );

    const names = [
      '3a nat',
      '4 biol',
      '5 schk',
      '2 wis',
      '4 wisa',
      '5 wisb',
      '3 wiskunde',
      '4awi',
      'Natuur 4',
      'geen',
      '',
      null,
    ];
    suite.add(
      'group-name-parsing',
      'store.js subjectFromGroupName, parseGroupName',
      { names },
      names.map((n) => ({
        subject: Store.subjectFromGroupName(n),
        nat: Store.parseGroupName(n, 'nat'),
        wi: Store.parseGroupName(n, 'wi'),
      })),
    );

    // volgnummer of a new exam (candidate 47) and _meta stamping on save.
    const fresh = [
      exam('nat-nieuw-4-2025-2026', [[2, 'R']], { jaarlaag: '4', volgnummer: undefined }),
      exam('nat-nieuw-5-2025-2026', [[2, 'R']], { jaarlaag: '5', volgnummer: undefined }),
      exam('nat-nieuw-6-2025-2026', [[2, 'R']], { jaarlaag: '6', volgnummer: undefined }),
      exam('nat-nieuw-x-2025-2026', [[2, 'R']], { jaarlaag: 'x', volgnummer: undefined }),
      exam('nat-nieuw-vast-2025-2026', [[2, 'R']], { jaarlaag: '4', volgnummer: 777 }),
      { ...existing[0], title: 'Gewijzigd', volgnummer: undefined },
    ];
    Store.setActiveUser({ id: 'gebr-1756713600001', isAdmin: false });
    const out = [];
    for (const e of fresh) {
      const saved = await capture(() => Store.upsertExam(structuredClone(e), YEAR));
      out.push(
        saved.$throws
          ? saved
          : { id: saved.id, volgnummer: saved.volgnummer, title: saved.title, _meta: saved._meta },
      );
    }
    suite.add(
      'upsertExam-volgnummer-meta',
      'BR 10, 11.47, DF _meta',
      { existing, fresh, now: DEFAULT_NOW },
      out,
    );
  } finally {
    s.dispose();
  }
  return suite;
}
