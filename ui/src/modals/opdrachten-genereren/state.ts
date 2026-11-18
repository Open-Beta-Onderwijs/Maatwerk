// SPDX-License-Identifier: AGPL-3.0-or-later

// The state of the Opdrachten genereren modal, kept while it is open (also across silent
// refreshes by colleagues' changes).

import type { Assignment, Assignments } from '../../domain/opdrachten';
import type { PrintName } from '../../domain/print';
import type { CijferCard, Exam, VraagCard } from '../../domain/types';
import { formatFixed, formatNumber } from '../../domain/format';

export interface OgState {
  exam: Exam;
  /** { obsId: [opdrachtId] } */
  coupling: Record<string, string[]>;
  /** "Cijfer onder …" cards. */
  cijfer: CijferCard[];
  /** "Vraag … onder … punten" cards (F-14). */
  vraag: VraagCard[];
  /** The coupling as last saved (or loaded), to detect changes. */
  savedJson: string;
  showAll: boolean;
  /** Student ids unticked for this run. */
  excluded: Set<string>;
  includeAnswers: boolean;
  assignments: Assignments | null;
  busy: boolean;
  printPath?: string;
  printName?: PrintName;
}

/** The saved part of the state, as one string. */
export const couplingJson = (state: OgState): string =>
  JSON.stringify({ obs: state.coupling, cijfer: state.cijfer, vraag: state.vraag });

export const countLabel = (n: number | undefined): string =>
  n === undefined ? '' : n === 1 ? '1 leerling' : `${n} leerlingen`;

export const fmtOnder = (onder: number): string => formatFixed(Number(onder));

/** Points as typed in a question card: `2`, `1,5`. */
export const fmtPunten = (onder: number): string => formatNumber(Number(onder));

export function includedStudents(state: OgState): Assignment[] {
  return (state.assignments?.students ?? []).filter(
    (e) => !state.excluded.has(String(e.student.id)),
  );
}
