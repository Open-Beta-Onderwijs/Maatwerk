// SPDX-License-Identifier: AGPL-3.0-or-later

// The list screens' numbers (step 38): one `vakNumbers` call per school year and vak, kept while
// the data generation (`Store.generation`: own writes, a changed setting, a colleague's change)
// stays the same. Leerlingen, Groepen and Toetsen share one result.

import type { MaatwerkApi } from '../bridge/api';
import type { VakNumbers } from '../domain/numbers';

const cache = { generation: -1, results: new Map<string, Promise<VakNumbers>>() };

/**
 * The numbers of `year` and `vak` at data generation `generation`. A failed call is not kept,
 * so the next screen visit asks again.
 */
export function vakNumbers(
  year: string,
  vak: string,
  generation: number,
  api: Pick<MaatwerkApi, 'vakNumbers'> = window.maatwerk,
): Promise<VakNumbers> {
  if (cache.generation !== generation) {
    cache.generation = generation;
    cache.results = new Map();
  }
  const key = `${year}|${vak}`;
  let hit = cache.results.get(key);
  if (!hit) {
    const results = cache.results;
    hit = api.vakNumbers(year, vak);
    hit.catch(() => {
      if (results.get(key) === hit) results.delete(key);
    });
    results.set(key, hit);
  }
  return hit;
}
