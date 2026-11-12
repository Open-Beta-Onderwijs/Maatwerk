// SPDX-License-Identifier: AGPL-3.0-or-later

// The synthetic PO of the PO rapport (step 24b; no real student data): a projectgroep of three
// from two classes with group and own bonus/malus lines, a projectgroep of one, a placed student
// without a grade, an unplaced student. The rubric has a bonus and a diagnostic category,
// overlapping levels, a category with five levels and one without titles, and is long enough for
// two category pages. tests/golden/typst/rapport-po is built from this (po-rapport.test.ts).

import type { PoRapportInput } from '../../src/domain/po-rapport';
import type { Rubric } from '../../src/domain/rubric';
import type { Exam, Observatie, ScoreRecord, Student } from '../../src/domain/types';

export const EXAM_ID = 'po-valbeweging-2025-2026';

const lvl = (min: number, max: number, uitleg: string, titel = '') => ({ min, max, titel, uitleg });

export const RUBRIC: Rubric = {
  id: 'rub-valbeweging',
  naam: 'Onderzoek valbeweging',
  subject: 'nat',
  schoolsoort: ['vwo'],
  jaarlagen: ['5'],
  obs_ids: ['obs-po-eenheid'],
  categories: [
    {
      id: 'intro',
      naam: 'Introductie',
      max: 3,
      soort: 'normaal',
      obs_ids: [],
      niveaus: [
        lvl(0, 1, 'Achtergrondinformatie ontbreekt, de onderzoeksvraag is vaag.', 'Matig'),
        lvl(2, 2, 'Onderzoeksvraag duidelijk, achtergrond beperkt.', 'Redelijk'),
        lvl(3, 3, 'Heldere onderzoeksvraag met relevante achtergrond.', 'Goed'),
      ],
    },
    {
      id: 'vraag',
      naam: 'Onderzoeksvraag en hypothese',
      max: 4,
      soort: 'normaal',
      obs_ids: [],
      niveaus: [
        lvl(0, 0, 'Geen onderzoeksvraag.', 'Ontbreekt'),
        lvl(1, 1, 'Vraag aanwezig, niet onderzoekbaar.', 'Zwak'),
        lvl(2, 2, 'Onderzoekbare vraag zonder hypothese.', 'Matig'),
        lvl(3, 3, 'Vraag met hypothese, niet onderbouwd.', 'Goed'),
        lvl(4, 4, 'Vraag met een onderbouwde, toetsbare hypothese.', 'Uitstekend'),
      ],
    },
    {
      id: 'theorie',
      naam: 'Theorie',
      max: 8,
      soort: 'normaal',
      obs_ids: ['obs-po-formule'],
      niveaus: [
        lvl(0, 3, 'Theorie ontbreekt grotendeels of bevat fouten.', 'Matig'),
        lvl(2, 5, 'De belangrijkste formules worden genoemd, maar niet toegepast.', 'Voldoende'),
        lvl(4, 7, 'De formules worden toegepast op de eigen proef.', 'Goed'),
        lvl(6, 8, 'De theorie wordt verbonden met de resultaten.', 'Uitstekend'),
      ],
    },
    {
      id: 'opstelling',
      naam: 'Meetopstelling',
      max: 6,
      soort: 'normaal',
      obs_ids: [],
      niveaus: [
        lvl(0, 2, 'Opstelling niet beschreven of niet na te bouwen.'),
        lvl(3, 4, 'Opstelling beschreven, enkele details ontbreken.'),
        lvl(5, 6, 'Opstelling volledig beschreven met een schets en de meetinstrumenten.'),
      ],
    },
    {
      id: 'figuren',
      naam: 'Figuren',
      max: 6,
      soort: 'normaal',
      obs_ids: ['obs-po-grafiek'],
      niveaus: [
        lvl(0, 2, 'Figuren ontbreken of zijn onleesbaar.'),
        lvl(3, 4, 'Figuren aanwezig, de assen zijn niet volledig.'),
        lvl(5, 6, 'Figuren volledig, met grootheden, eenheden en een bijschrift.'),
      ],
    },
    {
      id: 'conclusie',
      naam: 'Conclusie',
      max: 5,
      soort: 'normaal',
      obs_ids: [],
      niveaus: [
        lvl(0, 1, 'Geen conclusie, of een conclusie die niet uit de metingen volgt.', 'Matig'),
        lvl(
          2,
          3,
          'Conclusie volgt uit de metingen, de onderzoeksvraag wordt half beantwoord.',
          'Voldoende',
        ),
        lvl(
          4,
          5,
          'Conclusie beantwoordt de onderzoeksvraag met de metingen als onderbouwing.',
          'Goed',
        ),
      ],
    },
    {
      id: 'discussie',
      naam: 'Discussie',
      max: 4,
      soort: 'normaal',
      obs_ids: [],
      niveaus: [
        lvl(0, 1, 'Geen discussie van de meetfouten.', 'Matig'),
        lvl(2, 3, 'Meetfouten genoemd, zonder hun invloed op het resultaat.', 'Voldoende'),
        lvl(4, 4, 'Meetfouten en hun invloed besproken, met een verbetering van de proef.', 'Goed'),
      ],
    },
    {
      id: 'origineel',
      naam: 'Originaliteit',
      max: 4,
      soort: 'bonus',
      obs_ids: [],
      niveaus: [
        lvl(0, 1, 'Voert de proef uit zoals beschreven.', 'Standaard'),
        lvl(2, 4, 'Een eigen variant van de proef of een extra meting.', 'Eigen inbreng'),
      ],
    },
    {
      id: 'samenwerking',
      naam: 'Samenwerking',
      max: 3,
      soort: 'diagnostisch',
      obs_ids: [],
      niveaus: [
        lvl(0, 1, 'De taken zijn niet verdeeld.', 'Matig'),
        lvl(2, 3, 'Iedereen had een eigen taak en hield zich eraan.', 'Goed'),
      ],
    },
  ],
};

export const OBSERVATIES: Observatie[] = [
  {
    id: 'obs-po-formule',
    icon: '➗',
    naam: 'Formule verkeerd omgeschreven',
    uitleg: 'Bij het omschrijven van een formule is een fout gemaakt.',
    leeradvies:
      'Schrijf bij het omschrijven elke stap op een *nieuwe regel* en doe links en rechts van het =-teken hetzelfde. Controleer daarna met de eenheden.',
    toetstypes: ['po'],
  },
  {
    id: 'obs-po-grafiek',
    icon: '📈',
    naam: 'Grafiek: aslabels vergeten',
    uitleg: 'Bij een grafiek ontbreekt de grootheid of de eenheid op een as.',
    leeradvies: 'Zet bij elke as de grootheid en de eenheid, bijvoorbeeld $t$ (s).',
    toetstypes: ['po'],
  },
  {
    id: 'obs-po-eenheid',
    icon: '📏',
    naam: 'Eenheid vergeten / verkeerd',
    uitleg: 'Bij een antwoord ontbreekt de eenheid of staat een verkeerde eenheid.',
    leeradvies:
      'Controleer bij elk antwoord of de eenheid erbij staat. Gebruik de GFBA-methode (Gegevens, Formule, Berekening en Antwoord).',
    toetstypes: ['toets', 'po'],
  },
];

const student = (id: string, voornaam: string, achternaam: string, tussenvoegsel = ''): Student =>
  ({ id, voornaam, tussenvoegsel, achternaam, stamklas: '5' }) as Student;

export const STUDENTS: Student[] = [
  student('900101', 'Sem', 'Dijkstra'),
  student('900102', 'Emma', 'Kok'),
  student('900103', 'Bas', 'Vos'),
  student('900104', 'Fleur', 'Wit', 'de'),
  student('900105', 'Daan', 'Jansen'),
  student('900106', 'Lotte', 'Bakker'),
];

export const CLASSES: Record<string, string> = {
  '900101': '5A',
  '900102': '5A',
  '900103': '5B',
  '900104': '5B',
  '900105': '5A',
  '900106': '5B',
};

export const EXAM = {
  id: EXAM_ID,
  kind: 'po',
  title: 'PO Onderzoek valbeweging',
  subject: 'nat',
  schoolsoort: 'vwo',
  jaarlaag: '5',
  rubric_id: RUBRIC.id,
  n_term: 1,
  questions: [],
  projectgroepen: [
    { id: 'pg-1', naam: 'Valtoren', student_ids: ['900102', '900103', '900101'] },
    { id: 'pg-2', naam: '', student_ids: ['900104'] },
    { id: 'pg-3', naam: 'Lichtsluis', student_ids: ['900105'] },
  ],
} as unknown as Exam;

const valtoren = {
  scores: {
    intro: 2,
    vraag: 3,
    theorie: 6,
    opstelling: 5,
    figuren: 4,
    conclusie: 3,
    discussie: 2,
    origineel: 2,
    samenwerking: 2,
  },
  observations: ['obs-po-eenheid'],
  po: {
    projectgroep: 'pg-1',
    categoryObs: { theorie: ['obs-po-formule'], figuren: ['obs-po-grafiek'] },
    categoryComments: {
      theorie: 'Formules goed gekozen; de afleiding van g uit de helling ontbreekt.',
      figuren: 'Grafiek 2 mist de eenheden op de y-as.',
      origineel: 'Mooi dat jullie ook met een lichtsluis hebben gemeten.',
    },
    comment:
      'Een nette proef met een goed gekozen meetopstelling. Jullie conclusie volgt uit de metingen, maar laat de afleiding van g zien en zorg dat elke grafiek compleet is. Het verslag kwam een dag te laat binnen.',
    groupLines: [{ label: 'Verslag een dag te laat ingeleverd', value: -0.5 }],
  },
};

function record(
  g: typeof valtoren | null,
  ownLines: { label: string; value: number }[] = [],
): ScoreRecord {
  if (!g) return {} as ScoreRecord;
  return {
    scores: { [EXAM_ID]: { ...g.scores } },
    observations: { [EXAM_ID]: [...g.observations] },
    po: { [EXAM_ID]: { ...structuredClone(g.po), ownLines } },
  } as ScoreRecord;
}

const fleur = {
  scores: {
    intro: 3,
    vraag: 4,
    theorie: 7,
    opstelling: 6,
    figuren: 5,
    conclusie: 4,
    discussie: 3,
  },
  observations: [],
  po: {
    projectgroep: 'pg-2',
    categoryObs: {},
    categoryComments: { conclusie: 'Sterk: je koppelt de conclusie aan je hypothese.' },
    comment: '',
    groupLines: [],
  },
} as unknown as typeof valtoren;

export const RECORDS: Record<string, ScoreRecord> = {
  '900101': record(valtoren, [{ label: 'Extra meting met de lichtsluis gedaan', value: 0.3 }]),
  '900102': record(valtoren),
  '900103': record(valtoren, [{ label: 'Niet meegewerkt aan de metingen', value: -0.5 }]),
  '900104': record(fleur),
  '900105': record(null),
  '900106': record(null),
};

export function fixtureInput(): PoRapportInput {
  return {
    exam: EXAM,
    rubric: RUBRIC,
    students: new Map(STUDENTS.map((s) => [String(s.id), s])),
    records: new Map(Object.entries(RECORDS)),
    classTag: (id) => CLASSES[id] ?? '—',
    observaties: OBSERVATIES,
  };
}
