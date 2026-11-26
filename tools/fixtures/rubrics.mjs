// SPDX-License-Identifier: AGPL-3.0-or-later
// The step 21 additions to the fixtures (format 0.12, data-files-v3.md "Rubrics"): three
// natuurkunde rubrics and four PO observaties, written by tools/fixtures/generate.mjs.

const META = {
  rev: 1,
  createdBy: 'gebr-1756713600001',
  createdAt: '2025-09-01T08:00:00.000Z',
  updatedBy: 'gebr-1756713600001',
  updatedAt: '2025-09-01T08:00:00.000Z',
};

/** Two to five niveaus from [min, max, titel, uitleg] rows. */
const niveaus = (rows) => rows.map(([min, max, titel, uitleg]) => ({ min, max, titel, uitleg }));

/** PO observaties (toetstype `po`) for natuurkunde (step 21, data-files-v3.md "Rubrics"). */
export const PO_OBSERVATIES = [
  ['obs-po-bronnen', 'Bronnen ontbreken', '📚', ['po']],
  ['obs-po-samen', 'Goed samengewerkt', '🤝', ['po']],
  ['obs-po-planning', 'Planning niet gehaald', '⏰', ['po']],
  ['obs-po-netjes', 'Netjes gewerkt', '✨', ['toets', 'po']],
].map(([id, naam, icon, toetstypes]) => ({
  id,
  naam,
  icon,
  uitleg: `Uitleg bij ${naam.toLowerCase()}.`,
  leeradvies: '',
  schoolsoort: ['Havo', 'Vwo'],
  subjects: ['nat'],
  jaarlagen: [],
  toetstypes,
  _meta: META,
}));

/** Three natuurkunde rubrics: one with bonus and diagnostic categories (board 16's example). */
export const RUBRICS = [
  {
    id: 'rubric-onderzoek',
    naam: 'Onderzoeksverslag',
    beschrijving: 'Verslag van een eigen onderzoek.',
    subject: 'nat',
    schoolsoort: ['Havo', 'Vwo'],
    jaarlagen: ['3', '4'],
    obs_ids: ['obs-po-planning', 'obs-po-netjes'],
    categories: [
      {
        id: 'cat-theorie',
        naam: 'Theorie',
        max: 8,
        soort: 'normaal',
        obs_ids: ['obs-po-bronnen'],
        niveaus: niveaus([
          [0, 2, 'Onvoldoende', 'De theorie ontbreekt of klopt niet.'],
          [3, 5, 'Voldoende', 'De belangrijkste begrippen zijn goed uitgelegd.'],
          [6, 8, 'Goed', 'Volledig, met bronnen en eigen voorbeelden.'],
        ]),
      },
      {
        id: 'cat-uitvoering',
        naam: 'Uitvoering',
        max: 9,
        soort: 'normaal',
        obs_ids: [],
        niveaus: niveaus([
          [0, 4, '', 'Metingen onvolledig of onnauwkeurig.'],
          [5, 9, '', 'Metingen volledig, herhaald en nauwkeurig.'],
        ]),
      },
      {
        id: 'cat-extra',
        naam: 'Extra onderzoek',
        max: 4,
        soort: 'bonus',
        obs_ids: [],
        niveaus: niveaus([
          [0, 1, '', 'Geen of weinig extra.'],
          [2, 4, '', 'Een eigen vervolgvraag onderzocht.'],
        ]),
      },
      {
        id: 'cat-samen',
        naam: 'Samenwerken',
        max: 3,
        soort: 'diagnostisch',
        obs_ids: ['obs-po-samen'],
        niveaus: niveaus([
          [0, 1, '', 'Taken niet verdeeld.'],
          [2, 3, '', 'Taken verdeeld en afspraken nagekomen.'],
        ]),
      },
    ],
    _meta: META,
  },
  {
    id: 'rubric-practicum',
    naam: 'Practicum',
    subject: 'nat',
    schoolsoort: ['Havo'],
    jaarlagen: ['3'],
    obs_ids: [],
    categories: [
      ['cat-voorbereiding', 'Voorbereiding', 4],
      ['cat-meten', 'Meten', 6],
      ['cat-verslag', 'Verslag', 5],
    ].map(([id, naam, max]) => ({
      id,
      naam,
      max,
      soort: 'normaal',
      obs_ids: [],
      niveaus: niveaus([
        [0, Math.floor(max / 2), '', `${naam}: onvoldoende.`],
        [Math.floor(max / 2) + 1, max, '', `${naam}: voldoende.`],
      ]),
    })),
    _meta: META,
  },
  {
    id: 'rubric-presentatie',
    naam: 'Presentatie',
    subject: 'nat',
    schoolsoort: ['Vwo'],
    jaarlagen: ['4', '5', '6'],
    obs_ids: [],
    categories: [
      {
        id: 'cat-inhoud',
        naam: 'Inhoud',
        max: 6,
        soort: 'normaal',
        obs_ids: [],
        niveaus: niveaus([
          [0, 2, 'Zwak', 'Onjuist of onvolledig.'],
          [2, 4, 'Redelijk', 'Grotendeels juist.'],
          [5, 6, 'Sterk', 'Juist en volledig.'],
        ]),
      },
      {
        id: 'cat-vorm',
        naam: 'Vorm',
        max: 4,
        soort: 'normaal',
        obs_ids: [],
        niveaus: niveaus([
          [0, 1, '', 'Rommelig, slecht te volgen.'],
          [2, 4, '', 'Helder opgebouwd.'],
        ]),
      },
    ],
    _meta: META,
  },
];
