// SPDX-License-Identifier: AGPL-3.0-or-later

// The resit dot (design spec 3.10, PLAN-2 decision 28): the `.attempt-badge` (I or H) directly
// right of the grade pill without moving it, so the grades stay aligned.

import { formatGrade } from '../domain/format';
import type { Exam } from '../domain/types';
import { esc } from '../utils/html';

export interface ResitInfo {
  /** The letter on the dot: I, H, or the first letter of the resit's own word. */
  letter: string;
  /** "Herkansing (poging 2)". */
  title: string;
}

/** The dot of the attempt that counts; null for an original. */
export function resitInfo(
  attempt: Pick<Exam, 'parent_id' | 'description' | 'attempt'> | null | undefined,
): ResitInfo | null {
  if (!attempt?.parent_id) return null;
  const desc = (attempt.description ?? '').trim();
  const word =
    desc === 'INHAAL' ? 'Inhaal' : desc === 'HERKANSING' ? 'Herkansing' : desc || 'Poging';
  const letter = desc.charAt(0).toUpperCase() || '?';
  return { letter, title: `${word} (poging ${attempt.attempt ?? 2})` };
}

/** "Herkansing (poging 2), origineel 4,9" when the original has a grade. */
export function resitSubline(info: ResitInfo, originalGrade: number | null): string {
  return originalGrade == null
    ? info.title
    : `${info.title}, origineel ${formatGrade(originalGrade)}`;
}

export function resitDotHtml(info: ResitInfo | null): string {
  return info
    ? `<span class="attempt-badge ov-dot" title="${esc(info.title)}">${esc(info.letter)}</span>`
    : '';
}

/**
 * A grade with its dot: the pill in an inline box, the dot hanging right of it out of the flow.
 * `dotted`: the grade has observaties in its tooltip, marked by a triangle in the pill's corner.
 */
export function gradeWithDotHtml(
  pillHtml: string,
  info: ResitInfo | null,
  { dotted = false }: { dotted?: boolean } = {},
): string {
  return (
    `<span class="ov-grade"><span class="ov-grade__pill${dotted ? ' ov-grade__pill--obs' : ''}">${pillHtml}</span>` +
    `<span class="ov-grade__dot">${resitDotHtml(info)}</span></span>`
  );
}
