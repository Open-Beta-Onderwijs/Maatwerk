// SPDX-License-Identifier: AGPL-3.0-or-later

// The mock backend guards rubric writes like the core (`maatwerk_core::rubrics`, step 21).

import { describe, expect, it } from 'vitest';
import seed from 'virtual:maatwerk-fixtures';
import { MockApi } from './mock-api';
import { duplicateRubric, newRubric, type Rubric } from '../../domain/rubric';

async function fixtureRubric(api: MockApi, id = 'rubric-onderzoek'): Promise<Rubric> {
  return (await api.readJson(`rubrics/${id}.json`)) as unknown as Rubric;
}

async function minAppVersion(api: MockApi): Promise<unknown> {
  return ((await api.readJson('school.json')) as { minAppVersion?: unknown } | null)?.minAppVersion;
}

describe('MockApi rubric guard', () => {
  it('refuses an invalid rubric and a wrong id, and raises minAppVersion on a valid one', async () => {
    const api = new MockApi(seed);
    await api.writeJson('school.json', { naam: 'S', minAppVersion: '0.9.0' });
    const r = newRubric('nat');
    let res = await api.writeJson(`rubrics/${r.id}.json`, r as never);
    expect(res).toMatchObject({ ok: false });
    expect((res as { reason: string }).reason).toMatch(/^Rubric niet opgeslagen: Geef de rubric/);
    const good = duplicateRubric(await fixtureRubric(api));
    res = await api.writeJson(`rubrics/other.json`, good as never);
    expect((res as { reason: string }).reason).toBe(
      `Rubric niet opgeslagen: het id hoort other te zijn`,
    );
    expect(await minAppVersion(api)).toBe('0.9.0');
    res = await api.writeJson(`rubrics/${good.id}.json`, good as never);
    expect(res.ok).toBe(true);
    expect(await minAppVersion(api)).toBe('0.12.0');
  });

  it('a rubric in use keeps max and soort and cannot be deleted', async () => {
    const api = new MockApi(seed);
    const r = await fixtureRubric(api);
    await api.writeJson('2025-2026/exams/po-1.json', {
      id: 'po-1',
      naam: 'PO verslag',
      kind: 'po',
      rubric_id: r.id,
    });
    expect(await api.rubricUsage()).toEqual({
      [r.id]: [{ year: '2025-2026', examId: 'po-1', naam: 'PO verslag' }],
    });
    const changed = structuredClone(r);
    const samen = changed.categories.find((c) => c.id === 'cat-samen');
    if (!samen) throw new Error('fixture lacks cat-samen');
    samen.soort = 'normaal';
    const res = await api.writeJson(`rubrics/${r.id}.json`, changed as never);
    expect((res as { reason: string }).reason).toBe(
      'Rubric niet opgeslagen: in gebruik bij 1 PO, dus maxima en soort liggen vast. ' +
        'De soort van "Samenwerken" is gewijzigd (Diagnostisch → Normaal)',
    );
    expect(await api.deleteFile(`rubrics/${r.id}.json`)).toEqual({
      ok: false,
      reason: 'Deze rubric is in gebruik bij 1 PO en kan niet verwijderd worden',
    });
    expect(await api.deleteFile('rubrics/rubric-practicum.json')).toEqual({ ok: true });
  });
});
