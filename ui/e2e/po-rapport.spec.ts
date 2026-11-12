// SPDX-License-Identifier: AGPL-3.0-or-later

// The PO rapport (step 24; design spec 4.13 "PO rapport"): Rapport genereren on a PO renders
// every graded student of the PO in one PDF and names the students without a rapport.

import { expect, test } from '@playwright/test';
import { examMenuItem, login, seedFiles, watchErrors, withMock } from './helpers';
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
  await expect(skipped).toContainText('Geen rapport voor niet ingedeeld in een projectgroep:');
  await expect(skipped).toContainText('Daan Visser');

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
