// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parseCSV, studentsFromCsvRows } from '../domain/csv';
import { CSV_EXAMPLES, csvExampleHtml } from './csv-example';

describe('CSV examples (F-02)', () => {
  it('the student example imports as three students', () => {
    const students = studentsFromCsvRows(parseCSV(CSV_EXAMPLES.students.text).rows);
    expect(students.map((s) => [s.id, s.achternaam, s.schoolsoort])).toEqual([
      ['100001', 'Vries', ['Havo']],
      ['100002', 'Jansen', ['Havo', 'Vwo']],
      ['100003', 'Dijk', ['Vwo']],
    ]);
  });

  it('the group and assignment examples have the columns the imports read', () => {
    expect(parseCSV(CSV_EXAMPLES.groups.text).headers).toEqual([
      'Naam',
      'Schoolsoort',
      'Vak',
      'Leerjaar',
      'Docent',
    ]);
    const rows = parseCSV(CSV_EXAMPLES.assignment.text).rows;
    expect(rows[0]).toEqual({ Naam: '3a nat', Leerlingnummer: '100001' });
  });

  it('shows the columns and the example, escaped', () => {
    const html = csvExampleHtml({ file: 'x.csv', text: 'A;B\n<1>;2' });
    expect(html).toContain('<code>A, B</code>');
    expect(html).toContain('&lt;1&gt;;2');
  });
});
