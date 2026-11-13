// SPDX-License-Identifier: AGPL-3.0-or-later

// Fills the grade part of the student cards (F-07) after the cards are on
// screen: the scores are read in one go per year (Store.preloadScores), then
// the numbers are computed in small batches so the list stays responsive.
// Cards added later (idle slices) get their numbers as they appear.

import { isUpperSchool, studentCardNumbers } from '../../domain/cards';
import type { HistoryEntry } from '../../domain/attempts';
import type { Exam, ScoreRecord } from '../../domain/types';
import { applyStyleData } from '../../legacy/style-data';
import { Store } from '../../store.js';
import { perfSpan } from '../../utils/perf';
import { studentGradesHtml } from './card-html';

export interface GradeFill {
  /** A card element was added: fill it if its numbers are known. */
  show(card: HTMLElement): void;
  cancel(): void;
}

interface CardStudent {
  id: string;
  stamklas?: string;
  jaarlaag?: string | number;
}

const BATCH = 40;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Keeps the "laatste / SE" swap of every card in step (spec 4.3: all cards in
 * sync), also for cards added later: their CSS animations start at time 0.
 */
export function syncSwaps(root: ParentNode = document): void {
  for (const el of root.querySelectorAll('.s-card__swap > span')) {
    for (const a of el.getAnimations()) a.startTime = 0;
  }
}

export function fillStudentGrades(
  container: HTMLElement,
  students: CardStudent[],
  year: string,
): GradeFill {
  const html = new Map<string, string>();
  let cancelled = false;

  const put = (id: string) => {
    const slot = container.querySelector<HTMLElement>(`[data-card-grades="${CSS.escape(id)}"]`);
    const value = html.get(id);
    if (!slot || value === undefined) return;
    slot.innerHTML = value;
    applyStyleData(slot);
  };

  async function run(): Promise<void> {
    const subject = Store.getActiveSubject() as string | null;
    if (!subject) return;
    const end = perfSpan('leerlingen:grades');
    const ids = students.map((s) => s.id);
    const upper = students.filter((s) => isUpperSchool(s.jaarlaag ?? jaarlaagOf(s)));
    const years: string[] = upper.length ? (Store.listYearsSync() as string[]) : [year];
    // One folder read per year instead of one per student (Step 7c).
    await Promise.all([
      (Store.getExams(year, subject) as Promise<unknown>).catch(() => {}),
      ...years.map((y) => (Store.preloadScores(y, subject, ids) as Promise<void>).catch(() => {})),
    ]);
    if (cancelled) return;
    const exams = Store.getExamsSync(year, subject) as Exam[];
    const allExams = upper.length ? (Store.getAllExamsSync(subject) as Exam[]) : [];
    for (let i = 0; i < students.length; i += BATCH) {
      for (const s of students.slice(i, i + BATCH)) {
        const rec = (await Store.getStudentScores(s.id, year, subject)) as ScoreRecord;
        const se = isUpperSchool(s.jaarlaag ?? jaarlaagOf(s))
          ? {
              history: (await Store.getStudentHistory(s.id, subject)) as HistoryEntry[],
              allExams,
            }
          : null;
        if (cancelled) return;
        html.set(s.id, studentGradesHtml(studentCardNumbers(exams, rec, se)));
        put(s.id);
      }
      syncSwaps(container);
      await nextFrame();
      if (cancelled) return;
    }
    end();
  }

  run().catch((e) => console.warn('[leerlingen] cijfers', e));
  return {
    show(card) {
      const id = card.dataset.id;
      if (id && html.has(id)) {
        put(id);
        syncSwaps(card);
      }
    },
    cancel() {
      cancelled = true;
    },
  };
}

function jaarlaagOf(s: CardStudent): string {
  return (Store.jaarlaagFromStamklas(s.stamklas ?? '') as string) || '';
}
