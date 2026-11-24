// SPDX-License-Identifier: AGPL-3.0-or-later

// The PO rapport (step 24; design spec 4.13 "PO rapport"): Rapport genereren on a PO renders
// every graded student of the PO in one PDF and names the students without a rapport.

import { expect, test } from '@playwright/test';
import { examMenuItem, login, seedFiles, watchErrors, withMock, YEAR } from './helpers';
import { PO_ID, poSeed } from './po-seed';

interface PoStudent {
  name: string;
  klas: string;
  grade: string;
  group_size: number;
  lines: { voor: string; text: string }[];
}

test('Rapport genereren on a PO renders the graded students and names the others', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await seedFiles(page, await poSeed(page, { grading: true }));
  await login(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await examMenuItem(page, PO_ID, 'Rapport genereren');
  await expect(page.locator('.rapport-pdf-frame')).toBeVisible();
  const skipped = page.locator('.rapport-skipped');
  await expect(skipped.first()).toContainText('Geen rapport voor');
  await expect(skipped.first()).toContainText('Daan Visser');
  await expect(skipped.first()).toContainText(': niet ingedeeld in een projectgroep.');
  // Projectgroep 2 has only Theorie (Bezig): a warning (review 24 m3).
  await expect(skipped.last()).toHaveText(
    'Let op: Projectgroep 2 is nog niet helemaal beoordeeld. Een categorie zonder score staat in het rapport als —.',
  );

  const calls = await withMock(page, (m) =>
    m.calls.filter((c) => c[0] === 'renderPoRapportPdf').map((c) => c.slice(1)),
  );
  expect(calls).toHaveLength(1);
  const [examId, students, poInfo] = calls[0] as [string, PoStudent[], Record<string, unknown>];
  expect(examId).toBe(PO_ID);
  expect(poInfo).toMatchObject({
    name: 'PO Onderzoek valbeweging',
    subject_display: 'Natuurkunde',
  });
  // Valtoren (8,8 − 0,5; Noor Bakker +0,3) and Projectgroep 2 (Theorie 4 of 17: 2,4).
  expect(students).toHaveLength(4);
  const noor = students.find((s) => s.name === 'Noor Bakker')!;
  expect(noor).toMatchObject({ grade: '8,6', group_size: 2 });
  expect(noor.lines.map((l) => `${l.voor} ${l.text}`)).toEqual([
    'Projectgroep −0,5',
    'Persoonlijk +0,3',
  ]);
  expect(students.filter((s) => s.grade === '2,4')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('a PO without grades shows why there is no rapport', async ({ page }) => {
  const errors = watchErrors(page);
  await seedFiles(page, await poSeed(page, { po: true }));
  await login(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await examMenuItem(page, PO_ID, 'Rapport genereren');
  await expect(page.locator('.rapport-modal-content .hint')).toHaveText(
    'Nog geen leerling van deze PO heeft een cijfer. Beoordeel eerst de projectgroepen via Scores invoeren.',
  );
  await expect(page.locator('.rapport-pdf-frame')).toHaveCount(0);
  const calls = await withMock(page, (m) => m.calls.filter((c) => c[0] === 'renderPoRapportPdf'));
  expect(calls).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('a PO without a rubric has no rapport, and says why (review 24 m8)', async ({ page }) => {
  const files = await poSeed(page, { grading: true });
  const examRel = `${YEAR}/exams/${PO_ID}.json`;
  files[examRel] = { ...(files[examRel] as object), rubric_id: null };
  await seedFiles(page, files);
  await login(page);
  await page.locator('.nav-btn[data-screen="toetsen"]').click();
  await examMenuItem(page, PO_ID, 'Rapport genereren');
  await expect(page.locator('.dlg .hint')).toHaveText(
    'Deze PO heeft geen rubric, dus geen cijfers. Kies een rubric via PO bewerken.',
  );
  const calls = await withMock(page, (m) => m.calls.filter((c) => c[0] === 'renderPoRapportPdf'));
  expect(calls).toHaveLength(0);
});
