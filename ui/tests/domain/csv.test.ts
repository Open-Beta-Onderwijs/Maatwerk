// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { decodeCsv, parseCSV, studentsFromCsvRows } from '../../src/domain/csv';
import { goldenCase, inputOf, loadGolden, run } from '../golden';

const golden = loadGolden('csv');

// Cases whose golden pins reference behaviour the port fixes on purpose
// (docs/reference/quirks.md, ADR-0002 section 10). Tested separately below.
const FIXED = new Set(['parseCSV-doubled-quotes']);

describe('csv golden', () => {
  for (const c of golden.cases.filter((x) => x.id.startsWith('parseCSV-') && !FIXED.has(x.id))) {
    it(c.id, async () => {
      const { text } = inputOf<{ text: string }>(c);
      expect(await run(() => parseCSV(text))).toEqual(c.output);
    });
  }

  for (const id of ['student-csv', 'student-csv-lowercase-comma']) {
    it(id, async () => {
      const c = goldenCase(golden, id);
      const { text } = inputOf<{ text: string }>(c);
      const rows = parseCSV(text).rows;
      expect(await run(() => ({ rows, students: studentsFromCsvRows(rows) }))).toEqual(c.output);
    });
  }
});

describe('B22: fixed in the port', () => {
  it('a doubled quote inside quotes is a literal quote (was dropped)', () => {
    const c = goldenCase(golden, 'parseCSV-doubled-quotes');
    expect(c.output).toEqual({
      headers: ['naam', 'quote'],
      rows: [{ naam: 'Piet', quote: 'Hij zei hoi' }],
    });
    expect(parseCSV(inputOf<{ text: string }>(c).text)).toEqual({
      headers: ['naam', 'quote'],
      rows: [{ naam: 'Piet', quote: 'Hij zei "hoi"' }],
    });
  });

  it('quotes around a whole field are still removed, and a quoted "" is empty', () => {
    expect(parseCSV('a;b;c\n"x";"";"""y"""').rows).toEqual([{ a: 'x', b: '', c: '"y"' }]);
  });

  it('an ANSI (Windows-1252) file decodes without U+FFFD', () => {
    // "Chloé;Müller" in Windows-1252
    const ansi = Uint8Array.from([
      0x43, 0x68, 0x6c, 0x6f, 0xe9, 0x3b, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72,
    ]);
    expect(decodeCsv(ansi)).toBe('Chloé;Müller');
  });

  it('UTF-8 (with or without BOM) still decodes as UTF-8', () => {
    const utf8 = new TextEncoder().encode('Chloé;Müller');
    expect(decodeCsv(utf8)).toBe('Chloé;Müller');
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]);
    expect(parseCSV(`${decodeCsv(bom)}\n1;2`).headers).toEqual(['Chloé', 'Müller']);
  });
});
