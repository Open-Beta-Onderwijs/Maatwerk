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

/**
 * Card numbers already computed, per data generation (Store.generation: any change to cached
 * data starts a new one), so a search keystroke or a filter change shows them at once instead
 * of blank cards while they are computed again (review 26-28 M2).
 */
const cache = { generation: -1, html: new Map<string, string>() };

function cached(): Map<string, string> {
  const gen = Store.generation() as number;
  if (cache.generation !== gen) {
    cache.generation = gen;
    cache.html = new Map();
  }
  return cache.html;
}

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
    const known = cached();
    const keyOf = (id: string) => `${year}|${subject}|${id}`;
    const todo = students.filter((s) => {
      const hit = known.get(keyOf(s.id));
      if (hit === undefined) return true;
      html.set(s.id, hit);
      put(s.id);
      return false;
    });
    syncSwaps(container);
    if (!todo.length) return;
    const end = perfSpan('leerlingen:grades');
    const ids = todo.map((s) => s.id);
    const upper = todo.filter((s) => isUpperSchool(s.jaarlaag ?? jaarlaagOf(s)));
    const years: string[] = upper.length ? (Store.listYearsSync() as string[]) : [year];
    // One folder read per year instead of one per student (Step 7c).
    // Every year once (not once per student, review 26-28 M2): the SE needs all of them, and
    // their tests must be loaded before getAllExamsSync (m3).
    await Promise.all(
      years.map((y) =>
        Promise.all([
          (Store.loadYear(y, subject) as Promise<void>).catch(() => {}),
          (Store.preloadScores(y, subject, ids) as Promise<void>).catch(() => {}),
        ]),
      ),
    );
    if (cancelled) return;
    const exams = Store.getExamsSync(year, subject) as Exam[];
    const allExams = upper.length ? (Store.getAllExamsSync(subject) as Exam[]) : [];
    for (let i = 0; i < todo.length; i += BATCH) {
      for (const s of todo.slice(i, i + BATCH)) {
        const rec = (await Store.getStudentScores(s.id, year, subject)) as ScoreRecord;
        const se = isUpperSchool(s.jaarlaag ?? jaarlaagOf(s))
          ? {
              history: (await Store.getStudentHistory(s.id, subject, {
                loaded: true,
              })) as HistoryEntry[],
              allExams,
            }
          : null;
        if (cancelled) return;
        const value = studentGradesHtml(studentCardNumbers(exams, rec, se));
        html.set(s.id, value);
        // The generation may have moved while the data loaded: store under the current one.
        cached().set(keyOf(s.id), value);
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
