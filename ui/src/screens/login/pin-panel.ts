// SPDX-License-Identifier: AGPL-3.0-or-later

// The PIN block next to the chosen avatar on the login screen (V-04, design
// spec 4.2 steps 3-4, board 5): the PIN, or two fields at the first login,
// "← Andere gebruiker" and "Inloggen". The PIN rules and their messages are
// unchanged (Step 7b; checked in Rust, maatwerk-core::auth). The admin's
// "Pincode vergeten?" and the recovery codes stay dialogs (screens/pin.ts).

import { escHtml, toast } from '../../app.js';
import type { PinCheck } from '../../bridge/api';
import { setBusy } from '../../components/button';
import { fullUserName, newPinProblem } from '../../domain/accounts';
import { roleLabel, type LoginRole, type LoginUser } from '../../domain/login';
import { errorMessage, holdOff, recoverDialog, showRecoveryCodes, type PinApi } from '../pin';

export interface PinPanelOptions {
  user: LoginUser;
  role: LoginRole;
  vakName: string;
  api: PinApi;
  /** "← Andere gebruiker" or Escape. */
  onBack: () => void;
  /** Starts the session with the user record (fresh from the backend when it changed). */
  onLoggedIn: (user: LoginUser) => Promise<void>;
}

const BACK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M19 12H5M11 6l-6 6 6 6"/></svg>`;

function pinField(id: string, label: string, autocomplete: string): string {
  return `
    <label class="login-pin-label" for="${id}">${label}</label>
    <input id="${id}" class="pin-input login-pin-input" type="password" inputmode="numeric"
           maxlength="8" autocomplete="${autocomplete}" />`;
}

function fieldsHtml(first: boolean, isAdmin: boolean): string {
  if (first) {
    return `
      <p class="login-pin-intro">Je logt voor het eerst in. Kies een pincode van 4 tot 8 cijfers.</p>
      <div class="login-pin-field">${pinField('pin-new', 'Nieuwe pincode', 'new-password')}</div>
      <div class="login-pin-field">${pinField('pin-repeat', 'Herhaal pincode', 'new-password')}</div>`;
  }
  const help = isAdmin
    ? `<button type="button" class="btn btn--text login-pin-forgot" id="pin-forgot">Pincode vergeten?</button>`
    : `<p class="login-pin-hint">Pincode vergeten? Vraag de beheerder om je pincode te resetten.</p>`;
  return `
    <div class="login-pin-field">${pinField('pin-input', 'Pincode', 'current-password')}</div>
    ${help}`;
}

/**
 * Fills `form` with the PIN block and wires it. Returns `focus`, called once
 * the block is in place (after the avatar's flight).
 */
export function mountPinPanel(form: HTMLFormElement, opts: PinPanelOptions): { focus: () => void } {
  const { user, api } = opts;
  let hasPin = Boolean(user.pinHash);

  form.noValidate = true;
  form.innerHTML = `
    <div class="login-pin-head">
      <h2 class="login-pin-name">${escHtml(fullUserName(user))}</h2>
      <span class="login-pin-role">${escHtml(roleLabel(opts.role))} · ${escHtml(opts.vakName)}</span>
    </div>
    <div class="login-pin-fields"></div>
    <div class="login-pin-actions">
      <button type="button" class="btn btn--text login-back" data-action="back">${BACK_ICON}Andere gebruiker</button>
      <button type="submit" class="btn btn--primary" id="pin-ok"></button>
    </div>
    <p class="pin-error" role="alert"></p>`;

  const fields = form.querySelector('.login-pin-fields') as HTMLElement;
  const ok = form.querySelector('#pin-ok') as HTMLButtonElement;
  const box = form.querySelector('.pin-error') as HTMLElement;
  const input = (id: string) => form.querySelector(`#${id}`) as HTMLInputElement | null;
  const val = (id: string) => input(id)?.value.trim() ?? '';

  function focus(): void {
    (input('pin-new') ?? input('pin-input'))?.focus({ preventScroll: true });
  }

  function showFields(): void {
    fields.innerHTML = fieldsHtml(!hasPin, Boolean(user.isAdmin));
    ok.textContent = hasPin ? 'Inloggen' : 'Pincode opslaan en inloggen';
    form.querySelector('#pin-forgot')?.addEventListener('click', () => void forgot());
  }

  async function forgot(): Promise<void> {
    const check = await recoverDialog(user, api);
    if (!check) {
      focus();
      return;
    }
    toast('Nieuwe pincode ingesteld.', 'success');
    await finish((check.user ?? user) as LoginUser);
  }

  async function finish(fresh: LoginUser): Promise<void> {
    setBusy(ok, true);
    await opts.onLoggedIn(fresh);
  }

  async function firstPin(): Promise<void> {
    const pin = val('pin-new');
    const problem = newPinProblem(pin, val('pin-repeat'));
    if (problem) {
      box.textContent = problem;
      return;
    }
    let check: PinCheck;
    try {
      check = await api.setFirstPin(user.id, pin);
    } catch (e) {
      // Set on another PC meanwhile: log in with that PIN instead.
      if (String((e as Error)?.message).includes('al een pincode')) {
        hasPin = true;
        showFields();
        focus();
      }
      throw e;
    }
    const fresh = (check.user ?? user) as LoginUser;
    if (check.recoveryCodes) await showRecoveryCodes(fresh, check.recoveryCodes, api);
    await finish(fresh);
  }

  async function knownPin(): Promise<void> {
    const pin = input('pin-input')!;
    const check = await api.verifyPin(user.id, pin.value.trim());
    if (check.outcome === 'ok') {
      await finish(user);
      return;
    }
    if (check.outcome === 'noPin') {
      // Reset by the admin meanwhile.
      hasPin = false;
      showFields();
      focus();
      return;
    }
    pin.value = '';
    pin.focus();
    holdOff(ok, box, check, 'pincode');
  }

  async function submit(): Promise<void> {
    if (ok.disabled) return;
    box.textContent = '';
    setBusy(ok, true);
    try {
      await (hasPin ? knownPin() : firstPin());
    } catch (e) {
      box.textContent = errorMessage(e);
    } finally {
      if (ok.isConnected) {
        setBusy(ok, false);
        // holdOff keeps it disabled while the wait runs.
        if (ok.dataset.holding) ok.disabled = true;
      }
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      opts.onBack();
    }
  });
  form.querySelector('[data-action="back"]')!.addEventListener('click', () => opts.onBack());
  showFields();
  return { focus };
}
