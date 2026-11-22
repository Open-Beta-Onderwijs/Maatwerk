// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../store.js', () => ({ Store: {} }));

import type { Results } from '../../domain/grades';
import { setRubricLookup } from '../../domain/po';
import type { Rubric } from '../../domain/rubric';
import { barsHtml, barTip, dumbRowHtml, inBouw } from './cijferverloop';
import type { Exam, ScoreRecord } from '../../domain/types';
import { obsCounts, type ProfileTest } from './data';

const test = (fields: Partial<ProfileTest['exam']>, grade: number, extra = {}): ProfileTest => ({
  exam: {
    id: 'x',
    questions: [],
    volgnummer: 301,
    title: 'Toets',
    jaarlaag: '3',
    academic_year: '2025-2026',
    ...fields,
  },
  questionScores: {},
  res: { grade, rubricGrade: 8.8 } as Results,
  ...extra,
});

describe('profile Cijferverloop (spec 4.15.1)', () => {
  it('splits onderbouw (1-3) and bovenbouw (4-6)', () => {
    expect(inBouw(test({ jaarlaag: '3' }, 6), 'onderbouw')).toBe(true);
    expect(inBouw(test({ jaarlaag: '4' }, 6), 'onderbouw')).toBe(false);
    expect(inBouw(test({ jaarlaag: '5' }, 6), 'bovenbouw')).toBe(true);
  });

  it('groups the bars per school year with a divider after the first', () => {
    const html = barsHtml(
      [
        test({ academic_year: '2024-2025' }, 6),
        test({ academic_year: '2025-2026' }, 7),
        test({ academic_year: '2025-2026', diagnostic: true }, 5),
      ],
      (yr) => yr,
    );
    expect(html.match(/pf-bars__year"/g)).toHaveLength(1);
    expect(html).toContain('pf-bars__year pf-bars__year--sep" data-left="33.33%"');
    expect(html.match(/class="pf-bar /g)).toHaveLength(3);
    expect(html).toContain('ov-kind--diagnostic');
  });

  it('shows a PO bar with its projectgroep, lines and category scores', () => {
    const rubric = {
      id: 'r',
      categories: [
        { id: 'th', naam: 'Theorie', max: 8, soort: 'normaal' },
        { id: 'pl', naam: 'Planning', max: 3, soort: 'diagnostisch' },
      ],
    } as Rubric;
    setRubricLookup(() => rubric);
    const t = test(
      {
        kind: 'po',
        rubric_id: 'r',
        volgnummer: 309,
        title: 'PO',
        projectgroepen: [{ id: 'g', naam: 'Valtoren', student_ids: [] }],
      },
      8.6,
      {
        questionScores: { th: 6 },
        po: {
          projectgroep: 'g',
          groupLines: [{ label: 'Te laat', value: -0.5 }],
          ownLines: [{ label: 'Extra', value: 0.3 }],
        },
      },
    );
    const tip = barTip(t);
    expect(tip.head).toBe('309 PO');
    expect(tip.sub).toBe('Cijfer 8,6 · projectgroep Valtoren 8,8 · groep −0,5 · persoonlijk +0,3');
    expect(tip.rows).toEqual([
      ['Theorie', '6 / 8'],
      ['Planning (diagnostisch)', '— / 3'],
    ]);
    expect(barTip(test({ diagnostic: true }, 5)).sub).toBe(
      'Cijfer 5,0 · diagnostisch, telt niet mee',
    );
  });

  it('draws a track: the SD band, the average and the difference', () => {
    const html = dumbRowHtml('x', 7.7, { mean: 7.3, sd: 0.9 } as never, 'Toetsgemiddelde', 'Sem');
    expect(html).toContain('vs 7,3</span>');
    expect(html).toContain('title="Toetsgemiddelde 7,3 ± 0,9"');
    expect(html).toContain('+0,4');
    expect(html).toContain('pf-dumb__diff pf-dumb__diff--up');
    expect(dumbRowHtml('x', null, null, 'T', 'Sem')).toContain('Geen cijfer');
  });
});

describe('obsCounts (step 37, backlog 29c)', () => {
  const rubric = {
    id: 'r',
    obs_ids: ['o-netjes'],
    categories: [{ id: 'th', obs_ids: ['o-bronnen'] }],
  } as unknown as Rubric;
  const toets = { id: 't', questions: [], obs_ids: ['o-toets'] } as unknown as Exam;
  const po = { id: 'p', kind: 'po', rubric_id: 'r', questions: [], obs_ids: [] } as unknown as Exam;
  const rec = {
    observations: { t: ['o-toets', 'o-los'], p: ['o-netjes'] },
    po: { p: { categoryObs: { th: ['o-bronnen', 'o-netjes'] } } },
  } as unknown as ScoreRecord;

  it("counts a PO's rubric and category observaties, each once per PO", () => {
    expect(obsCounts([toets, po], rec, (e) => (e.id === 'p' ? rubric : null))).toEqual({
      'o-toets': 1,
      'o-netjes': 1,
      'o-bronnen': 1,
    });
  });

  it('a test still counts only what it links', () => {
    expect(obsCounts([toets], rec, () => null)).toEqual({ 'o-toets': 1 });
  });
});
