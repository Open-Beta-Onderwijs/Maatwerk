// SPDX-License-Identifier: AGPL-3.0-or-later

// The school types, in display order: one list for every form and filter (review 21 n8: it was
// repeated in seven files).

export const SCHOOLSOORTEN = [
  'Vmbo-bb',
  'Vmbo-kb',
  'Vmbo-gl',
  'Vmbo-tl',
  'Havo',
  'Vwo',
  'Gymnasium',
] as const;

export type Schoolsoort = (typeof SCHOOLSOORTEN)[number];
