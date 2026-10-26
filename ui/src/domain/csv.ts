// SPDX-License-Identifier: AGPL-3.0-or-later

// CSV import (business-rules.md section 9). Ported from utils/csv.js
// (parseCSV) and modals/leerling-edit.js (student rows); pinned by
// tests/golden/logic/csv.json.

import type { Student } from './types';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parses CSV text. The delimiter is `;` unless the header line has more `,`.
 * Fields are trimmed; blank lines are skipped; one line is one row (a newline
 * inside quotes is not supported). Fewer than two lines give no headers.
 */
export function parseCSV(text: string): ParsedCsv {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const semiCount = (lines[0]!.match(/;/g) || []).length;
  const commaCount = (lines[0]!.match(/,/g) || []).length;
  const delim = semiCount >= commaCount ? ';' : ',';

  // Quotes toggle "inside a field"; they are never part of the value, except
  // `""` inside quotes, which is a literal quote (quirk B22, fixed in the port).
  function parseLine(line: string): string[] {
    const result: string[] = [];
    let cur = '',
      inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (c === delim && !inQ) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseLine(lines[0]!);
  const rows = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseLine(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i] ?? '';
      });
      return obj;
    });
  return { headers, rows };
}

/**
 * Decodes an uploaded CSV file: UTF-8 (a BOM is dropped) when the bytes are
 * valid UTF-8, else Windows-1252, the "CSV (puntkomma)" export of Excel on
 * Dutch Windows (quirk B22; the reference always decoded UTF-8).
 */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Students from the rows of a student CSV (column names in Title case or lower
 * case). Rows without a number or achternaam are dropped. Ids are numbers, as
 * in the reference (quirk B21; ADR-0003 C8 converts them in Step 7).
 */
export function studentsFromCsvRows(rows: Record<string, string>[]): Student[] {
  return rows
    .map((r) => {
      const ssRaw = (r['Schoolsoort'] ?? r['schoolsoort'] ?? '').trim();
      return {
        id: Number(r['Leerlingnummer'] ?? r['leerlingnummer']),
        voornaam: r['Voornaam'] ?? r['voornaam'] ?? '',
        tussenvoegsel: r['Tussenvoegsel'] ?? r['tussenvoegsel'] ?? '',
        achternaam: r['Achternaam'] ?? r['achternaam'] ?? '',
        geslacht: r['Geslacht'] ?? r['geslacht'] ?? '',
        stamklas: r['Stamklas'] ?? r['stamklas'] ?? '',
        jaarlaag: String(r['Jaarlaag'] ?? r['jaarlaag'] ?? '').trim(),
        schoolsoort: ssRaw
          ? ssRaw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      };
    })
    .filter((s) => s.id && s.achternaam);
}
