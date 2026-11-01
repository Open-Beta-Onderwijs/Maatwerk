// SPDX-License-Identifier: AGPL-3.0-or-later

// Line diff for "Bekijk verschillen" (ADR-0002 5a): the teacher's copy of
// lib.typ/main.typ against the bundled version. A plain LCS over lines; the
// files are a few hundred lines, so the quadratic table is fine. Line endings
// and a leading BOM do not count as differences.

export type DiffLine =
  | { kind: 'same'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'added'; text: string };

function lines(text: string): string[] {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const out = body.split('\n');
  if (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

/** The lines of `before` turned into `after`: removed, added and unchanged, in order. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
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
  const out: DiffLine[] = [];
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

/** True when the two texts differ in more than line endings or a BOM. */
export function textsDiffer(before: string, after: string): boolean {
  return diffLines(before, after).some((l) => l.kind !== 'same');
}
