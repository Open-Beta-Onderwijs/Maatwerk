// SPDX-License-Identifier: AGPL-3.0-or-later
// The fixture converter's v3 step mirrors maatwerk-core::migrate::v3 (step 18).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filesToV3 } from './to-current.mjs';

const json = (v) => JSON.stringify(v);

test('v3: images, presence, school, users, exams and resits', () => {
  const out = filesToV3(
    new Map(
      Object.entries({
        'config.json': json({ schema_version: 2, activeYear: '2025-2026' }),
        'fotos/logo.png': 'png',
        'users/u1.json': json({ userId: 'u1' }),
        'school.json': json({ naam: 'S', logo: 'fotos/logo.png', minAppVersion: '0.6.0' }),
        'gebruikers/u1.json': json({ id: 'u1', foto: 'fotos/u1.png' }),
        'gebruikers/u2.json': json({ id: 'u2' }),
        '2025-2026/exams/p.json': json({ id: 'p', obs_ids: ['o1'] }),
        '2025-2026/exams/r.json': json({ id: 'r', parent_id: 'p', obs_ids: ['o2'], kind: 'po' }),
      }),
    ),
  );
  const read = (rel) => JSON.parse(out.get(rel));
  assert.deepEqual([...out.keys()].sort(), [
    '2025-2026/exams/p.json',
    '2025-2026/exams/r.json',
    'afbeeldingen/logo.png',
    'config.json',
    'gebruikers/u1.json',
    'gebruikers/u2.json',
    'school.json',
  ]);
  assert.equal(read('config.json').schema_version, 3);
  assert.deepEqual(read('school.json'), {
    naam: 'S',
    logo: 'afbeeldingen/logo.png',
    minAppVersion: '0.9.0',
  });
  assert.equal(read('gebruikers/u1.json').foto, 'afbeeldingen/u1.png');
  assert.equal('foto' in read('gebruikers/u2.json'), false);
  assert.deepEqual(read('2025-2026/exams/p.json'), {
    id: 'p',
    obs_ids: ['o1'],
    kind: 'toets',
    diagnostic: false,
  });
  assert.deepEqual(read('2025-2026/exams/r.json'), {
    id: 'r',
    parent_id: 'p',
    obs_ids: ['o1', 'o2'],
    kind: 'po',
    diagnostic: false,
    obs_from_parent: true,
  });
});
