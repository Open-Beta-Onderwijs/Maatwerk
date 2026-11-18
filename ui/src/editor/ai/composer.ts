// SPDX-License-Identifier: AGPL-3.0-or-later

// The chat panel's composer (spec 4.8.1, boards 59-60): the image warning, the context chips
// with the syllabus listbox and the "Andere opdrachten" popover, the attachments (paperclip,
// drop, paste) with their errors, the input row and the footer line.

import type { AiAttachmentRequest, Starter, SyllabusList } from '../../bridge/ai-api';
import type { AiEditorInfo } from '../ai-protocol';
import type { EditorAi } from './client';
import { h, icon, type IconName } from './dom';
import {
  MAX_ATTACHMENTS,
  MAX_OTHERS,
  PASTE_TEXT_LIMIT,
  attachmentError,
  extOf,
  formatSize,
  isImageName,
  syllabusLabel,
  syllabusSubtitle,
  type Chips,
} from './model';

/** An attachment waiting to be sent. */
export interface PendingAttachment {
  name: string;
  size: number;
  token?: string;
  text?: string;
  dataBase64?: string;
}

export interface ComposerHost {
  ai: EditorAi;
  info: AiEditorInfo;
  syllabus: SyllabusList;
  preselected: string | null;
  /** The chips changed (remember them, decision 51). */
  chipsChanged(chips: Chips): void;
  /** `chips`: as they were for this message (Afbeeldingen is switched off after it). */
  send(
    message: string,
    starter: Starter | null,
    attachments: PendingAttachment[],
    chips: Chips,
  ): void;
  /** Attachments already sent in this conversation (10 per conversation). */
  usedAttachments(): number;
}

interface ChipDef {
  key: 'guide' | 'metadata' | 'diagnostics' | 'pdf' | 'images';
  label: string;
  tip: string;
}

const CHIPS: ChipDef[] = [
  {
    key: 'guide',
    label: 'Opdrachtinstructies AI',
    tip: 'Instructies voor de AI over het schrijven van opdrachten, met voorbeelden',
  },
  {
    key: 'metadata',
    label: 'Opdrachtgegevens',
    tip: 'Titel, vak, schoolsoort, jaarlagen en observaties',
  },
  {
    key: 'diagnostics',
    label: 'Fouten & waarschuwingen',
    tip: 'De huidige fouten en waarschuwingen',
  },
  { key: 'pdf', label: 'PDF-output', tip: 'De gerenderde pagina’s van de opdracht' },
];
const IMAGES_CHIP: ChipDef = {
  key: 'images',
  label: 'Afbeeldingen',
  tip: 'Afbeeldingen uit deze opdracht; alleen voor het volgende bericht',
};

const IMAGES_WARNING =
  'Afbeeldingen kunnen leerlingen tonen (foto’s van werk, uit de klas). Zet dit alleen aan als er geen leerlingen op staan. Geldt alleen voor het volgende bericht.';
export const FOOTER_TEXT =
  'Alleen deze opdracht en de gekozen context worden verstuurd, via jouw eigen abonnement.';
const PLACEHOLDER = 'Vraag iets over deze opdracht… (sleep of plak een bestand)';

const readBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('lezen mislukt'));
    r.readAsDataURL(file);
  });

export class Composer {
  readonly el: HTMLElement;
  private chips!: Chips;
  private attachments: PendingAttachment[] = [];
  private errors: string[] = [];
  private starter: Starter | null = null;
  private busy = false;
  private busyNaam = '';
  private popover: 'syllabus' | 'others' | null = null;
  private othersFilter = '';
  private readonly input: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly clip: HTMLButtonElement;
  private readonly warningEl: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly attachEl: HTMLElement;
  private readonly errorsEl: HTMLElement;
  private readonly popoverEl: HTMLElement;

  constructor(private readonly host: ComposerHost) {
    this.input = h('textarea', {
      class: 'ai-input',
      rows: 2,
      'aria-label': 'Bericht',
      placeholder: PLACEHOLDER,
    });
    this.input.addEventListener('input', () => {
      if (!this.input.value.trim()) this.starter = null;
      this.renderSend();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submit();
      }
    });
    this.input.addEventListener('paste', (e) => this.onPaste(e));
    this.clip = h(
      'button',
      {
        type: 'button',
        class: 'ai-clip',
        'aria-label': 'Bijlage toevoegen',
        title: 'Bijlage toevoegen (max. 25 MB per bestand, 10 per gesprek)',
        onclick: () => void this.pick(),
      },
      icon('paperclip', 18),
    );
    this.sendBtn = h(
      'button',
      { type: 'button', class: 'ai-send', 'aria-label': 'Versturen', onclick: () => this.submit() },
      icon('send', 17, 2.2),
    );
    this.warningEl = h('div', { class: 'ai-warning', role: 'alert' });
    this.chipsEl = h('div', {
      class: 'ai-chips',
      role: 'group',
      'aria-label': 'Context die wordt meegestuurd',
    });
    this.attachEl = h('div', { class: 'ai-attachments' });
    this.errorsEl = h('div', { class: 'ai-attach-errors', role: 'alert' });
    this.popoverEl = h('div', { class: 'ai-popover-host' });
    this.el = h(
      'div',
      { class: 'ai-composer' },
      this.popoverEl,
      this.warningEl,
      this.chipsEl,
      this.attachEl,
      this.errorsEl,
      h('div', { class: 'ai-input-row' }, this.clip, this.input, this.sendBtn),
      h('p', { class: 'ai-footer' }, icon('lock', 12), h('span', {}, FOOTER_TEXT)),
    );
    document.addEventListener('mousedown', (e) => {
      if (this.popover && !this.el.contains(e.target as Node)) this.closePopover();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.popover) {
        e.stopPropagation();
        this.closePopover();
      }
    });
  }

  setChips(chips: Chips): void {
    this.chips = chips;
    this.render();
  }

  /** Clears input and attachments (another conversation). */
  reset(): void {
    this.input.value = '';
    this.starter = null;
    this.attachments = [];
    this.errors = [];
    this.render();
  }

  setBusy(busy: boolean, naam: string): void {
    this.busy = busy;
    this.busyNaam = naam;
    if (busy) this.closePopover();
    this.render();
  }

  /** A starter fills the input (decision 57: it does not send). */
  fill(text: string, starter: Starter | null, select?: string): void {
    this.input.value = text;
    this.starter = starter;
    this.input.focus();
    const at = select ? text.indexOf(select) : -1;
    if (at >= 0) this.input.setSelectionRange(at, at + select!.length);
    else this.input.setSelectionRange(text.length, text.length);
    this.renderSend();
  }

  focus(): void {
    this.input.focus();
  }

  /** Files dropped on the panel. */
  async addFiles(files: FileList | File[]): Promise<void> {
    this.errors = [];
    for (const file of Array.from(files)) {
      await this.addBlob(file, file.name);
    }
    this.render();
  }

  private left(): number {
    return MAX_ATTACHMENTS - this.host.usedAttachments() - this.attachments.length;
  }

  /** Attachments still possible in this conversation (drop overlay). */
  remaining(): number {
    return Math.max(0, this.left());
  }

  private async addBlob(blob: Blob, name: string): Promise<void> {
    const why = attachmentError(name, blob.size);
    if (why) {
      this.errors.push(`${name} is niet toegevoegd: ${why}`);
      return;
    }
    if (this.left() <= 0) {
      this.errors.push(`${name} is niet toegevoegd: maximaal 10 bijlagen per gesprek.`);
      return;
    }
    try {
      this.attachments.push({ name, size: blob.size, dataBase64: await readBase64(blob) });
    } catch (err) {
      this.errors.push(`${name} is niet toegevoegd: ${(err as Error).message}`);
    }
  }

  private async pick(): Promise<void> {
    if (this.busy || this.left() <= 0) return;
    let picked;
    try {
      picked = await this.host.ai.pickAttachments();
    } catch (err) {
      this.errors = [`Kiezen mislukt: ${(err as Error).message}`];
      this.render();
      return;
    }
    this.errors = [];
    for (const p of picked) {
      const why = attachmentError(p.name, p.size);
      if (why) this.errors.push(`${p.name} is niet toegevoegd: ${why}`);
      else if (this.left() <= 0)
        this.errors.push(`${p.name} is niet toegevoegd: maximaal 10 bijlagen per gesprek.`);
      else this.attachments.push({ name: p.name, size: p.size, token: p.token });
    }
    this.render();
  }

  private onPaste(e: ClipboardEvent): void {
    const data = e.clipboardData;
    if (!data) return;
    const images = Array.from(data.files).filter((f) => f.type.startsWith('image/'));
    if (images.length) {
      e.preventDefault();
      this.errors = [];
      void (async () => {
        for (const img of images) {
          const ext = img.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
          await this.addBlob(img, `Schermafbeelding (geplakt).${ext}`);
        }
        this.render();
      })();
      return;
    }
    const text = data.getData('text/plain');
    if (text.length >= PASTE_TEXT_LIMIT) {
      e.preventDefault();
      this.errors = [];
      if (this.left() <= 0)
        this.errors.push('Geplakte tekst is niet toegevoegd: maximaal 10 bijlagen per gesprek.');
      else this.attachments.push({ name: 'Geplakte tekst', size: text.length, text });
      this.render();
    }
  }

  private submit(): void {
    const message = this.input.value.trim();
    if (this.busy || !message) return;
    const attachments = this.attachments;
    const starter = this.starter;
    const chips = this.chips;
    this.input.value = '';
    this.starter = null;
    this.attachments = [];
    this.errors = [];
    // Afbeeldingen is for one message only (decision 64).
    if (this.chips.images) {
      this.chips = { ...this.chips, images: false };
    }
    this.render();
    this.host.send(message, starter, attachments, chips);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private setChip(patch: Partial<Chips>): void {
    this.chips = { ...this.chips, ...patch };
    this.host.chipsChanged(this.chips);
    this.render();
  }

  private chip(
    label: string,
    on: boolean,
    tip: string,
    onclick: () => void,
    extra: Record<string, string> = {},
    amber = false,
  ): HTMLButtonElement {
    const mark: IconName = on ? 'check' : 'plus';
    return h(
      'button',
      {
        type: 'button',
        class: `ai-chip${on ? ' is-on' : ''}${amber && on ? ' is-amber' : ''}`,
        'aria-pressed': String(on),
        title: tip,
        disabled: this.busy,
        onclick,
        ...extra,
      },
      icon(mark, 12, 2.8),
      h('span', {}, label),
    );
  }

  private render(): void {
    if (!this.chips) return;
    const c = this.chips;
    this.warningEl.hidden = !c.images;
    this.warningEl.replaceChildren(icon('warn', 15), h('span', {}, IMAGES_WARNING));

    const chips: HTMLElement[] = CHIPS.map((d) =>
      this.chip(d.label, c[d.key], d.tip, () => this.setChip({ [d.key]: !c[d.key] })),
    );
    const syllabusOpen = this.popover === 'syllabus';
    chips.push(
      this.chip(
        `Syllabus: ${c.syllabus ? syllabusLabel(c.syllabus) : 'Geen'} ${syllabusOpen ? '▴' : '▾'}`,
        c.syllabus !== null,
        'Gekozen op vak en schoolsoort; klik ▾ voor een andere of Geen',
        () => this.togglePopover('syllabus'),
        { 'aria-haspopup': 'listbox', 'aria-expanded': String(syllabusOpen) },
      ),
    );
    const n = c.others.length;
    chips.push(
      this.chip(
        `Andere opdrachten${n ? ` (${n})` : ''} ${this.popover === 'others' ? '▴' : '▾'}`,
        n > 0,
        'Kies 1 tot 3 andere opdrachten als voorbeeld',
        () => this.togglePopover('others'),
        { 'aria-haspopup': 'dialog', 'aria-expanded': String(this.popover === 'others') },
      ),
    );
    chips.push(
      this.chip(
        IMAGES_CHIP.label,
        c.images,
        IMAGES_CHIP.tip,
        () => this.setChip({ images: !c.images }),
        {},
        true,
      ),
    );
    this.chipsEl.replaceChildren(...chips);
    this.chipsEl.classList.toggle('is-busy', this.busy);

    this.attachEl.replaceChildren(
      ...this.attachments.map((a, i) =>
        h(
          'span',
          { class: 'ai-attachment' },
          icon(a.text !== undefined ? 'file' : isImageName(a.name) ? 'image' : 'file', 13),
          h('span', { class: 'ai-attachment-name' }, a.name),
          h('span', { class: 'ai-attachment-size' }, formatSize(a.size)),
          h(
            'button',
            {
              type: 'button',
              class: 'ai-attachment-remove',
              'aria-label': `${a.name} verwijderen`,
              disabled: this.busy,
              onclick: () => {
                this.attachments.splice(i, 1);
                this.render();
              },
            },
            icon('x', 12),
          ),
        ),
      ),
    );
    this.attachEl.hidden = this.attachments.length === 0;

    const full = this.left() <= 0;
    const errors = [...this.errors];
    if (full)
      errors.push(
        'Limiet bereikt: 10 van 10 bijlagen in dit gesprek. Verwijder er een of begin een nieuw gesprek.',
      );
    this.errorsEl.replaceChildren(...errors.map((e) => h('div', {}, e)));
    this.errorsEl.hidden = errors.length === 0;
    this.clip.disabled = this.busy || full;

    this.input.disabled = this.busy;
    this.input.placeholder = this.busy
      ? `Wacht tot ${this.busyNaam} klaar is, of stop hem`
      : PLACEHOLDER;
    this.renderSend();
    this.renderPopover();
  }

  private renderSend(): void {
    this.sendBtn.disabled = this.busy || !this.input.value.trim();
  }

  // ── Popovers (board 60) ───────────────────────────────────────────────────

  private togglePopover(which: 'syllabus' | 'others'): void {
    this.popover = this.popover === which ? null : which;
    this.othersFilter = '';
    this.render();
    this.popoverEl.querySelector<HTMLElement>('input, [role=option]')?.focus();
  }

  private closePopover(): void {
    if (!this.popover) return;
    this.popover = null;
    this.render();
  }

  private renderPopover(): void {
    if (this.popover === 'syllabus') this.popoverEl.replaceChildren(this.syllabusList());
    else if (this.popover === 'others') this.popoverEl.replaceChildren(this.othersDialog());
    else this.popoverEl.replaceChildren();
    this.popoverEl.hidden = this.popover === null;
  }

  private syllabusList(): HTMLElement {
    const { syllabus, info, preselected } = this.host;
    const option = (file: string | null) => {
      const selected = this.chips.syllabus === file;
      const sub =
        file === null
          ? 'Geen syllabus meesturen'
          : syllabusSubtitle(file, info.vakken, info.schoolsoort, preselected);
      return h(
        'div',
        {
          class: `ai-option${selected ? ' is-selected' : ''}${file === null ? ' is-none' : ''}`,
          role: 'option',
          tabindex: 0,
          'aria-selected': String(selected),
          onclick: () => {
            this.popover = null;
            this.setChip({ syllabus: file });
          },
          onkeydown: (e: Event) => {
            const k = (e as KeyboardEvent).key;
            if (k === 'Enter' || k === ' ') {
              e.preventDefault();
              (e.currentTarget as HTMLElement).click();
            }
          },
        },
        h('span', { class: 'ai-option-mark' }, selected ? '✓' : ''),
        h(
          'span',
          { class: 'ai-option-text' },
          h('span', { class: 'ai-option-name' }, file ?? 'Geen'),
          h('span', { class: 'ai-option-sub' }, sub),
        ),
      );
    };
    return h(
      'div',
      { class: 'ai-popover', role: 'listbox', 'aria-label': 'Syllabus' },
      h('div', { class: 'ai-popover-head' }, 'IN DE SYLLABUSMAP'),
      syllabus.files.length === 0
        ? h('div', { class: 'ai-popover-empty' }, 'Nog geen PDF’s in de syllabusmap.')
        : null,
      ...syllabus.files.map(option),
      option(null),
      h(
        'div',
        { class: 'ai-popover-foot' },
        h('span', { class: 'ai-mono ai-ellipsis', title: syllabus.folder }, syllabus.folder),
        h(
          'button',
          {
            type: 'button',
            class: 'ai-link',
            onclick: () => void this.host.ai.openSyllabusFolder().catch(() => {}),
          },
          'Map openen',
        ),
      ),
    );
  }

  private othersDialog(): HTMLElement {
    const chosen = this.chips.others;
    const atMax = chosen.length >= MAX_OTHERS;
    const q = this.othersFilter.toLowerCase();
    const rows = this.host.info.others
      .filter((o) => !q || o.naam.toLowerCase().includes(q))
      .map((o) => {
        const on = chosen.includes(o.id);
        const box = h('input', {
          type: 'checkbox',
          checked: on,
          disabled: !on && atMax,
          onchange: () => {
            const next = on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id];
            this.setChip({ others: next.slice(0, MAX_OTHERS) });
          },
        });
        return h(
          'label',
          { class: `ai-other${!on && atMax ? ' is-disabled' : ''}` },
          box,
          h(
            'span',
            { class: 'ai-option-text' },
            h('span', { class: 'ai-option-name ai-ellipsis' }, o.naam),
            h('span', { class: 'ai-option-sub' }, o.subtitle),
          ),
        );
      });
    const search = h('input', {
      type: 'search',
      class: 'ai-search',
      placeholder: 'Zoek een opdracht',
      'aria-label': 'Zoek een opdracht',
      value: this.othersFilter,
    });
    search.addEventListener('input', () => {
      this.othersFilter = search.value;
      const at = search.selectionStart;
      this.renderPopover();
      const again = this.popoverEl.querySelector<HTMLInputElement>('.ai-search');
      again?.focus();
      if (again && at !== null) again.setSelectionRange(at, at);
    });
    return h(
      'div',
      { class: 'ai-popover', role: 'dialog', 'aria-label': 'Andere opdrachten kiezen' },
      h('div', { class: 'ai-search-wrap' }, icon('search', 14), search),
      h(
        'div',
        { class: 'ai-others-list' },
        ...(rows.length ? rows : [h('div', { class: 'ai-popover-empty' }, 'Geen opdrachten')]),
      ),
      h(
        'div',
        { class: 'ai-popover-foot' },
        h(
          'span',
          {},
          `${chosen.length} van max. ${MAX_OTHERS} gekozen${atMax ? ' · meer kan niet' : ''}`,
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'ai-btn ai-btn-primary ai-btn-sm',
            onclick: () => this.closePopover(),
          },
          'Klaar',
        ),
      ),
    );
  }

  /** The bridge's attachments of a message. */
  static requests(list: PendingAttachment[]): AiAttachmentRequest[] {
    return list.map((a) => ({
      name: a.text !== undefined && !extOf(a.name) ? `${a.name}.txt` : a.name,
      ...(a.token ? { token: a.token } : {}),
      ...(a.text !== undefined ? { text: a.text } : {}),
      ...(a.dataBase64 ? { dataBase64: a.dataBase64 } : {}),
    }));
  }
}
