// SPDX-License-Identifier: AGPL-3.0-or-later

// The editor header's second line (design spec 4.8, V-07): "Opdracht · <vak> · <schoolsoort>
// <jaarlagen>".

import type { Opdracht } from './types';

export const VAK_LABEL: Record<string, string> = {
  bio: 'Biologie',
  nat: 'Natuurkunde',
  schk: 'Scheikunde',
  wisob: 'Wiskunde OB',
  wisa: 'Wiskunde A',
  wisb: 'Wiskunde B',
  wisc: 'Wiskunde C',
  wisd: 'Wiskunde D',
};

/** "Opdracht · Natuurkunde · gymnasium 4, 5, 6"; empty parts are left out. */
export function editorSubtitle(opdracht: Pick<Opdracht, 'vakken' | 'schoolsoort' | 'jaarlagen'>) {
  const vakken = (opdracht.vakken ?? []).map((v) => VAK_LABEL[v] ?? v).join(', ');
  const ss = (opdracht.schoolsoort ?? []).join(', ').toLowerCase();
  const jl = [...(opdracht.jaarlagen ?? [])]
    .map(Number)
    .sort((a, b) => a - b)
    .join(', ');
  const level = [ss, jl].filter(Boolean).join(' ');
  return ['Opdracht', vakken, level].filter(Boolean).join(' · ');
}
