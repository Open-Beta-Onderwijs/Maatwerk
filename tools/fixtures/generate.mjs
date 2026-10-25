// SPDX-License-Identifier: AGPL-3.0-or-later
// Deterministic generator of synthetic `data/` folders in the reference (v1)
// format (docs/reference/data-files.md). No real student data: every name is
// assembled from the lists below with a seeded PRNG.
//
//   node tools/fixtures/generate.mjs <tiny|school> <outDir>
//
// The same name always produces byte-identical files (tools/fixtures/manifest.json).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YEAR = '2025-2026';
const PREV_YEAR = '2024-2025';
const SUBJECTS = ['nat', 'bio', 'schk', 'wi'];
const SUBJECT_LABEL = { nat: 'nat', bio: 'biol', schk: 'schk', wi: 'wi' };
const T0 = Date.UTC(2025, 8, 1, 8, 0, 0); // 2025-09-01T08:00:00Z, base for ids and _meta

// mulberry32: small, fast, good enough for fixtures.
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

const VOORNAMEN = [
  'Anna',
  'Bram',
  'Chloé',
  'Daan',
  'Emma',
  'Finn',
  'Gijs',
  'Hanna',
  'Iris',
  'Jesse',
  'Kiki',
  'Lars',
  'Mila',
  'Noah',
  'Olivia',
  'Pim',
  'Roos',
  'Sem',
  'Tess',
  'Vera',
  'Wout',
  'Yara',
  'Zoë',
  'Anaïs',
  'Björn',
  'Ömer',
  'Saša',
  'José',
];
const ACHTERNAMEN = [
  'Bakker',
  'Visser',
  'Smit',
  'Meijer',
  'Mulder',
  'Bos',
  'Vos',
  'Peters',
  'Hendriks',
  'Dekker',
  'Brouwer',
  'Kok',
  'Jacobs',
  'Willems',
  'Schouten',
  'Kramer',
  'Prins',
  'Postma',
  'Kuipers',
  'Veenstra',
  'Çelik',
  'Ðorđević',
  'Østergaard',
];
const TUSSENVOEGSELS = ['', '', '', '', 'van', 'de', 'van der', 'van den', "'t", 'in het', 'ter'];
// Names that stress escaping and layout (docs/reference/quirks.md, Typst strings).
const SPECIAL_NAMES = [
  { voornaam: "D'Angelo", tussenvoegsel: '', achternaam: "O'Neill" },
  { voornaam: 'Marie-Claire', tussenvoegsel: "'t", achternaam: 'Hart' },
  {
    voornaam: 'Maximiliaan Alexander Constantijn',
    tussenvoegsel: 'van der',
    achternaam: 'Wiel-Brandsma de Clercq-Zubli van Hoogstraten',
  },
  { voornaam: 'Hash#Tag', tussenvoegsel: '', achternaam: 'Dollar$ "Quote" \\Back' },
  { voornaam: '@At', tussenvoegsel: '', achternaam: '<Angle> *ster* _under_' },
  { voornaam: 'Ëlla', tussenvoegsel: 'de', achternaam: 'Ruïne' },
];
const OBS_ICONS = ['📏', '🧮', '✏️', '⚠️', '🔬', '👩‍🔬', '🇳🇱', '❌', '✅', '💡'];
const OBS_NAMEN = [
  'Eenheden vergeten',
  'Rekenfout',
  'Formule niet genoteerd',
  'Significantie',
  'Begrippen door elkaar',
  'Grafiek onvolledig',
  'Antwoord niet onderbouwd',
  'Leesfout in de vraag',
];

const iso = (ms) => new Date(ms).toISOString();
const meta = (ms, by, rev = 1) => ({
  rev,
  createdBy: by,
  createdAt: iso(ms),
  updatedBy: by,
  updatedAt: iso(ms + 86_400_000),
});
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
// Mirrors Store.makeExamId (store.js:757-763) for the ids written into fixtures.
const examId = (subject, title, year) => `${subject}-${slug(title)}-${year.replace('/', '-')}`;
const groupId = (name, year) => `${slug(name)}-${year}`;

function writeJson(root, rel, data) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2));
}
function writeText(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
function copyAsset(root, asset, rel) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(path.join(HERE, 'assets', asset), abs);
}

const PROFILES = {
  tiny: {
    seed: 1,
    jaarlagen: ['3'],
    klassenPerJaar: 1,
    perKlas: 8,
    subjects: ['nat'],
    examsPerVak: 3,
    prevYear: false,
  },
  school: {
    seed: 2026,
    jaarlagen: ['1', '2', '3', '4', '5', '6'],
    klassenPerJaar: 4,
    perKlas: 25,
    subjects: SUBJECTS,
    examsPerVak: 4,
    prevYear: true,
  },
};

function schoolsoortFor(jaarlaag, klasIdx) {
  if (Number(jaarlaag) <= 3) return klasIdx % 2 === 0 ? ['Havo', 'Vwo'] : ['Havo'];
  return [klasIdx % 2 === 0 ? 'Vwo' : 'Havo'];
}

function makeUsers() {
  return [
    {
      id: 'admin',
      voornaam: 'Administrator',
      tussenvoegsel: '',
      achternaam: '',
      afkorting: 'ADM',
      vakken: SUBJECTS,
      kleur: '#c0392b',
      foto: null,
      isAdmin: true,
      actief: true,
    },
    {
      id: 'gebr-1756713600001',
      voornaam: 'Docent',
      tussenvoegsel: 'van',
      achternaam: 'Natuur',
      afkorting: 'DVN',
      schoolsoort: ['Havo', 'Vwo'],
      vakken: ['nat', 'schk'],
      kleur: '#2e86de',
      foto: 'fotos/gebr-1756713600001.png',
      isAdmin: false,
      actief: true,
    },
    {
      id: 'gebr-1756713600002',
      voornaam: 'Docent',
      tussenvoegsel: '',
      achternaam: 'Leven',
      afkorting: 'DLE',
      schoolsoort: ['Havo'],
      vakken: ['bio'],
      kleur: '#27ae60',
      foto: null,
      isAdmin: false,
      actief: true,
    },
    {
      id: 'gebr-1756713600003',
      voornaam: 'Docent',
      tussenvoegsel: 'de',
      achternaam: 'Som',
      afkorting: 'DDS',
      schoolsoort: ['Vwo'],
      vakken: ['wi'],
      kleur: '#8e44ad',
      foto: null,
      isAdmin: false,
      actief: false,
    },
  ];
}

function makeStudents(p, r) {
  const students = [];
  let nr = 900001;
  let special = 0;
  for (const jl of p.jaarlagen) {
    for (let k = 0; k < p.klassenPerJaar; k++) {
      const stamklas = `${jl}${String.fromCharCode(97 + k)}`;
      for (let i = 0; i < p.perKlas; i++) {
        const name =
          i < 2 && special < SPECIAL_NAMES.length
            ? SPECIAL_NAMES[special++]
            : {
                voornaam: r.pick(VOORNAMEN),
                tussenvoegsel: r.pick(TUSSENVOEGSELS),
                achternaam: r.pick(ACHTERNAMEN),
              };
        students.push({
          id: nr++,
          ...name,
          stamklas,
          geslacht: r.pick(['M', 'V', 'X']),
          jaarlaag: jl,
          schoolsoort: schoolsoortFor(jl, k),
        });
      }
    }
  }
  return students;
}

function makeGroups(p, students) {
  const groups = [];
  for (const subject of p.subjects) {
    for (const jl of p.jaarlagen) {
      for (let k = 0; k < p.klassenPerJaar; k++) {
        const stamklas = `${jl}${String.fromCharCode(97 + k)}`;
        const name = `${stamklas} ${SUBJECT_LABEL[subject]}`;
        const ids = students.filter((s) => s.stamklas === stamklas).map((s) => s.id);
        groups.push({
          id: groupId(name, YEAR),
          name,
          jaarlaag: jl,
          subject,
          schoolsoort: schoolsoortFor(jl, k),
          docenten: ['gebr-1756713600001'],
          student_ids: ids,
          _meta: meta(T0, 'gebr-1756713600001'),
        });
      }
    }
    // A cluster group: its students are also in their stamklas group (students in several groups).
    const jl = p.jaarlagen[p.jaarlagen.length - 1];
    const cluster = students
      .filter((s) => s.jaarlaag === jl)
      .filter((_, i) => i % 3 === 0)
      .map((s) => s.id);
    const name = `${jl} ${SUBJECT_LABEL[subject]} cluster`;
    groups.push({
      id: groupId(name, YEAR),
      name,
      jaarlaag: jl,
      subject,
      schoolsoort: ['Havo', 'Vwo'],
      docenten: [],
      student_ids: cluster,
      _meta: meta(T0, 'admin'),
    });
  }
  return groups;
}

function makeObservaties(p) {
  const out = [];
  let n = 0;
  for (const subject of p.subjects) {
    for (let i = 0; i < 4; i++) {
      const id = `obs-${T0 + 100 + n}`;
      const subjects =
        subject === 'wi' ? (i % 2 ? ['wisb'] : ['wisob']) : i === 3 ? [subject, 'schk'] : [subject];
      out.push({
        id,
        naam: OBS_NAMEN[n % OBS_NAMEN.length],
        icon: OBS_ICONS[n % OBS_ICONS.length],
        uitleg: `Uitleg bij observatie ${n + 1}.`,
        leeradvies: i === 2 ? '' : `Leeradvies bij observatie ${n + 1}.`,
        schoolsoort: i === 1 ? ['Vwo'] : ['Havo', 'Vwo'],
        subjects,
        jaarlagen: i === 0 ? [] : p.jaarlagen.slice(0, 3),
        _meta: meta(T0, 'gebr-1756713600001', 2),
      });
      n++;
    }
  }
  return out;
}

// Opdracht Typst sources covering the cases listed in PLAN.md Step 2a.
function opdrachtTyp(kind, id) {
  const head = '#import "lib.typ": *\n\n#let setup_extra() = []\n\n';
  const uitleg = (body) => `#let render_uitleg() = [\n${body}\n]\n\n`;
  const filler = (n) =>
    Array.from(
      { length: n },
      (_, i) => `  Alinea ${i + 1}. ${'Dit is opvultekst om de pagina te vullen. '.repeat(12)}\n`,
    ).join('\n');
  switch (kind) {
    case 'images':
      return (
        head +
        uitleg(
          `  Uitleg met drie figuren.\n\n  #figure(image("images/${id}/figuur.png", width: 60%), caption: [Een PNG.]) <fig-png>\n  #figure(image("images/${id}/foto.jpg", width: 40%), caption: [Een JPG.])\n  #figure(image("images/${id}/schema.svg", width: 50%), caption: [Een SVG.])`,
        ) +
        `#let render_opgaven() = [\n  #opgave(titel: "Figuren")[\n    Zie @fig-png.\n\n    #vraag(punten: 2, antwoord: [Een rechte lijn.])[Wat zie je in de figuur?]\n    #vraag(punten: 1.5, antwoord: [$v = s / t$])[Geef de formule.]\n  ]\n]\n`
      );
    case 'zero-vragen':
      return (
        head +
        uitleg('  Alleen uitleg, geen vragen.') +
        '#let render_opgaven() = [\n  #opgave(titel: "Lezen")[\n    Lees de tekst hierboven.\n  ]\n]\n'
      );
    case 'grid':
      return (
        head +
        uitleg(
          '  #formule_blok(name: [Snelheid])[$v = s / t$]\n  #belangrijk_blok[Let op de eenheden: #quan("3.5 m/s").]',
        ) +
        `#let render_opgaven() = [\n  #opgave(titel: "Opgave met een figuur")[\n    #grid(columns: (3fr, 2fr), gutter: 1em,\n      [\n        Tekst naast de figuur.\n\n        #vraag(punten: 1, antwoord: [Het antwoord.])[De vraag in een grid.]\n      ],\n      rect(width: 100%, height: 3cm, stroke: luma(160))[#align(center + horizon)[Figuur]],\n    )\n  ]\n  #opgave(titel: "Vraag in een figuur")[\n    #figure(kind: "voorbeeld", supplement: "Voorbeeld", caption: [In een figuur])[\n      #vraag(punten: 2, antwoord: [#num[1234.5]])[Schrijf als getal.]\n    ]\n    #vraag(antwoord: none)[Vraag zonder punten en zonder antwoord.]\n  ]\n]\n`
      );
    case 'long-odd':
    case 'long-even': {
      // Page counts differ so batches mix odd and even (duplex blank pages).
      const n = kind === 'long-odd' ? 9 : 4;
      return (
        head +
        uitleg(filler(n)) +
        `#let render_opgaven() = [\n  #opgave(titel: "Lang")[\n${filler(n)}\n    #vraag(punten: 3, antwoord: [Lang antwoord.])[Een vraag na veel tekst.]\n  ]\n]\n`
      );
    }
    default:
      return (
        head +
        uitleg('  Plaats hier de uitleg...') +
        '#let render_opgaven() = [\n  #opgave(titel: "Oefening")[\n    #vraag(punten: 2, antwoord: [Antwoord a.])[Eerste vraag.]\n    #vraag(punten: 1, antwoord: [Antwoord b.])[Tweede vraag.]\n  ]\n]\n'
      );
  }
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect x="1" y="1" width="118" height="58" fill="#eef" stroke="#235"/><path d="M10 50 L60 10 L110 50" fill="none" stroke="#a23" stroke-width="3"/><text x="60" y="55" font-size="10" text-anchor="middle">schema</text></svg>\n';

function makeOpdrachten(p, observaties, root) {
  const kinds = ['images', 'zero-vragen', 'grid', 'long-odd', 'long-even', 'plain'];
  const out = [];
  let n = 0;
  for (const subject of p.subjects) {
    const obs = observaties.filter(
      (o) =>
        o.subjects.includes(subject) ||
        (subject === 'wi' && o.subjects.some((s) => s.startsWith('wis'))),
    );
    const count = subject === p.subjects[0] ? kinds.length : 2;
    for (let i = 0; i < count; i++) {
      const id = `opdracht_${T0 + 200 + n}`;
      const kind = subject === p.subjects[0] ? kinds[i] : 'plain';
      out.push({
        id,
        naam: `Opdracht ${subject} ${i + 1} (${kind})`,
        beschrijving: `Synthetische opdracht, soort ${kind}.`,
        schoolsoort: ['Havo', 'Vwo'],
        vakken: [subject === 'wi' ? 'wisb' : subject],
        jaarlagen: i === 1 ? [] : p.jaarlagen.slice(0, 3),
        observaties: obs.slice(0, 1 + (i % 2)).map((o) => o.id),
        typFile: `${id}.typ`,
        _meta: meta(T0, 'gebr-1756713600001'),
      });
      writeText(root, `opdrachten/${id}.typ`, opdrachtTyp(kind, id));
      if (kind === 'images') {
        copyAsset(root, 'figuur.png', `opdrachten/images/${id}/figuur.png`);
        copyAsset(root, 'foto.jpg', `opdrachten/images/${id}/foto.jpg`);
        writeText(root, `opdrachten/images/${id}/schema.svg`, SVG);
      }
      n++;
    }
  }
  return out;
}

const RTTI = ['R', 'T1', 'T2', 'I'];

function makeQuestions(r, count, { bonus = false, diag = false } = {}) {
  const qs = [];
  for (let i = 0; i < count; i++) {
    qs.push({
      id: `q${i + 1}`,
      section: ['I', 'II', 'III'][Math.floor((i * 3) / count)],
      number: i + 1,
      max_points: r.int(1, 5),
      rtti: RTTI[i % 4],
    });
  }
  if (bonus)
    qs.push({
      id: `q${count + 1}`,
      section: 'III',
      number: count + 1,
      max_points: 2,
      rtti: 'T2',
      kind: 'bonus',
    });
  if (diag)
    qs.push({
      id: `q${count + 2}`,
      section: 'III',
      number: count + 2,
      max_points: 1,
      rtti: 'I',
      kind: 'diag',
    });
  return qs;
}

function scoreFor(r, q) {
  const x = r.next();
  if (x < 0.04) return null; // N
  if (x < 0.05) return r.pick(['abc', String(q.max_points + 2), '1,5,0']); // invalid input kept as typed
  if (x < 0.08) return undefined; // not entered
  return Math.round(r.next() * q.max_points * 2) / 2;
}

function makeExams(p, r, observaties, opdrachten, year) {
  const exams = [];
  for (const subject of p.subjects) {
    for (const jl of p.jaarlagen) {
      for (let e = 0; e < p.examsPerVak; e++) {
        const title = e === 0 ? `Toets H${e + 1} Krachten & Énergie` : `Toets H${e + 1}`;
        const id = examId(subject, title, year);
        const obs = observaties.filter(
          (o) =>
            o.subjects.includes(subject) ||
            (subject === 'wi' && o.subjects.some((s) => s.startsWith('wis'))),
        );
        const exam = {
          id,
          title,
          jaarlaag: jl,
          schoolsoort: ['Havo', 'Vwo'],
          n_term: [1, 0, 2.5, 1.3][e % 4],
          weging: [1, 2, 0.5, 0][e % 4],
          ...(e === 1 ? {} : { weging_se: [1, 2, 0.5, 3][e % 4] }),
          periode: String(1 + (e % 3)),
          type: e === 1 ? 'pta' : 'regular',
          structureMode: 'roman',
          questions: makeQuestions(r, 6 + (e % 3) * 4, { bonus: e % 2 === 0, diag: e === 2 }),
          obs_ids: obs.slice(0, 3).map((o) => o.id),
          subject,
          volgnummer: Number(jl) * 100 + e + 1,
          _meta: meta(T0 + e * 86_400_000, 'gebr-1756713600001', 1 + e),
        };
        const ops = opdrachten.filter(
          (o) => o.vakken.includes(subject) || (subject === 'wi' && o.vakken.includes('wisb')),
        );
        if (e === 0 && ops.length) {
          // Saved coupling: one observatie explicitly empty, one with a deleted opdracht id.
          exam.opdrachten = {
            [obs[0].id]: ops.slice(0, 2).map((o) => o.id),
            [obs[1].id]: [],
            [obs[2].id]: [ops[0].id, 'opdracht_0000000000000'],
          };
          exam.opdrachtenCijfer = [
            { id: `cijfer-${T0 + 300}`, onder: 5.5, opdrachten: [ops[0].id] },
          ];
        }
        exams.push(exam);
      }
      // Empty exam: no scores at all. One-student exam: a single student has scores.
      const subjectJl = `${subject}-${jl}`;
      if (subjectJl === `${p.subjects[0]}-${p.jaarlagen[0]}`) {
        exams.push({
          id: examId(subject, 'Lege toets', year),
          title: 'Lege toets',
          jaarlaag: jl,
          schoolsoort: ['Havo'],
          n_term: 1,
          weging: 1,
          weging_se: 1,
          periode: '2',
          type: 'regular',
          structureMode: 'roman',
          questions: makeQuestions(r, 3),
          obs_ids: [],
          subject,
          volgnummer: Number(jl) * 100 + 50,
          _meta: meta(T0, 'admin'),
        });
        exams.push({
          id: examId(subject, 'Toets één leerling', year),
          title: 'Toets één leerling',
          jaarlaag: jl,
          schoolsoort: ['Havo'],
          n_term: 1,
          weging: 1,
          weging_se: 1,
          periode: '2',
          type: 'regular',
          structureMode: 'alpha',
          questions: makeQuestions(r, 4, { bonus: true }),
          obs_ids: [],
          subject,
          volgnummer: Number(jl) * 100 + 51,
          _meta: meta(T0, 'admin'),
        });
      }
    }
  }
  // Resit chain on the first exam: herkansing (attempt 2) and inhaal (attempt 3).
  const parent = exams[0];
  for (const [attempt, label] of [
    [2, 'HERKANSING'],
    [3, 'INHAAL'],
  ]) {
    const title = `${parent.title} — ${label}`;
    exams.push({
      ...structuredClone(parent),
      id: examId(parent.subject, title, year),
      title,
      description: label,
      attempt,
      parent_id: parent.id,
      questions: attempt === 3 ? makeQuestions(r, 5) : structuredClone(parent.questions),
      n_term: attempt === 3 ? 2 : parent.n_term,
      opdrachten: undefined,
      _meta: meta(T0 + 30 * 86_400_000, 'gebr-1756713600001'),
    });
  }
  return exams.map((e) => JSON.parse(JSON.stringify(e)));
}

function makeScores(p, r, students, groups, exams, observaties) {
  const records = new Map(); // `${subject}/${id}` -> record
  const rec = (subject, sid) => {
    const key = `${subject}/${sid}`;
    if (!records.has(key)) records.set(key, { student_id: sid, scores: {}, observations: {} });
    return records.get(key);
  };
  for (const exam of exams) {
    if (exam.title === 'Lege toets') continue;
    let takers = students.filter(
      (s) =>
        s.jaarlaag === exam.jaarlaag &&
        groups.some((g) => g.subject === exam.subject && g.student_ids.includes(s.id)),
    );
    if (exam.title === 'Toets één leerling') takers = takers.slice(0, 1);
    if (exam.parent_id) takers = takers.filter((_, i) => i % (exam.attempt === 2 ? 4 : 7) === 0);
    takers.forEach((s, idx) => {
      if (!exam.parent_id && r.chance(0.05)) return; // absent
      const qs = {};
      for (const q of exam.questions) {
        const v = scoreFor(r, q);
        if (v !== undefined) qs[q.id] = v;
      }
      const record = rec(exam.subject, s.id);
      record.scores[exam.id] = qs;
      if (exam.obs_ids.length && r.chance(0.4)) {
        record.observations[exam.id] = exam.obs_ids.filter(() => r.chance(0.5));
      }
      if (idx % 11 === 3) {
        record.overrides ??= {};
        record.overrides[exam.id] = {
          cijfer: Math.round((4 + r.next() * 5) * 10) / 10,
          berekend: Math.round((3 + r.next() * 6) * 10) / 10,
        };
      }
    });
  }
  return records;
}

export function generate(name, root) {
  const p = PROFILES[name];
  if (!p)
    throw new Error(`unknown fixture '${name}' (expected ${Object.keys(PROFILES).join(', ')})`);
  const r = prng(p.seed);
  fs.mkdirSync(root, { recursive: true });

  writeJson(root, 'config.json', { activeYear: YEAR });
  writeJson(root, 'gebruikers.json', makeUsers());
  writeJson(root, 'school.json', {
    naam: 'Synthetische School',
    ondertitel: 'Testomgeving & co',
    motto: 'Leren #door $doen',
    schoolsoort: ['Havo', 'Vwo'],
    logo: 'fotos/school-logo.png',
    watermerk: 'fotos/school-watermerk.svg',
  });
  copyAsset(root, 'figuur.png', 'fotos/school-logo.png');
  copyAsset(root, 'figuur.png', 'fotos/gebr-1756713600001.png');
  writeText(root, 'fotos/school-watermerk.svg', SVG);

  const observaties = makeObservaties(p);
  for (const o of observaties) writeJson(root, `observaties/${o.id}.json`, o);
  const opdrachten = makeOpdrachten(p, observaties, root);
  for (const o of opdrachten) writeJson(root, `opdrachten/${o.id}.json`, o);

  const years = p.prevYear ? [PREV_YEAR, YEAR] : [YEAR];
  for (const year of years) {
    const students = makeStudents(p, r);
    // The previous year has the same students one jaarlaag lower (history across years).
    if (year === PREV_YEAR)
      for (const s of students) s.jaarlaag = String(Math.max(1, Number(s.jaarlaag) - 1));
    const groups = makeGroups(p, students).map((g) => ({ ...g, id: g.id.replace(YEAR, year) }));
    const exams = makeExams(p, r, observaties, opdrachten, year);
    writeJson(root, `${year}/students-${year}.json`, students);
    for (const g of groups) writeJson(root, `${year}/groups/${g.id}.json`, g);
    for (const e of exams) writeJson(root, `${year}/exams/${e.id}.json`, e);
    for (const subj of SUBJECTS)
      fs.mkdirSync(path.join(root, year, 'scores', subj), { recursive: true });
    for (const [key, record] of makeScores(p, r, students, groups, exams, observaties)) {
      writeJson(root, `${year}/scores/${key}.json`, record);
    }
  }
  writeJson(
    root,
    `templates/RTTI explanations and advices/rtti_expl_adv_${p.subjects[0]}_3.json`,
    rttiTemplate(),
  );
  return root;
}

function rttiTemplate() {
  const adv = (t) => ({ laag: `Advies ${t} laag.`, midden: `Advies ${t} midden.`, hoog: '' });
  const grens = { laag_midden: 40, midden_hoog: 70 };
  return {
    uitleg: Object.fromEntries(RTTI.map((t) => [t, `Uitleg ${t}.`])),
    leeradvies: Object.fromEntries(RTTI.map((t) => [t, adv(t)])),
    grenswaarden: Object.fromEntries(RTTI.map((t) => [t, grens])),
  };
}

/** sha256 per file (posix relative paths, sorted) and one hash over the list. */
export function treeHash(root) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else
        files.push([
          path.relative(root, abs).split(path.sep).join('/'),
          crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'),
        ]);
    }
  };
  walk(root);
  const hash = crypto
    .createHash('sha256')
    .update(files.map(([f, h]) => `${h}  ${f}\n`).join(''))
    .digest('hex');
  return { files: files.length, hash };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, out] = process.argv.slice(2);
  if (!name || !out) {
    console.error('usage: node tools/fixtures/generate.mjs <tiny|school> <outDir>');
    process.exit(2);
  }
  if (fs.existsSync(out) && fs.readdirSync(out).length) {
    console.error(`refusing to write into non-empty ${out}`);
    process.exit(1);
  }
  generate(name, out);
  console.log(JSON.stringify({ [name]: treeHash(out) }));
}
