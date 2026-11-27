// SPDX-License-Identifier: AGPL-3.0-or-later

// Which scope values of an observatie stay locked in Observatie bewerken (edit-locks.md decision
// 12): a jaarlaag, schoolsoort or vak that a linked test or rubric uses. The core refuses the same
// change (`maatwerk_core::locks::guard_obs`); only what the edit would take away is locked, so a
// link that already did not fit leaves the chips free (Gegevenscontrole reports it).

import { WI_VARIANTS } from './opdrachten';

/** The scope of a test that links the observatie. */
export interface TestScope {
  jaarlaag?: string | number | null;
  schoolsoort?: readonly string[] | null;
  subject?: string | null;
}

/** The scope of a rubric that links the observatie. */
export interface RubricScope {
  jaarlagen?: readonly (string | number)[] | null;
  schoolsoort?: readonly string[] | null;
  subject?: string | null;
}

export interface ObsLinkScopes {
  tests: readonly TestScope[];
  rubrics: readonly RubricScope[];
}

/** The observatie's scope as the form holds it. */
export interface ObsScope {
  jaarlagen: readonly string[];
  schoolsoort: readonly string[];
  subjects: readonly string[];
}

export interface ObsLocked {
  jaarlagen: string[];
  schoolsoort: string[];
  vakken: string[];
}

const isWi = (v: string): boolean => WI_VARIANTS.has(v);

/**
 * The chips that stay on. `initial` is the saved scope (what counts as taken away), `current`
 * the form's selection: of the wiskunde variants a `wi` test or rubric fits, the last one left
 * stays, whichever it is.
 */
export function obsLockedValues(
  links: ObsLinkScopes,
  initial: ObsScope,
  current: ObsScope = initial,
): ObsLocked {
  const all = [...links.tests, ...links.rubrics];
  const jl = new Set<string>();
  for (const t of links.tests) if (t.jaarlaag != null) jl.add(String(t.jaarlaag));
  for (const r of links.rubrics) for (const j of r.jaarlagen ?? []) jl.add(String(j));
  const ss = new Set(all.flatMap((l) => l.schoolsoort ?? []));
  const subjects = new Set(all.map((l) => l.subject ?? '').filter(Boolean));

  const vakken = initial.subjects.filter((v) => !isWi(v) && subjects.has(v));
  if (subjects.has('wi') && initial.subjects.some(isWi)) {
    const left = current.subjects.filter(isWi);
    if (left.length === 1) vakken.push(left[0]!);
  }
  return {
    jaarlagen: initial.jaarlagen.filter((j) => jl.has(j)),
    // An empty list allows every schoolsoort: nothing selected, nothing to lock.
    schoolsoort: initial.schoolsoort.filter((s) => ss.has(s)),
    vakken,
  };
}

/** The tooltip of a locked chip. */
export const OBS_LOCK_TITLE = 'Een gekoppelde toets of rubric gebruikt dit; het blijft erin.';
