// SPDX-License-Identifier: AGPL-3.0-or-later

// The Observaties tab's filters (unchanged from the JS screen): toetstype, schoolsoort, jaarlaag
// (wiskunde: klas 1-6 and the subcategory chips), and "eigen groepen". An observatie without
// schoolsoort or jaarlagen passes that filter.

import { obsToetstypes, type Toetstype } from '../../domain/rubric';
import type { ObsFields } from './card';

export interface ObsFilters {
  toetstype: 'alle' | Toetstype;
  subject: string;
  schoolsoort: ReadonlySet<string>;
  /** Jaarlagen 1-6, or for wiskunde the chips OB, WisA..WisD. */
  jaarlagen: ReadonlySet<string>;
  /** Wiskunde only: klas 1-6. */
  jaarlagenKlas: ReadonlySet<string>;
  /** "Observaties eigen groepen": the teacher's groups, or null for all. */
  ownGroups: readonly { subject?: string; schoolsoort?: string[]; jaarlaag?: unknown }[] | null;
}

const some = (list: readonly unknown[] | undefined, ok: (s: string) => boolean): boolean =>
  !(list ?? []).length || (list ?? []).some((v) => ok(String(v)));

/** The jaarlagen the wiskunde subcategory chips stand for: OB is 1-3, any WisX is 4-6. */
function wiskundeJaarlagen(chips: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  if (chips.has('OB')) ['1', '2', '3'].forEach((j) => out.add(j));
  if (['WisA', 'WisB', 'WisC', 'WisD'].some((c) => chips.has(c)))
    ['4', '5', '6'].forEach((j) => out.add(j));
  return out;
}

export function filterObservaties<T extends ObsFields>(list: readonly T[], f: ObsFilters): T[] {
  let obs = list.filter(
    (o) =>
      (f.toetstype === 'alle' || obsToetstypes(o).includes(f.toetstype)) &&
      some(o.schoolsoort, (ss) => f.schoolsoort.has(ss)),
  );
  if (f.subject === 'wi') {
    const allowed = wiskundeJaarlagen(f.jaarlagen);
    obs = obs.filter(
      (o) =>
        some(o.jaarlagen, (jl) => f.jaarlagenKlas.has(jl)) &&
        some(o.jaarlagen, (jl) => allowed.has(jl)),
    );
  } else {
    obs = obs.filter((o) => some(o.jaarlagen, (jl) => f.jaarlagen.has(jl)));
  }
  const own = f.ownGroups;
  if (own) {
    obs = obs.filter((o) =>
      own.some(
        (g) =>
          (o.subjects ?? []).includes(g.subject ?? '') &&
          (o.schoolsoort ?? []).some((ss) => (g.schoolsoort ?? []).includes(ss)) &&
          (o.jaarlagen ?? []).map(String).includes(String(g.jaarlaag)),
      ),
    );
  }
  return obs.sort((a, b) =>
    (a.naam ?? '').localeCompare(b.naam ?? '', 'nl', { sensitivity: 'base' }),
  );
}
