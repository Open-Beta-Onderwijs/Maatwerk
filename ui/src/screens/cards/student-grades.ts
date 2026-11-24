// SPDX-License-Identifier: AGPL-3.0-or-later

// Fills the grade part of the student cards (F-07) after the cards are on
// screen: the numbers come from Rust in one call per year and vak (step 38,
// services/vak-numbers.ts); the cards are filled in small batches so the list
// stays responsive. Cards added later (idle slices) get their numbers as they
// appear.

import { studentCard } from '../../domain/cards';
import type { Exam } from '../../domain/types';
import { applyStyleData } from '../../legacy/style-data';
import { vakNumbers } from '../../services/vak-numbers';
import { Store } from '../../store.js';
import { perfSpan } from '../../utils/perf';
import { studentGradesHtml } from './card-html';
import { startSwapClock } from './swap-clock';

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

export function fillStudentGrades(
  container: HTMLElement,
  students: CardStudent[],
  year: string,
): GradeFill {
  const html = new Map<string, string>();
  let cancelled = false;
  // The "laatste / SE" swap of years 4-6: one clock for every card (swap-clock.ts).
  startSwapClock();

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
    if (!todo.length) return;
    const end = perfSpan('leerlingen:grades');
    // The exams name the bars; the numbers are the core's.
    await (Store.loadYear(year, subject) as Promise<void>).catch(() => {});
    const numbers = await vakNumbers(year, subject, Store.generation() as number);
    if (cancelled) return;
    const exams = Store.getExamsSync(year, subject) as Exam[];
    for (let i = 0; i < todo.length; i += BATCH) {
      for (const s of todo.slice(i, i + BATCH)) {
        const value = studentGradesHtml(
          studentCard(numbers.students[s.id], exams, numbers.formats),
        );
        html.set(s.id, value);
        // The generation may have moved while the data loaded: store under the current one.
        cached().set(keyOf(s.id), value);
        put(s.id);
      }
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
      }
    },
    cancel() {
      cancelled = true;
    },
  };
}
