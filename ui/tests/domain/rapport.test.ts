// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeAll, describe, expect, it } from 'vitest';
import { MockApi } from '../../src/bridge/mock/mock-api';
import {
  defaultTabData,
  fmtNum,
  getScoreBracket,
  rttiExplFileCandidates,
  normaliseForTypst,
  sanitizeTypstMarkup,
  scoreDotColor,
  subjectDisplayName,
} from '../../src/domain/rapport';
import type { Exam } from '../../src/domain/types';
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
  it('getScoreBracket', () =>
    expectCase(
      'getScoreBracket',
      ({ brackets, grenzen }: { brackets: [number, number][]; grenzen: never }) =>
        brackets.map(([a, b]) => getScoreBracket(a, b, grenzen)),
    ));

  it('fmtNum', () => expectCase('fmtNum', ({ nums }: { nums: number[] }) => nums.map(fmtNum)));

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

describe('B9: bovenbouw wiskunde reads the advice file the editor writes', () => {
  const file = (key: string) => `templates/RTTI explanations and advices/rtti_expl_adv_${key}.json`;
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
      return { success: true, pdfPath: 'captured' };
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
      expect(await run(() => ({ result, renderRapportPdf: calls[0] ?? null }))).toEqual(
        withPortFixes(c.output),
      );
    });
  }

  it('compileRapport-no-jaarlaag-wi', async () => {
    const c = goldenCase(golden, 'compileRapport-no-jaarlaag-wi');
    session.Store.setActiveSubject!('wi');
    await session.Store.initSubject!('wi');
    calls.length = 0;
    await compileRapport(await examById(inputOf<{ exam: string }>(c).exam, 'wi'), YEAR, deps());
    expect(await run(() => calls[0] ?? null)).toEqual(c.output);
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
      students: [{ id: 7, voornaam: 'A', achternaam: 'B', stamklas: '3a' }],
      groups: [{ id: 'g', name: '3a nat', student_ids: ['7'] }],
      recordOf: () => ({ scores: { e: { q1: 1 } } }),
      observaties: [],
      adviesData: defaultTabData(),
    });
    expect(studentData[0]!.group).toBe('3a nat'); // the reference showed '—'
  });
});
