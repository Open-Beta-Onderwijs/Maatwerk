// SPDX-License-Identifier: AGPL-3.0-or-later

// A filter chip with one choice out of a few (spec 3.2): "Alle toetstypes / Toets / PO" on the
// Observaties tab (step 21, F-23). The chip shows the choice and is marked active when it is not
// the first ("alle") option. A click opens a small popover with the options as radio buttons;
// Escape, a click outside or a choice closes it.

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

const FILTER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/></svg>';

export interface ChoiceChip<T extends string> {
  element: HTMLElement;
  value(): T;
  set(value: T): void;
}

export function choiceChip<T extends string>(opts: {
  id: string;
  label: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}): ChoiceChip<T> {
  let current = opts.value;
  const wrap = document.createElement('div');
  wrap.className = 'filter-popover-wrap choice-chip';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'filter-btn';
  btn.id = opts.id;
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.title = opts.label;
  const label = document.createElement('span');
  label.className = 'filter-btn-label';
  btn.innerHTML = FILTER_ICON;
  btn.append(label);
  const pop = document.createElement('div');
  pop.className = 'filter-popover choice-chip-pop hidden';
  pop.setAttribute('role', 'radiogroup');
  pop.setAttribute('aria-label', opts.label);
  wrap.append(btn, pop);

  const show = (): void => {
    const opt = opts.options.find((o) => o.value === current) ?? opts.options[0];
    label.textContent = opt?.label ?? '';
    btn.classList.toggle('filter-btn-active', current !== opts.options[0]?.value);
    pop.replaceChildren(
      ...opts.options.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `filter-pop-toggle${o.value === current ? ' selected' : ''}`;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(o.value === current));
        b.dataset.value = o.value;
        b.textContent = o.label;
        return b;
      }),
    );
  };

  const close = (): void => {
    pop.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = (e: Event): void => {
    if (!wrap.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
    btn.focus();
  };

  btn.addEventListener('click', () => {
    if (!pop.classList.contains('hidden')) {
      close();
      return;
    }
    pop.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    pop.querySelector<HTMLElement>('.selected')?.focus();
  });
  pop.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
    if (!b) return;
    current = b.dataset.value as T;
    show();
    close();
    btn.focus();
    opts.onChange(current);
  });

  show();
  return {
    element: wrap,
    value: () => current,
    set: (value) => {
      current = value;
      show();
    },
  };
}
