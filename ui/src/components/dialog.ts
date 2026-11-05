// SPDX-License-Identifier: AGPL-3.0-or-later

// The one dialog component (R-02, design spec 3.3): every modal, confirm and
// alert opens through openDialog().
//
// - Fixed top (64 px), horizontally centred, never vertically centred. Max
//   height calc(100vh - 96px); `fixedHeight` pins it there so tabs or lazy
//   content never change the size (V-08, V-09).
// - Sticky header (title, badge, subtitle, close button, tabs); only the body
//   scrolls; optional footer with the button rule (right-aligned, primary
//   last, a navigational action left) (V-10).
// - Dialogs stack: each has its own backdrop, close guard, cleanup list and
//   onClose. Escape, the close button and a click that starts and ends on the
//   backdrop ask the top dialog to close; its guard may refuse (U14, U15).
// - Cleanup on close: registered functions, then every CustomSelect inside
//   (U12).

import { setBusy } from './button';

export type DialogSize = 'sm' | 'md' | 'form' | 'lg' | 'xl' | 'full';

export interface DialogTab {
  id: string;
  label: string;
  disabled?: boolean;
  /** Tooltip (e.g. why the tab is disabled). */
  title?: string;
}

export interface DialogButton {
  label: string;
  /** primary (one per footer), secondary (default), text, danger. */
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  /** Navigational actions go left; everything else right, in the given order. */
  align?: 'start' | 'end';
  /** Data attribute value for tests and lookups: `data-action="<id>"`. */
  id?: string;
  /**
   * Click handler. Returning a promise shows the busy state until it settles.
   * `'close'` closes the dialog unguarded (like Annuleren); `'request-close'`
   * goes through the close guard.
   */
  onClick?: ((dialog: Dialog) => unknown) | 'close' | 'request-close';
}

export interface CloseGuardText {
  message: string;
  title?: string;
  okLabel?: string;
}

export interface DialogOptions {
  title?: string;
  /** Short text pill after the title (e.g. the school type). */
  badge?: string;
  subtitle?: string;
  /** Extra classes on the dialog element (legacy size classes, area styling). */
  className?: string;
  size?: DialogSize;
  /** Always at the maximum height (tabs, lazy content). */
  fixedHeight?: boolean;
  tabs?: DialogTab[];
  activeTab?: string;
  onTab?: (id: string, dialog: Dialog) => void;
  /** Body content: HTML (the caller escapes every text in it) or a node. */
  body?: string | Node;
  footer?: DialogButton[];
  /**
   * Footer as button markup (the caller escapes every text in it): the
   * buttons keep their ids and listeners and are arranged by the button rule.
   * Mark a navigational action with `data-align="start"`.
   */
  footerHtml?: string;
  /** Called with the dialog element (header, body and footer) right after opening. */
  onShow?: (root: HTMLElement, dialog: Dialog) => void;
  /** alertdialog for confirms and notices. */
  role?: 'dialog' | 'alertdialog';
  /** false: no close button (confirms). */
  closeButton?: boolean;
  /** false: a backdrop click does nothing. */
  backdropCloses?: boolean;
  /** false: only its own buttons close it (no Escape, backdrop or ✕), e.g. the reload notice. */
  dismissible?: boolean;
  /** Called once after the dialog has closed (also when replaced). */
  onClose?: () => void;
  /** Id for the dialog element. */
  dialogId?: string;
  /** Extra classes on the body (e.g. `dlg-body--tinted`). */
  bodyClass?: string;
  /**
   * Modals with the same key replace each other instead of stacking (a
   * refresh, a next step). Used by app.js openModal.
   */
  key?: string;
}

const CLOSE_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const DEFAULT_GUARD: Required<CloseGuardText> = {
  message: 'Weet je zeker dat je dit scherm wilt sluiten? Er zijn onopgeslagen wijzigingen.',
  title: 'Onopgeslagen wijzigingen',
  okLabel: 'Sluiten zonder opslaan',
};

let stack: Dialog[] = [];
let seq = 0;

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Destroyable {
  destroy(): void;
}

export class Dialog {
  readonly backdrop: HTMLDivElement;
  readonly el: HTMLElement;
  readonly header: HTMLElement | null;
  readonly body: HTMLDivElement;
  readonly footer: HTMLElement;
  /** Changes on every open/close, for async work that must not outlive the dialog. */
  readonly session: number;

  private guard: (() => boolean) | null = null;
  private guardText: CloseGuardText | null = null;
  private cleanups: (() => void)[] = [];
  private onCloseCb: (() => void) | null;
  private closed = false;
  private asking = false;
  private prevFocus: Element | null;
  private readonly opts: DialogOptions;

  constructor(opts: DialogOptions) {
    this.opts = opts;
    this.session = ++seq;
    this.onCloseCb = opts.onClose ?? null;
    this.prevFocus = document.activeElement;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'dlg-backdrop';

    const el = document.createElement('section');
    el.className = ['dlg', `dlg--${opts.size ?? 'md'}`, opts.className ?? '']
      .filter(Boolean)
      .join(' ');
    if (opts.fixedHeight) el.classList.add('dlg--fixed');
    if (opts.dialogId) el.id = opts.dialogId;
    el.setAttribute('role', opts.role ?? 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.tabIndex = -1;
    this.el = el;

    const titleId = `dlg-title-${this.session}`;
    const hasHeader = !!(opts.title || opts.tabs?.length);
    if (hasHeader) {
      const header = document.createElement('header');
      header.className = 'dlg-header';
      header.innerHTML = `
        <div class="dlg-head-row">
          <div class="dlg-head-text">
            <div class="dlg-title-row">
              <h2 class="dlg-title" id="${titleId}">${esc(opts.title)}</h2>
              ${opts.badge ? `<span class="dlg-badge">${esc(opts.badge)}</span>` : ''}
            </div>
            ${opts.subtitle ? `<p class="dlg-subtitle">${esc(opts.subtitle)}</p>` : ''}
          </div>
        </div>
        ${
          opts.tabs?.length
            ? `<nav class="dlg-tabs" role="tablist">${opts.tabs
                .map(
                  (t) =>
                    `<button type="button" role="tab" class="dlg-tab" data-tab="${esc(t.id)}" aria-selected="false"${t.disabled ? ' disabled' : ''}${t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.label)}</button>`,
                )
                .join('')}</nav>`
            : ''
        }`;
      el.setAttribute('aria-labelledby', titleId);
      el.append(header);
      this.header = header;
    } else {
      this.header = null;
    }

    if (opts.closeButton !== false) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'dlg-close';
      close.setAttribute('aria-label', 'Sluiten');
      close.title = 'Sluiten';
      close.innerHTML = CLOSE_ICON;
      close.addEventListener('click', () => void this.requestClose());
      // Without a header (no title) the button sits in the top-right corner.
      if (this.header) this.header.querySelector('.dlg-head-row')!.append(close);
      else {
        close.classList.add('dlg-close--float');
        el.append(close);
      }
    }

    this.body = document.createElement('div');
    this.body.className = ['dlg-body', opts.bodyClass ?? ''].filter(Boolean).join(' ');
    if (typeof opts.body === 'string') this.body.innerHTML = opts.body;
    else if (opts.body) this.body.append(opts.body);
    el.append(this.body);

    const footer = document.createElement('footer');
    footer.className = 'dlg-footer';
    this.footer = footer;
    el.append(footer);
    if (opts.footer?.length) {
      for (const b of opts.footer) {
        const btn = this.button(b);
        if (b.align === 'start') btn.dataset.align = 'start';
        footer.append(btn);
      }
      arrangeFooter(footer);
    } else {
      this.setFooterHtml(opts.footerHtml ?? '');
    }

    if (opts.tabs?.length) {
      const list = this.header!.querySelector<HTMLElement>('.dlg-tabs')!;
      list.addEventListener('click', (e) => {
        const tab = (e.target as Element).closest<HTMLElement>('[data-tab]');
        if (tab?.dataset.tab) this.selectTab(tab.dataset.tab);
      });
      // Keyboard (WAI-ARIA tabs): arrows move and select, Home/End go to the ends.
      list.addEventListener('keydown', (e) => {
        const tabs = [...list.querySelectorAll<HTMLButtonElement>('[data-tab]:not(:disabled)')];
        const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (i < 0) return;
        const next =
          e.key === 'ArrowRight'
            ? tabs[(i + 1) % tabs.length]
            : e.key === 'ArrowLeft'
              ? tabs[(i - 1 + tabs.length) % tabs.length]
              : e.key === 'Home'
                ? tabs[0]
                : e.key === 'End'
                  ? tabs[tabs.length - 1]
                  : null;
        if (!next) return;
        e.preventDefault();
        next.focus();
        if (next.dataset.tab) this.selectTab(next.dataset.tab);
      });
    }

    // Only a click that also started on the backdrop closes the dialog, so
    // selecting text in a field and releasing the mouse outside doesn't.
    let pressOnBackdrop = false;
    this.backdrop.addEventListener('mousedown', (e) => {
      pressOnBackdrop = e.target === this.backdrop;
    });
    this.backdrop.addEventListener('click', (e) => {
      const hit = e.target === this.backdrop && pressOnBackdrop;
      pressOnBackdrop = false;
      if (hit && opts.backdropCloses !== false) void this.requestClose();
    });
    // [data-close-modal] anywhere in the dialog: unguarded close (Annuleren).
    el.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-close-modal]')) this.close();
    });

    // Tab and Shift+Tab stay inside the dialog.
    this.backdrop.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !this.isTop) return;
      const focusable = [
        ...this.el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
      if (!focusable.length) {
        e.preventDefault();
        this.el.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !this.el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !this.el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    });

    this.backdrop.append(el);
  }

  private button(b: DialogButton): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn--${b.variant ?? 'secondary'}`;
    btn.textContent = b.label;
    if (b.id) btn.dataset.action = b.id;
    btn.addEventListener('click', async () => {
      if (b.onClick === 'close') return this.close();
      if (b.onClick === 'request-close') return void this.requestClose();
      const r = b.onClick?.(this);
      if (r instanceof Promise) {
        setBusy(btn, true);
        try {
          await r;
        } finally {
          if (btn.isConnected) setBusy(btn, false);
        }
      }
    });
    return btn;
  }

  /** Replace the footer buttons (multi-step dialogs); '' hides the footer. */
  setFooterHtml(html: string): void {
    this.footer.innerHTML = html;
    arrangeFooter(this.footer);
  }

  /** Shown in the DOM, on top of the stack. Called by openDialog. */
  mount(): void {
    stack.push(this);
    this.backdrop.style.zIndex = String(1000 + stack.length * 10);
    document.body.append(this.backdrop);
    if (this.opts.tabs?.length) {
      this.selectTab(this.opts.activeTab ?? this.opts.tabs[0]!.id);
    }
    // Focus leaves the button that opened the dialog (behind the backdrop), so
    // Enter or a second click cannot open another one (review 14 M2). A field
    // marked autofocus gets it; otherwise the dialog itself.
    const auto = this.el.querySelector<HTMLElement>('[autofocus]');
    (auto ?? this.el).focus({ preventScroll: true });
  }

  get key(): string | undefined {
    return this.opts.key;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  get isTop(): boolean {
    return stack[stack.length - 1] === this;
  }

  /** Activate a tab: underline, aria-selected, then onTab (unless `notify` is false). */
  selectTab(id: string, notify = true): void {
    this.header?.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) => {
      const on = t.dataset.tab === id;
      t.classList.toggle('dlg-tab--active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    this.el.dataset.tab = id;
    if (notify) this.opts.onTab?.(id, this);
  }

  get activeTab(): string | undefined {
    return this.el.dataset.tab;
  }

  /** While isDirty() is true, closing with ✕, Escape or the backdrop asks first. */
  setGuard(isDirty: (() => boolean) | null, text: CloseGuardText | null = null): void {
    this.guard = isDirty;
    this.guardText = text;
  }

  /** Run fn when this dialog closes (also when it is replaced). */
  onCleanup(fn: () => void): void {
    if (this.closed) fn();
    else this.cleanups.push(fn);
  }

  /** Close with the guard. Resolves true when the dialog closed. */
  async requestClose(): Promise<boolean> {
    if (this.closed || this.asking) return false;
    if (this.opts.dismissible === false) return false;
    if (!this.isTop) return false;
    if (this.guard?.()) {
      const t = { ...DEFAULT_GUARD, ...(this.guardText ?? {}) };
      this.asking = true;
      let ok: boolean;
      try {
        ok = await confirmDialog(t.message, { title: t.title, okLabel: t.okLabel, danger: true });
      } finally {
        this.asking = false;
      }
      if (!ok || this.closed) return false;
    }
    this.close();
    return true;
  }

  /** Close without the guard (after saving, Annuleren). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    stack = stack.filter((d) => d !== this);
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    this.el.querySelectorAll('.csel').forEach((host) => {
      (host as HTMLElement & { _csel?: Destroyable })._csel?.destroy();
    });
    this.backdrop.remove();
    const top = stack[stack.length - 1];
    const focus = this.prevFocus as HTMLElement | null;
    if (focus?.isConnected && (!top || top.el.contains(focus))) focus.focus();
    else top?.el.focus();
    const cb = this.onCloseCb;
    this.onCloseCb = null;
    cb?.();
  }
}

/**
 * The button rule (spec 3.1): navigational actions (`data-align="start"`)
 * left; the rest right-aligned with the primary action last. An empty footer
 * is hidden.
 */
function arrangeFooter(footer: HTMLElement): void {
  const btns = [...footer.querySelectorAll<HTMLElement>(':scope > button, :scope > a')];
  footer.querySelectorAll(':scope > .dlg-footer-spacer').forEach((x) => x.remove());
  const start = btns.filter((b) => b.dataset.align === 'start');
  const end = btns.filter((b) => b.dataset.align !== 'start');
  end.sort(
    (a, b) =>
      Number(a.classList.contains('btn--primary')) - Number(b.classList.contains('btn--primary')),
  );
  const spacer = document.createElement('span');
  spacer.className = 'dlg-footer-spacer';
  // Other children (a hint, a status text) stay between the groups.
  const rest = [...footer.children].filter((c) => !btns.includes(c as HTMLElement));
  footer.replaceChildren(...start, spacer, ...rest, ...end);
  footer.hidden = btns.length === 0 && rest.length === 0;
}

export function openDialog(opts: DialogOptions): Dialog {
  const d = new Dialog(opts);
  d.mount();
  opts.onShow?.(d.el, d);
  return d;
}

/** The dialog on top, or null. */
export function topDialog(): Dialog | null {
  return stack[stack.length - 1] ?? null;
}

export interface ConfirmOptions {
  title?: string;
  okLabel?: string;
  /** null: a notice with one button (alert). */
  cancelLabel?: string | null;
  danger?: boolean;
  /** Scrollable block under the message; the caller escapes every text in it. */
  detailsHtml?: string;
}

/**
 * In-app replacement for window.confirm() (never use the native one). Resolves
 * true for the confirm button, false for Annuleren, Escape or a backdrop click.
 */
export function confirmDialog(
  message: string,
  {
    title = '',
    okLabel = 'OK',
    cancelLabel = 'Annuleren',
    danger = false,
    detailsHtml = '',
  }: ConfirmOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const footer: DialogButton[] = [];
    if (cancelLabel !== null) {
      footer.push({ label: cancelLabel, variant: 'secondary', id: 'cancel', onClick: 'close' });
    }
    footer.push({
      label: okLabel,
      variant: danger ? 'danger' : 'primary',
      id: 'ok',
      onClick: (d) => {
        answer = true;
        d.close();
      },
    });
    const d = openDialog({
      role: 'alertdialog',
      size: 'sm',
      className: 'dlg--confirm',
      closeButton: false,
      body: `${title ? `<h2 class="dlg-confirm-title">${esc(title)}</h2>` : ''}
        <p class="dlg-confirm-msg">${esc(message)}</p>
        ${detailsHtml ? `<div class="app-dialog-details">${detailsHtml}</div>` : ''}`,
      footer,
      onClose: () => resolve(answer),
    });
    d.el.setAttribute('aria-describedby', `dlg-msg-${d.session}`);
    d.el.setAttribute('aria-label', title || okLabel);
    d.body.querySelector('.dlg-confirm-msg')!.id = `dlg-msg-${d.session}`;
    // Keys stay inside the dialog (the score grid listens on the document).
    d.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        d.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const btns = [...d.el.querySelectorAll<HTMLButtonElement>('button')];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length]?.focus();
      }
    });
    d.el.querySelector<HTMLButtonElement>('[data-action="ok"]')!.focus();
  });
}

/** A notice with one button. */
export function alertDialog(
  message: string,
  opts: Omit<ConfirmOptions, 'cancelLabel' | 'danger'> = {},
): Promise<void> {
  return confirmDialog(message, { ...opts, cancelLabel: null }).then(() => undefined);
}

// Escape asks the top dialog to close. On window in the bubble phase, so
// controls inside that use Escape themselves (an open CustomSelect, a menu, a
// cell editor) run first and mark it handled with preventDefault().
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const top = topDialog();
    if (!top) return;
    e.preventDefault();
    void top.requestClose();
  });
}
