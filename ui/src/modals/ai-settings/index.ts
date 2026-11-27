// SPDX-License-Identifier: AGPL-3.0-or-later

// AI-instellingen (board 62, decisions 71, 72, 77; step 32c): per teacher on this computer.
// The "AI-assistent tonen" switch; the CLIs found, one accordion card each (command, arguments
// for the first and later messages, standaard/aangepast, Standaard herstellen); the teacher's
// own CLIs ("Eigen CLI toevoegen"); the ones not found with the install help; the time limit;
// the syllabus folder (fixed, read-only, Map openen). Opened from the editor's gear and the user
// menu. Text goes in as text nodes (paths and commands come from the computer).

import type { AiApi, AiDetection, AiProvider, CustomCli } from '../../bridge/ai-api';
import { openDialog, type Dialog } from '../../components/dialog';
import { switchControl } from '../../components/switch';
import { h, icon } from '../../editor/ai/dom';
import { installList, logoTile } from '../../editor/ai/install';
import {
  CUSTOM_DEFAULT_ARGS,
  MINUTES,
  argsProblem,
  customKey,
  customProblem,
  isCustomized,
  minutesProblem,
  rowOf,
  settingsToSave,
  type BuiltinRow,
} from './model';

export interface AiSettingsOptions {
  ai: AiApi;
  gebruiker: string;
  /** Called after a save, with the detection as it is now. */
  onSaved?: (detection: AiDetection) => void;
}

function field(
  id: string,
  label: string,
  value: string,
  onInput: (v: string) => void,
  opts: { mono?: boolean; readOnly?: boolean } = {},
): [HTMLElement, HTMLInputElement] {
  const input = h('input', {
    id,
    type: 'text',
    class: `form-control${opts.mono === false ? '' : ' ais-mono'}`,
    spellcheck: 'false',
    autocomplete: 'off',
    readonly: opts.readOnly === true,
  });
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  return [h('label', { class: 'ais-cap', for: id }, label), input];
}

/** Opens AI-instellingen; resolves true after Opslaan. */
export async function openAiSettings(opts: AiSettingsOptions): Promise<boolean> {
  const { ai, gebruiker } = opts;
  let detection = await ai.detect(gebruiker, false);
  const syllabus = await ai.syllabusList().catch(() => ({ folder: '', files: [] }));
  const original = detection.settings;

  let rows: BuiltinRow[] = [];
  let custom: CustomCli[] = (original.custom ?? []).map((c) => ({ ...c }));
  let openKey: string | null = null;
  let installOpen = false;
  let dirty = false;
  const touch = () => (dirty = true);

  const takeRows = (d: AiDetection) => {
    // Keep what the teacher typed for a CLI that is still there after Opnieuw zoeken.
    const typed = new Map(rows.map((r) => [r.builtin, r]));
    rows = d.providers
      .filter((p) => p.found)
      .map(rowOf)
      .filter((r): r is BuiltinRow => r !== null)
      .map((r) => {
        const t = typed.get(r.builtin);
        return t ? { ...r, command: t.command, args: t.args, argsNext: t.argsNext } : r;
      });
  };
  takeRows(detection);

  const show = switchControl({
    id: 'ais-enabled',
    label: 'AI-assistent tonen',
    hint: 'De AI-balk rechts in de opdrachten-editor. Geldt voor jou, op deze computer.',
    checked: original.enabled,
    onChange: (on) => {
      touch();
      section.classList.toggle('is-off', !on);
      times.classList.toggle('is-off', !on);
    },
  });

  const list = h('div', { class: 'ais-list' });
  const section = h(
    'section',
    { class: 'ais-section', 'aria-labelledby': 'ais-cli-head' },
    h(
      'div',
      { class: 'ais-section__head' },
      h('span', { class: 'ais-cap', id: 'ais-cli-head' }, 'AI-PROGRAMMA’S OP DEZE COMPUTER'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--text btn--sm',
          id: 'ais-rescan',
          onclick: () => void rescan(),
        },
        'Opnieuw zoeken',
      ),
    ),
    list,
  );

  const minutesInput = h('input', {
    id: 'ais-minutes',
    type: 'number',
    inputmode: 'numeric',
    min: MINUTES[0],
    max: MINUTES[1],
    'aria-describedby': 'ais-minutes-hint',
  });
  minutesInput.value = String(original.timeLimitMinutes);
  minutesInput.addEventListener('input', touch);
  const times = h(
    'div',
    { class: 'ais-grid' },
    h(
      'div',
      { class: 'ais-field' },
      h('label', { class: 'ais-cap', for: 'ais-minutes' }, 'TIJDSLIMIET'),
      h(
        'span',
        { class: 'unit-input' },
        minutesInput,
        h('span', { class: 'unit-input__unit' }, 'minuten'),
      ),
      h(
        'span',
        { class: 'ais-hint', id: 'ais-minutes-hint' },
        `Daarna stopt Maatwerk de AI. ${MINUTES[0]} tot ${MINUTES[1]}.`,
      ),
    ),
    h(
      'div',
      { class: 'ais-field' },
      h('label', { class: 'ais-cap', for: 'ais-syllabus' }, 'SYLLABUSMAP'),
      h(
        'div',
        { class: 'ais-row' },
        field('ais-syllabus', '', syllabus.folder, () => {}, { readOnly: true })[1],
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary',
            onclick: () => void ai.openSyllabusFolder().catch(() => {}),
          },
          'Map openen',
        ),
      ),
      h(
        'span',
        { class: 'ais-hint' },
        'De PDF’s in deze map staan in de Syllabus-keuze. Een bestand met het vak en de ' +
          'schoolsoort van de opdracht in de naam wordt voorgeselecteerd (bijv. ‘Natuurkunde ' +
          'havo 2026.pdf’).',
      ),
    ),
  );
  if (!original.enabled) {
    section.classList.add('is-off');
    times.classList.add('is-off');
  }

  const error = h('p', { class: 'ais-error', role: 'alert', hidden: true });
  const body = h('div', { class: 'ais-body' }, show.element, section, times, error);

  function builtinCard(row: BuiltinRow, p: AiProvider): HTMLElement {
    const open = openKey === row.builtin;
    const tag = h('span', { class: 'ais-tag' });
    const showTag = () => {
      const changed = isCustomized(row);
      tag.textContent = changed ? 'aangepast' : 'standaard';
      tag.classList.toggle('is-changed', changed);
    };
    showTag();
    const id = `ais-${row.builtin}`;
    const edit = (k: 'command' | 'args' | 'argsNext') => (v: string) => {
      row[k] = v;
      touch();
      showTag();
    };
    const fields = open
      ? h(
          'div',
          { class: 'ais-card__body', id: `${id}-body` },
          ...field(`${id}-cmd`, 'OPDRACHT', row.command, edit('command')),
          ...field(`${id}-args`, 'ARGUMENTEN', row.args, edit('args')),
          ...field(`${id}-next`, 'VERVOLGBERICHT', row.argsNext, edit('argsNext')),
          h('span'),
          h(
            'div',
            { class: 'ais-card__foot' },
            h(
              'span',
              { class: 'ais-hint' },
              'Maatwerk voegt zelf de vraag en de map met de kopie toe.',
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn--text btn--sm',
                onclick: () => {
                  Object.assign(row, row.defaults);
                  touch();
                  render();
                },
              },
              'Standaard herstellen',
            ),
          ),
        )
      : null;
    return card(row.builtin, p.name, p.path ?? '', tag, open, fields, p.beta === true);
  }

  function customCard(c: CustomCli, found: AiProvider | undefined): HTMLElement {
    const open = openKey === c.key;
    const tag = h(
      'span',
      { class: `ais-tag${found?.found ? '' : ' is-missing'}` },
      found?.found ? 'eigen CLI' : 'eigen CLI · niet gevonden',
    );
    const id = `ais-${c.key}`;
    const edit = (k: 'name' | 'command' | 'args' | 'argsNext') => (v: string) => {
      c[k] = v;
      touch();
    };
    const fields = open
      ? h(
          'div',
          { class: 'ais-card__body', id: `${id}-body` },
          ...field(`${id}-name`, 'NAAM', c.name, edit('name'), { mono: false }),
          ...field(`${id}-cmd`, 'OPDRACHT', c.command, edit('command')),
          ...field(`${id}-args`, 'ARGUMENTEN', c.args, edit('args')),
          ...field(`${id}-next`, 'VERVOLGBERICHT', c.argsNext, edit('argsNext')),
          h('span'),
          h(
            'div',
            { class: 'ais-card__foot' },
            h(
              'span',
              { class: 'ais-hint' },
              'Plaatshouders: {prompt}, {request}, {workdir}, {session}, {check}, {images}, ' +
                '{run}, {secs}. Leeg vervolgbericht: elk bericht start opnieuw met het hele ' +
                'gesprek. Maatwerk leest het antwoord als gewone tekst en controleert de ' +
                'opdracht zelf.',
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn--text btn--sm ais-danger-text',
                onclick: () => {
                  custom = custom.filter((x) => x !== c);
                  touch();
                  render();
                },
              },
              'Verwijderen',
            ),
          ),
        )
      : null;
    return card(c.key, c.name || 'Eigen CLI', found?.path ?? c.command, tag, open, fields);
  }

  function card(
    key: string,
    name: string,
    path: string,
    tag: HTMLElement,
    open: boolean,
    fields: HTMLElement | null,
    beta = false,
  ): HTMLElement {
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'ais-card__head',
        'aria-expanded': String(open),
        'aria-controls': `ais-${key}-body`,
        onclick: () => {
          openKey = open ? null : key;
          render();
          body.querySelector<HTMLElement>(`[data-key="${key}"] .ais-card__head`)?.focus();
        },
      },
      logoTile(key, name),
      h(
        'span',
        { class: 'ais-card__name' },
        h(
          'span',
          { class: 'ais-card__title' },
          h('strong', {}, name),
          beta
            ? h(
                'span',
                { class: 'ais-beta', title: 'Nog niet getest met het echte programma' },
                'bèta',
              )
            : null,
        ),
        h('span', { class: 'ais-mono ais-muted' }, path),
      ),
      tag,
      icon('chevronDown', 14, 2.4),
    );
    return h(
      'div',
      { class: `ais-card${open ? ' is-open' : ''}`, 'data-key': key },
      toggle,
      fields,
    );
  }

  function render(): void {
    const children: HTMLElement[] = [];
    for (const row of rows) {
      const p = detection.providers.find((x) => x.builtin === row.builtin)!;
      children.push(builtinCard(row, p));
    }
    for (const c of custom) {
      children.push(
        customCard(
          c,
          detection.providers.find((p) => p.key === c.key),
        ),
      );
    }
    if (!children.length) {
      children.push(h('p', { class: 'ais-hint' }, 'Geen AI-programma gevonden op deze computer.'));
    }
    const missing = detection.providers.filter((p) => p.builtin && !p.found);
    const foot = h('div', { class: 'ais-list__foot' });
    if (missing.length) {
      foot.append(
        h(
          'span',
          { class: 'ais-hint' },
          `Niet gevonden: ${missing.map((p) => p.name).join(', ')} · `,
          h(
            'button',
            {
              type: 'button',
              class: 'ais-link',
              'aria-expanded': String(installOpen),
              onclick: () => {
                installOpen = !installOpen;
                render();
              },
            },
            'Installatiehulp',
          ),
        ),
      );
    }
    foot.append(
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--secondary btn--sm',
          id: 'ais-add-custom',
          onclick: () => {
            const name = 'Eigen CLI';
            const c: CustomCli = {
              key: customKey(name, [
                ...custom.map((x) => x.key),
                ...detection.providers.map((p) => p.key),
              ]),
              name,
              command: '',
              args: CUSTOM_DEFAULT_ARGS,
              argsNext: '',
            };
            custom = [...custom, c];
            openKey = c.key;
            touch();
            render();
            body.querySelector<HTMLInputElement>(`#ais-${c.key}-name`)?.select();
          },
        },
        icon('plus', 14),
        'Eigen CLI toevoegen',
      ),
    );
    list.replaceChildren(...children, foot);
    if (installOpen && missing.length) list.append(installList(missing));
  }

  async function rescan(): Promise<void> {
    const btn = body.querySelector<HTMLButtonElement>('#ais-rescan')!;
    btn.disabled = true;
    try {
      detection = await ai.detect(gebruiker, true);
      takeRows(detection);
      render();
    } finally {
      btn.disabled = false;
    }
  }

  const problem = (): string | null => {
    const m = minutesProblem(minutesInput.value);
    if (m) return `Tijdslimiet: ${m}`;
    for (const r of rows) {
      const name = detection.providers.find((p) => p.builtin === r.builtin)?.name ?? r.builtin;
      if (!r.command.trim()) return `${name}: vul de opdracht in.`;
      const a = argsProblem(r.args) ?? argsProblem(r.argsNext);
      if (a) return `${name}: ${a}`;
    }
    for (const c of custom) {
      const e = customProblem(c);
      if (e) return e;
    }
    return null;
  };

  render();
  return new Promise<boolean>((resolve) => {
    let saved = false;
    const save = async (dialog: Dialog) => {
      const p = problem();
      error.hidden = !p;
      error.textContent = p ?? '';
      if (p) return;
      const next = settingsToSave(original, {
        enabled: show.checked(),
        minutes: Number(minutesInput.value.trim()),
        rows,
        custom,
      });
      try {
        await ai.saveSettings(gebruiker, next);
      } catch (e) {
        error.hidden = false;
        error.textContent = e instanceof Error ? e.message : String(e);
        return;
      }
      saved = true;
      dialog.close();
      opts.onSaved?.(await ai.detect(gebruiker, false));
    };
    openDialog({
      title: 'AI-instellingen',
      size: 'form',
      className: 'ai-settings',
      dialogId: 'ai-settings',
      body,
      footer: [
        { label: 'Annuleren', onClick: 'request-close', id: 'cancel' },
        { label: 'Opslaan', variant: 'primary', onClick: save, id: 'save' },
      ],
      onShow: (_root, dialog) => {
        dialog.setGuard(() => dirty);
        dialog.footer.prepend(
          h(
            'span',
            { class: 'ais-foot-note' },
            'Gesprekken blijven op deze computer bij de opdracht.',
          ),
        );
      },
      onClose: () => resolve(saved),
    });
  });
}
