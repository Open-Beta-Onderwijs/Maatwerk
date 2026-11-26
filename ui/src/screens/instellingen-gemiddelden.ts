// SPDX-License-Identifier: AGPL-3.0-or-later

// Beheer › Instellingen › Cijfergemiddelden (step 38, decisions 91-93, board 64): per student
// average, r (jaargemiddelde) and SE, a method (afronden / afkappen) and 0, 1 or 2 decimals,
// school-wide in `instellingen.json` `gemiddelden`. A table with rows Methode, Decimalen and
// Voorbeelden; the examples are the grade rules' (`shownAverage`), live.

import { formatShown } from '../domain/format';
import { shownTextColor } from '../domain/grade-colors';
import { readFormats, type Formats } from '../domain/numbers';
import { isFailShown, shownAverage, type AverageFormat } from '../domain/statistics';

/**
 * The examples of decision 93, plus 6,666... (e.g. 6,0 and 7,0 twice): the only one that differs
 * between afronden and afkappen at 2 decimals (step 39, user). A label and the exact average.
 */
export const EXAMPLES: readonly { label: string; value: number }[] = [
  { label: '5,45', value: 5.45 },
  { label: '5,3 en 5,7', value: 5.5 },
  { label: '5,9', value: 5.9 },
  { label: '6,666…', value: 20 / 3 },
  { label: '6,95', value: 6.95 },
];

const METHODS: readonly [AverageFormat['methode'], string][] = [
  ['afronden', 'Afronden'],
  ['afkappen', 'Afkappen'],
];
const DECIMALS: readonly AverageFormat['decimalen'][] = [0, 1, 2];

type Key = keyof Formats;
const COLUMNS: readonly [Key, string][] = [
  ['r', 'Jaargemiddelde (r)'],
  ['se', 'SE-gemiddelde'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** The example cells of one format: "5,45 → 5,5", red when the shown value fails. */
export function exampleRows(
  fmt: AverageFormat,
): { label: string; text: string; shown: number; fails: boolean }[] {
  return EXAMPLES.map(({ label, value }) => {
    const shown = shownAverage(value, fmt);
    return { label, text: formatShown(shown, fmt), shown, fails: isFailShown(shown) };
  });
}

/**
 * The card. `value()` gives the formats as chosen, for saving into `instellingen.json`
 * (`gemiddelden`).
 */
export function gemiddeldenCard(instellingen: unknown): {
  element: HTMLElement;
  value(): Formats;
} {
  const chosen: Formats = readFormats(instellingen);
  const card = el('section', 'card inst-card inst-gem');
  card.append(
    el('h3', 'inst-card__title', 'Cijfergemiddelden'),
    el(
      'p',
      'hint',
      'Hoe het gemiddelde van een leerling wordt getoond, voor de hele school. Het ' +
        'jaargemiddelde (r) en het SE-gemiddelde hebben elk hun eigen instelling.',
    ),
  );
  const table = el('table', 'inst-gem__table');
  const head = el('tr');
  head.append(el('th'));
  for (const [, label] of COLUMNS) {
    // Uppercase as the board, but the r stays a small r: "JAARGEMIDDELDE (r)".
    const th = el(
      'th',
      'inst-gem__col',
      label.replace(/^[^(]+/, (t) => t.toUpperCase()),
    );
    th.scope = 'col';
    head.append(th);
  }
  table.append(el('thead'), el('tbody'));
  table.tHead!.append(head);
  const body = table.tBodies[0]!;

  const rowHead = (text: string) => {
    const th = el('th', 'inst-gem__row', text);
    th.scope = 'row';
    return th;
  };
  const methodRow = el('tr');
  const decimalRow = el('tr');
  const exampleRow = el('tr', 'inst-gem__examples');
  methodRow.append(rowHead('Methode'));
  decimalRow.append(rowHead('Decimalen'));
  exampleRow.append(rowHead('Voorbeelden'));

  const examplesOf = new Map<Key, HTMLElement>();
  const drawExamples = (key: Key) => {
    const list = examplesOf.get(key)!;
    list.replaceChildren(
      ...exampleRows(chosen[key]).map((x) => {
        const li = el('li');
        const b = el('b', '', x.text);
        b.style.color = shownTextColor(x);
        li.append(el('span', 'inst-gem__from', x.label), el('span', '', '→'), b);
        return li;
      }),
    );
  };

  const segmented = <T>(
    key: Key,
    label: string,
    options: readonly (readonly [T, string])[],
    current: () => T,
    set: (v: T) => void,
  ) => {
    const group = el('div', 'segmented');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const buttons = options.map(([v, text]) => {
      const b = el('button', 'segmented__opt', text);
      b.type = 'button';
      b.addEventListener('click', () => {
        set(v);
        sync();
        drawExamples(key);
      });
      return { b, v };
    });
    const sync = () =>
      buttons.forEach(({ b, v }) => b.setAttribute('aria-pressed', String(v === current())));
    sync();
    group.append(...buttons.map(({ b }) => b));
    return group;
  };

  for (const [key, colLabel] of COLUMNS) {
    const m = el('td');
    m.append(
      segmented(
        key,
        `Methode ${colLabel}`,
        METHODS,
        () => chosen[key].methode,
        (v) => {
          chosen[key] = { ...chosen[key], methode: v };
        },
      ),
    );
    methodRow.append(m);
    const d = el('td');
    d.append(
      segmented(
        key,
        `Decimalen ${colLabel}`,
        DECIMALS.map((n) => [n, String(n)] as const),
        () => chosen[key].decimalen,
        (v) => {
          chosen[key] = { ...chosen[key], decimalen: v };
        },
      ),
    );
    decimalRow.append(d);
    const e = el('td');
    const list = el('ul', 'inst-gem__list');
    list.setAttribute('aria-live', 'polite');
    examplesOf.set(key, list);
    e.append(list);
    exampleRow.append(e);
    drawExamples(key);
  }
  body.append(methodRow, decimalRow, exampleRow);
  card.append(
    table,
    el(
      'p',
      'form-hint muted',
      'Geldt voor leerlinggemiddelden. Toetsgemiddelden blijven afgerond op 1 decimaal.',
    ),
  );
  return { element: card, value: () => ({ r: { ...chosen.r }, se: { ...chosen.se } }) };
}
