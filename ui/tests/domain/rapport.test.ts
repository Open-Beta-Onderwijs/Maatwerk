// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeAll, describe, expect, it } from 'vitest';
import { MockApi } from '../../src/bridge/mock/mock-api';
import {
  buildLeeradviesRows,
  defaultTabData,
  fmtNum,
  getScoreBracket,
  rttiExplFileCandidates,
  normaliseForTypst,
  sanitizeTypstMarkup,
  scoreDotColor,
  subjectDisplayName,
} from '../../src/domain/rapport';
import type { Exam, ScoreRecord } from '../../src/domain/types';
import { compileRapport, loadAdviesData, type RapportStore } from '../../src/services/rapport';
import { goldenCase, inputOf, loadGolden, run } from '../golden';
import { openStore, type StoreSession } from '../store-session';

const golden = loadGolden('rapport');
const YEAR = '2025-2026';

/**
 * The golden output with the port's documented fixes applied:
 * T27: the guard's warning escapes its own `$`;
 * T26: a non-numeric score is not entered (score null, grey dot), so its
 * category counts 0 points; in the golden that row read "NaN / 5 (NaN%)" and,
 * because NaN compares false, got the "hoog" advice.
 */
function comparable(output: unknown): unknown {
  // Numbers the decisions change (4, 5, 15) have their own tests below; the rest stays pinned.
  const drop = new Set([
    'class_avg',
    'class_pct',
    'leeradvies_rows',
    'grade_only',
    'ranking',
    'rtti_points',
    'score_pct',
    'grade_bin',
    'grade_bins',
    'dot_color',
    'score',
  ]);
  return JSON.parse(JSON.stringify(output), (key, value) => (drop.has(key) ? undefined : value));
}

function withPortFixes(output: unknown): unknown {
  const T1_LAAG =
    '#text(fill: red, weight: "bold")[\\$-teken niet gesloten — controleer de tekst: ] T1 laag \\$a\\$ en \\$b.';
  const json = JSON.stringify(output).replaceAll('[$-teken', '[\\\\$-teken');
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && value.score?.$number === 'NaN')
      return { ...value, score: null, dot_color: '#b0b8c1' };
    if (value && typeof value === 'object' && value.score_str === 'NaN / 5 (NaN%)')
      return { ...value, score_str: '0 / 5 (0%)', advies: T1_LAAG };
    return value;
  });
}

const expectCase = async (id: string, fn: (input: never) => unknown) => {
  const c = goldenCase(golden, id);
  expect(await run(() => fn(inputOf(c) as never))).toEqual(c.output);
};

describe('rapport golden (domain)', () => {
  it('getScoreBracket', async () => {
    const c = goldenCase(golden, 'getScoreBracket');
    const { brackets, grenzen } = inputOf<{ brackets: [number, number][]; grenzen: never }>(c);
    // Decision 15: from the whole percentage the student reads: 3,99/10 shows 40%, 6,99/10 70%.
    const decided = [...(c.output as string[])];
    decided[2] = 'midden';
    decided[3] = 'hoog';
    expect(brackets.map(([a, b]) => getScoreBracket(a, b, grenzen))).toEqual(decided);
  });

  it('fmtNum', async () => {
    const c = goldenCase(golden, 'fmtNum');
    const { nums } = inputOf<{ nums: number[] }>(c);
    // Decision 3: an exact half rounds up; the reference showed 2,05 as 2,0.
    const decided = (c.output as string[]).map((s, i) => (nums[i] === 2.05 ? '2,1' : s));
    expect(await run(() => nums.map(fmtNum))).toEqual(decided);
  });

  it('subjectDisplayName', () =>
    expectCase('subjectDisplayName', ({ subjects }: { subjects: (string | undefined)[] }) =>
      subjects.map(subjectDisplayName),
    ));

  it('scoreDotColor', () =>
    expectCase('scoreDotColor', ({ dots }: { dots: [number | null, number][] }) =>
      dots.map(([s, m]) => scoreDotColor(s, m)),
    ));

  it('sanitizeTypstMarkup: balanced input unchanged', async () => {
    const c = goldenCase(golden, 'sanitizeTypstMarkup');
    const { markup } = inputOf<{ markup: string[] }>(c);
    const expected = c.output as string[];
    markup.forEach((m, i) => {
      // Review 5a M2: `\$ ontsnapt $` has one unescaped `$`; the reference counted the escaped
      // one too, left the text alone and the rapport then failed (T27). Now it is guarded.
      if (m === '\\$ ontsnapt $') {
        expect(sanitizeTypstMarkup(m)).toMatch(/\] \\\$ ontsnapt \\\$$/);
        return;
      }
      if (!expected[i]!.startsWith('#text(')) expect(sanitizeTypstMarkup(m)).toBe(expected[i]);
    });
  });
});

describe('review 5a M1: normaliseForTypst gives the toTypst values through JSON', () => {
  it('undefined -> null (key kept), non-finite -> 0, everything else unchanged', () => {
    const input = {
      a: 1.5,
      b: undefined,
      c: NaN,
      d: [undefined, Infinity, { e: -Infinity, f: 'x', g: true }],
      h: null,
      i: {},
    };
    const out = JSON.parse(JSON.stringify(normaliseForTypst(input)));
    expect(out).toEqual({
      a: 1.5,
      b: null,
      c: 0,
      d: [null, 0, { e: 0, f: 'x', g: true }],
      h: null,
      i: {},
    });
  });
});

describe('T27: the $ guard no longer breaks the rapport', () => {
  it('the warning escapes its own $ (golden pins the unescaped one)', () => {
    const c = goldenCase(golden, 'sanitizeTypstMarkup');
    const old = (c.output as string[])[3]!;
    expect(old).toContain('[$-teken');
    expect(sanitizeTypstMarkup('$x')).toBe(old.replace('[$-teken', '[\\$-teken'));
  });

  it('every $ in a guarded text is escaped', () => {
    const out = sanitizeTypstMarkup('a $b$ c $d');
    expect(out.match(/(?<!\\)\$/g)).toBeNull();
  });

  it('review 5a M2: an escaped \\$ is neither counted nor escaped again', () => {
    expect(sanitizeTypstMarkup('Kost \\$5')).toBe('Kost \\$5');
    expect(sanitizeTypstMarkup('Kost \\$5 en $x')).toMatch(/\] Kost \\\$5 en \\\$x$/);
    // `\\` is an escaped backslash, so the `$` after it is unescaped.
    expect(sanitizeTypstMarkup('a\\\\$b')).toMatch(/\] a\\\\\\\$b$/);
  });
});

describe('T26: a non-numeric score does not break the rapport', () => {
  it('scoreDotColor(NaN) is grey, not #NaNNaNNaN', () => {
    expect(scoreDotColor(NaN, 4)).toBe('#b0b8c1');
  });
});

describe('T10: an advice file without grenswaarden does not break the rapport', () => {
  const none = { scored: 0, max: 0 };
  it('uses the default 40/70 limits for a missing category or a file without the field', () => {
    const advies = defaultTabData();
    advies.leeradvies.R!.laag = 'Laag.';
    advies.leeradvies.T1!.hoog = 'Hoog.';
    const totals = { R: { scored: 1, max: 5 }, T1: { scored: 4, max: 5 }, T2: none, I: none };
    for (const grenswaarden of [undefined, {}]) {
      const data = { ...advies, grenswaarden } as unknown as Parameters<
        typeof buildLeeradviesRows
      >[1];
      const rows = buildLeeradviesRows(totals, data, []);
      expect(rows.map((r) => r.advies)).toEqual(['Laag.', 'Hoog.']);
    }
  });
});

describe('B9: bovenbouw wiskunde reads the advice file the editor writes', () => {
  // C11: `templates/rtti/<key>_<jaar>.json` (was `.../rtti_expl_adv_<key>_<jaar>.json`).
  const file = (key: string) => `templates/rtti/${key}.json`;
  const advies = (tag: string) => ({
    ...defaultTabData(),
    uitleg: { R: tag, T1: '', T2: '', I: '' },
  });
  const exam = (extra: Partial<Exam>) => ({ id: 'e', questions: [], ...extra }) as Exam;

  it('wisb 4 reads rtti_expl_adv_wisb_4 (the reference read wi_4)', async () => {
    const api = new MockApi();
    await api.writeJson(file('wisb_4'), advies('wisb'));
    await api.writeJson(file('wi_4'), advies('wi'));
    const data = await loadAdviesData(
      exam({ subject: 'wi', subcategory: 'wisb', jaarlaag: '4' }),
      api,
    );
    expect(data.uitleg.R).toBe('wisb');
  });

  it('falls back to the old wi_<jaar> key, then to the defaults', async () => {
    const api = new MockApi();
    const wisc5 = exam({ subject: 'wi', subcategory: 'wisc', jaarlaag: '5' });
    expect(await loadAdviesData(wisc5, api)).toEqual(defaultTabData());
    await api.writeJson(file('wi_5'), advies('wi'));
    expect((await loadAdviesData(wisc5, api)).uitleg.R).toBe('wi');
  });

  it('other subjects and onderbouw are unchanged', () => {
    expect(rttiExplFileCandidates(exam({ subject: 'nat', jaarlaag: '3' }))).toEqual([
      file('nat_3'),
    ]);
    expect(
      rttiExplFileCandidates(exam({ subject: 'wi', subcategory: 'onderbouw', jaarlaag: '2' })),
    ).toEqual([file('wi_2')]);
  });
});

describe('rapport golden (compileRapport on the Store)', () => {
  let session: StoreSession;
  let calls: unknown[];
  const examById = async (id: string, subject: string) =>
    ((await session.Store.getExams!(YEAR, subject)) as Exam[]).find((e) => e.id === id)!;
  const deps = () => ({ Store: session.Store as unknown as RapportStore, api: session.api });

  beforeAll(async () => {
    const { files } = inputOf<{ files: Record<string, string> }>(goldenCase(golden, 'data'));
    session = await openStore({ files, subject: 'nat' });
    calls = [];
    session.api.renderRapportPdf = async (examId, studentData, examInfo) => {
      calls.push({
        examId,
        studentData: structuredClone(studentData),
        examInfo: structuredClone(examInfo),
      });
      // The reference's result shape, which the golden pins (no `warnings`, F-04 is new).
      return { success: true, pdfPath: 'captured' } as Awaited<
        ReturnType<typeof session.api.renderRapportPdf>
      >;
    };
  });

  for (const id of [
    'compileRapport-exam-jaarlaag-3',
    'compileRapport-exam-jaarlaag-4-default-template',
  ]) {
    it(id, async () => {
      const c = goldenCase(golden, id);
      const { exam } = inputOf<{ exam: string }>(c);
      calls.length = 0;
      const result = await compileRapport(await examById(exam, 'nat'), YEAR, deps());
      const actual = comparable(await run(() => ({ result, renderRapportPdf: calls[0] ?? null })));
      // B10, decisions 4 and 6: these two got no rapport in the reference.
      const added = ['Alleen Ennen', 'Alleen Override'];
      const rendered = (actual as { renderRapportPdf: { studentData: { name: string }[] } })
        .renderRapportPdf;
      if (id === 'compileRapport-exam-jaarlaag-3') {
        expect(rendered.studentData.map((s) => s.name)).toEqual(expect.arrayContaining(added));
      }
      rendered.studentData = rendered.studentData.filter((s) => !added.includes(s.name));
      expect(actual).toEqual(comparable(withPortFixes(c.output)));
    });
  }

  it('compileRapport-no-jaarlaag-wi', async () => {
    const c = goldenCase(golden, 'compileRapport-no-jaarlaag-wi');
    session.Store.setActiveSubject!('wi');
    await session.Store.initSubject!('wi');
    calls.length = 0;
    await compileRapport(await examById(inputOf<{ exam: string }>(c).exam, 'wi'), YEAR, deps());
    expect(comparable(await run(() => calls[0] ?? null))).toEqual(comparable(c.output));
  });
});

describe('the rapport follows the grade decisions', () => {
  const exam = {
    id: 'e',
    n_term: 1,
    jaarlaag: '3',
    questions: [
      { id: 'q1', max_points: 10, rtti: 'R', section: 'I', number: 1 },
      { id: 'q2', max_points: 20, rtti: 'I', section: 'I', number: 2 },
    ],
  } as unknown as Exam;
  const student = (id: string, achternaam: string) => ({
    id,
    voornaam: 'A',
    achternaam,
    stamklas: '3a',
  });

  async function data(records: Record<string, ScoreRecord>, adviesData = defaultTabData()) {
    const { buildRapportData } = await import('../../src/domain/rapport');
    const students = Object.keys(records).map((id) => student(id, `L${id}`));
    return buildRapportData({
      exam,
      students,
      groups: [],
      recordOf: (s) => records[s.id],
      observaties: [],
      adviesData,
    }).studentData;
  }

  it('decision 4: N and invalid are 0 in the class average, empty is left out', async () => {
    const [one] = await data({
      '1': { scores: { e: { q1: 8, q2: 10 } } },
      '2': { scores: { e: { q1: 'N' } } },
      '3': { scores: { e: { q1: 12 } } },
    });
    expect(one!.vragen[0]).toMatchObject({ class_avg: 2.7, class_pct: 27 });
    expect(one!.vragen[1]).toMatchObject({ class_avg: 10, class_pct: 50 });
  });

  it('decisions 4 and 6: only N or only an override also gets a rapport (B10)', async () => {
    const rows = await data({
      '1': { scores: { e: { q1: 'N', q2: 'N' } } },
      '2': { overrides: { e: { cijfer: 7.5, berekend: null } } },
      '3': { scores: { e: {} } },
    });
    expect(rows.map((r) => r.student_nr)).toEqual(['1', '2']);
    expect(rows[0]).toMatchObject({ grade: '1,0', grade_only: false });
    expect(rows[1]).toMatchObject({ grade: '7,5', grade_overridden: true, grade_only: true });
    expect(rows[1]!.vragen).toEqual([]);
  });

  it('decision 15: an I row with its advice when the test has I questions (B11)', async () => {
    const advies = defaultTabData();
    advies.leeradvies.I!.midden = 'I midden.';
    const [one] = await data({ '1': { scores: { e: { q1: 8, q2: 12 } } } }, advies);
    expect(one!.leeradvies_rows.map((r) => r.cat)).toEqual(['R', 'I']);
    expect(one!.leeradvies_rows[1]).toEqual({
      cat: 'I',
      score_str: '12 / 20 (60%)',
      advies: 'I midden.',
    });
  });

  it('decision 24: an empty question is 0 of its max on the rapport', async () => {
    const [one] = await data({ '1': { scores: { e: { q1: 8 } } } });
    expect(one!.leeradvies_rows.map((r) => [r.cat, r.score_str])).toEqual([
      ['R', '8 / 10 (80%)'],
      ['I', '0 / 20 (0%)'],
    ]);
    expect(one!.rtti_points.I).toMatchObject({ scored: 0, max: 20, pct: 0 });
    expect(one!.rtti_points.R).toMatchObject({ share: 33 });
  });

  it('review M2: the percentage comes from the core, exact half-up', async () => {
    const [one] = await data({ '1': { scores: { e: { q1: 10, q2: 13 } } } });
    expect(one).toMatchObject({ score: 23, max_score: 30, score_pct: 77 });
  });

  it('decision 16: the ranking line, from 10 grades on', async () => {
    const records: Record<string, ScoreRecord> = {};
    for (let i = 0; i < 10; i++) {
      records[String(i + 1)] = { overrides: { e: { cijfer: 10 - i * 0.5, berekend: null } } };
    }
    const lines = (await data(records)).map((r) => r.ranking);
    expect(lines.filter((l) => l === 'top10')).toHaveLength(1);
    expect(lines.filter((l) => l === 'top20')).toHaveLength(1);
    delete records['10'];
    expect((await data(records)).every((r) => r.ranking === null)).toBe(true);
  });
});

describe('C8: rapport group lookup compares ids as strings', () => {
  it('a string id in student_ids matches a numeric student id', async () => {
    const { buildRapportData } = await import('../../src/domain/rapport');
    const exam = {
      id: 'e',
      jaarlaag: '3',
      questions: [{ id: 'q1', max_points: 2, rtti: 'R', section: 'I', number: 1 }],
    } as Exam;
    const { studentData } = buildRapportData({
      exam,
      students: [{ id: 7 as unknown as string, voornaam: 'A', achternaam: 'B', stamklas: '3a' }], // v1 number
      groups: [{ id: 'g', name: '3a nat', jaarlaag: '3', student_ids: ['7'] }],
      recordOf: () => ({ scores: { e: { q1: 1 } } }),
      observaties: [],
      adviesData: defaultTabData(),
    });
    expect(studentData[0]!.group).toBe('3a nat'); // the reference showed '—'
  });
});
