// SPDX-License-Identifier: AGPL-3.0-or-later

// The RTTI categories as the UI names them (PLAN-2 decision 33, design spec 2.6, F-26): R =
// reproductie, T1 = training, T2 = transfer, I = inzicht, as the rapport (`rapport.typ`). Never
// "toepassen bekend" / "toepassen nieuw".

import type { RttiCategory } from './grades';

/** The categories in display order. */
export const RTTI_CATS: readonly RttiCategory[] = ['R', 'T1', 'T2', 'I'];

/** The name of each category, lower case (legends: "R reproductie"). */
export const RTTI_NAMES: Readonly<Record<RttiCategory, string>> = {
  R: 'reproductie',
  T1: 'training',
  T2: 'transfer',
  I: 'inzicht',
};

/** The colour token of each category (design spec 2.6). */
export const RTTI_TOKENS: Readonly<Record<RttiCategory, string>> = {
  R: '--rtti-r',
  T1: '--rtti-t1',
  T2: '--rtti-t2',
  I: '--rtti-i',
};

/** The UI colours as hex, for SVG attributes (same values as the tokens, both themes). */
export const RTTI_HEX: Readonly<Record<RttiCategory, string>> = {
  R: '#3A9A4A',
  T1: '#2A9FC4',
  T2: '#E0922F',
  I: '#D24A45',
};

/** "T1 (training)": a category with its name, for tooltips and help text. */
export function rttiLabel(cat: RttiCategory): string {
  return `${cat} (${RTTI_NAMES[cat]})`;
}

/** The name with a capital ("Training"), for headings. */
export function rttiTitle(cat: RttiCategory): string {
  const n = RTTI_NAMES[cat];
  return n.charAt(0).toUpperCase() + n.slice(1);
}
