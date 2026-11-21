// SPDX-License-Identifier: AGPL-3.0-or-later

// Opdracht toevoegen "met AI" (decision 74, board 63; step 32c): below the fields a card with
// the switch "Eerste versie laten maken met AI", the description of what the opdracht should
// hold and the AI-programma (installed CLIs only). Only when the school and the teacher have the
// assistant on and a CLI is found. The message goes into the editor's chat and is sent at once.

import type { AiApi, ProviderKey } from '../bridge/ai-api';
import { switchControl } from '../components/switch';
import { h } from '../editor/ai/dom';

export interface AiStartChoice {
  provider: ProviderKey;
  message: string;
}

export interface AiStartCard {
  element: HTMLElement;
  /** On: the choice (an empty message counts as on, so the caller can ask for it). */
  value(): AiStartChoice | null;
  on(): boolean;
}

/** The card, or null when the assistant is not available for this teacher. */
export async function aiStartCard(
  ai: AiApi,
  gebruiker: string,
  onToggle: (on: boolean) => void,
): Promise<AiStartCard | null> {
  const d = await ai.detect(gebruiker, false).catch(() => null);
  if (!d || !d.school || !d.settings.enabled) return null;
  const found = d.providers.filter((p) => p.found);
  if (!found.length) return null;

  const text = h('textarea', {
    id: 'op-ai-text',
    rows: 4,
    class: 'op-ai__text',
    placeholder:
      'Bijv. korte uitleg met een uitgewerkt voorbeeld, daarna drie opgaven van oplopende moeilijkheid, met antwoordmodel en punten.',
  });
  const select = h('select', { id: 'op-ai-provider' });
  for (const p of found) select.append(h('option', { value: p.key }, p.name));
  const fields = h(
    'div',
    { class: 'op-ai__fields', hidden: true },
    h('label', { class: 'form-label', for: 'op-ai-text' }, 'Wat moet er in de opdracht staan?'),
    text,
    h(
      'div',
      { class: 'op-ai__row' },
      h('label', { class: 'form-label', for: 'op-ai-provider' }, 'AI-programma'),
      select,
      h(
        'span',
        { class: 'op-ai__hint' },
        'De gegevens hierboven gaan als context mee. Dit wordt het eerste bericht in de chat.',
      ),
    ),
  );
  const card = h('section', { class: 'op-ai', 'aria-label': 'AI' });
  const sw = switchControl({
    id: 'op-ai-on',
    label: 'Eerste versie laten maken met AI',
    hint: 'Zonder AI begin je met het lege sjabloon.',
    checked: false,
    onChange: (on) => {
      fields.hidden = !on;
      card.classList.toggle('is-on', on);
      onToggle(on);
      if (on) text.focus();
    },
  });
  card.append(sw.element, fields);
  return {
    element: card,
    on: () => sw.checked(),
    value: () =>
      sw.checked() ? { provider: select.value as ProviderKey, message: text.value.trim() } : null,
  };
}
