// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { BatchJob } from '../../bridge/api';
import { FAILURE_SEPARATOR, parseBatchFailures } from './failures';

const job = (key: string, opdrachtId: string, label: string, mode = 'student'): BatchJob =>
  ({ key, opdrachtId, label, mode }) as BatchJob;

describe('parseBatchFailures (step 32c)', () => {
  const jobs = [
    job('s1', 'o1', 'Remweg'),
    job('s2', 'o1', 'Remweg'),
    job('s2', 'o2', 'Helling'),
    job('s3', 'o3', 'Ohm'),
  ];

  it('reads one failure with its student count', () => {
    expect(
      parseBatchFailures('Fout in opdracht "Remweg":\n\nerror: x\n  ┌─ opdracht.typ:3:1', jobs),
    ).toEqual([
      { opdrachtId: 'o1', label: 'Remweg', students: 2, error: 'error: x\n  ┌─ opdracht.typ:3:1' },
    ]);
  });

  it('reads several failures under the count line', () => {
    const text = [
      '2 opdrachten bevatten een fout.',
      'Fout in opdracht "Remweg":\n\nerror: a',
      'Fout in opdracht "Ohm":\n\nerror: b',
    ].join(FAILURE_SEPARATOR);
    expect(parseBatchFailures(text, jobs)?.map((f) => [f.opdrachtId, f.students, f.error])).toEqual(
      [
        ['o1', 2, 'error: a'],
        ['o3', 1, 'error: b'],
      ],
    );
  });

  it('gives null for any other error', () => {
    expect(parseBatchFailures('Er is niets om te genereren.', jobs)).toBeNull();
    expect(parseBatchFailures('Fout in opdracht "Onbekend":\n\nerror', jobs)).toBeNull();
  });

  it('counts no students for the answer key', () => {
    const key = [job('o1', 'o1', 'Remweg', 'answers')];
    expect(parseBatchFailures('Fout in opdracht "Remweg":\n\ne', key)?.[0]?.students).toBe(0);
  });
});
