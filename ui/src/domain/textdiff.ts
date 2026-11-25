// SPDX-License-Identifier: AGPL-3.0-or-later

// Line diff for "Bekijk verschillen" (ADR-0002 5a): the teacher's copy of
// lib.typ/main.typ against the bundled version. Lines the two share at the start
// and the end are taken off first, so a copy with a few changes needs a small LCS
// table only; a middle part larger than MAX_CELLS is shown as removed, then added
// (review 8b n8: the table was quadratic in memory for any copy). Line endings and
// a leading BOM do not count as differences.

export type DiffLine =
  | { kind: 'same'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'added'; text: string };

/** The largest LCS table (rows x columns) built; about 16 MB of numbers. */
export const MAX_CELLS = 2_000_000;

function lines(text: string): string[] {
  const body = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const out = body.split('\n');
  if (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

/** The lines of `before` turned into `after`: removed, added and unchanged, in order. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const same = (text: string): DiffLine => ({ kind: 'same', text });
  return [
    ...a.slice(0, start).map(same),
    ...middle(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(same),
  ];
}

function middle(a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    for (const text of a) out.push({ kind: 'removed', text });
    for (const text of b) out.push({ kind: 'added', text });
    return out;
  }
  // lcs[i][j]: length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'removed', text: a[i++]! });
    } else {
      out.push({ kind: 'added', text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++]! });
  while (j < b.length) out.push({ kind: 'added', text: b[j++]! });
  return out;
}
