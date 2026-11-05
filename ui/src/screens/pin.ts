// SPDX-License-Identifier: AGPL-3.0-or-later

// PIN login (Step 7b): the dialogs on the login screen (first PIN, login, the
// admin's "Pincode vergeten" with a recovery code), the recovery codes shown
// once, and the account modal behind the top-bar badge (PIN wijzigen, nieuwe
// herstelcodes, uitloggen). PINs are checked in Rust (maatwerk-core::auth); the
// UI only shows the outcome. The PIN guards the shared PC, not the files.

import {
  closeModal,
  escHtml,
  guardModalClose as guardModalCloseJs,
  openModal as openModalJs,
  toast,
} from '../app.js';
import type { MaatwerkApi, PinCheck } from '../bridge/api';
import { setBusy } from '../components/button';
import { READ_ONLY_SAVE_TEXT, isReadOnlyError } from '../services/read-only';
import type { Dialog, DialogOptions } from '../components/dialog';
import {
  fullUserName,
  newPinProblem,
  pinCheckMessage,
  recoveryCodesText,
  type PinUser,
} from '../domain/accounts';

// app.js is untyped.
const openModal = openModalJs as (opts: DialogOptions) => Dialog;
const guardModalClose = guardModalCloseJs as (
  isDirty: () => boolean,
  text?: { message: string; title: string; okLabel: string } | null,
) => void;

type Api = Pick<
  MaatwerkApi,
  | 'verifyPin'
  | 'setFirstPin'
  | 'changePin'
  | 'recoverWithCode'
  | 'renewRecoveryCodes'
  | 'saveTextAs'
  | 'logout'
>;

function errorBox(content: HTMLElement): HTMLElement {
  return content.querySelector('.pin-error') as HTMLElement;
}

function pinInput(id: string, label: string, autofocus = false): string {
  return `
    <div class="form-group">
      <label for="${id}">${label}</label>
      <input id="${id}" class="pin-input" type="password" inputmode="numeric" maxlength="8"
             autocomplete="off"${autofocus ? ' autofocus' : ''} />
    </div>`;
}

function value(content: HTMLElement, id: string): string {
  return (content.querySelector(`#${id}`) as HTMLInputElement).value.trim();
}

/**
 * Disables `button` until a wait is over, counting down in the error box.
 * Returns at once when there is nothing to wait for.
 */
function holdOff(button: HTMLButtonElement, box: HTMLElement, check: PinCheck, what: string) {
  box.textContent = pinCheckMessage(check, what);
  if (check.retryAfterMs <= 0) return;
  button.disabled = true;
  button.dataset.holding = '1';
  const until = Date.now() + check.retryAfterMs;
  const tick = () => {
    if (!button.isConnected) return;
    const left = until - Date.now();
    if (left <= 0) {
      delete button.dataset.holding;
      button.disabled = false;
      box.textContent = '';
      return;
    }
    box.textContent = pinCheckMessage({ ...check, retryAfterMs: left }, what);
    setTimeout(tick, Math.min(left, 1000));
  };
  setTimeout(tick, Math.min(check.retryAfterMs, 1000));
}

/** Runs `submit` on the button and on Enter in any input; errors go to the box. */
/** The Dutch text for a failed PIN action (the backend's messages are Dutch, except read-only). */
function errorMessage(e: unknown): string {
  if (isReadOnlyError(e)) return READ_ONLY_SAVE_TEXT;
  return e instanceof Error ? e.message : String(e);
}

function onSubmit(content: HTMLElement, button: HTMLButtonElement, submit: () => Promise<void>) {
  const run = async () => {
    if (button.disabled) return;
    setBusy(button, true);
    try {
      await submit();
    } catch (e) {
      errorBox(content).textContent = errorMessage(e);
    } finally {
      if (button.isConnected) {
        setBusy(button, false);
        // holdOff keeps it disabled while the wait runs.
        if (button.dataset.holding) button.disabled = true;
      }
    }
  };
  button.addEventListener('click', run);
  content.querySelectorAll('input').forEach((input) =>
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void run();
      }
    }),
  );
  (content.querySelector('input[autofocus]') as HTMLInputElement | null)?.focus();
}

/**
 * Opens a modal and resolves with what `body` passes to `finish`, or null
 * when the modal is closed otherwise (Annuleren, Escape, the cross).
 */
interface PinModal {
  title: string;
  /** e.g. the role ("Sectievoorzitter Natuurkunde"). */
  subtitle?: string;
  body: string;
  footer: string;
}

function modal<T>(
  spec: PinModal,
  body: (content: HTMLElement, finish: (result: T) => void) => void,
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    openModal({
      title: spec.title,
      key: 'pin',
      subtitle: spec.subtitle,
      size: 'sm',
      body: spec.body,
      footerHtml: spec.footer,
      onShow: (content: HTMLElement) =>
        body(content, (result) => {
          settled = true;
          resolve(result);
          closeModal();
        }),
      onClose: () => {
        if (!settled) resolve(null);
      },
    });
  });
}

const ACTIONS_CANCEL = `<button class="btn btn--secondary" data-close-modal="1">Annuleren</button>`;

/** First login: the user chooses a PIN. Resolves with the check (user written, codes). */
function setFirstPinDialog(user: PinUser, api: Api, roleLabel: string): Promise<PinCheck | null> {
  const spec = {
    title: `Welkom, ${user.voornaam}`,
    subtitle: roleLabel,
    body: `
    <p>Kies een pincode van 4 tot 8 cijfers. Daarmee log je voortaan in.</p>
    ${pinInput('pin-new', 'Nieuwe pincode', true)}
    ${pinInput('pin-repeat', 'Herhaal de pincode')}
    <p class="pin-error" role="alert"></p>`,
    footer: `<button class="btn btn--primary" id="pin-ok">Pincode instellen</button>${ACTIONS_CANCEL}`,
  };
  return modal<PinCheck>(spec, (content, finish) => {
    const ok = content.querySelector('#pin-ok') as HTMLButtonElement;
    onSubmit(content, ok, async () => {
      const pin = value(content, 'pin-new');
      const problem = newPinProblem(pin, value(content, 'pin-repeat'));
      if (problem) {
        errorBox(content).textContent = problem;
        return;
      }
      finish(await api.setFirstPin(user.id, pin));
    });
  });
}

/** "Pincode vergeten?" for the admin: a recovery code and a new PIN. */
function recoverDialog(user: PinUser, api: Api): Promise<PinCheck | null> {
  const spec = {
    title: 'Pincode vergeten',
    body: `
    <p>Vul een van je herstelcodes in en kies een nieuwe pincode. De code werkt daarna niet meer.</p>
    <div class="form-group">
      <label for="pin-code">Herstelcode</label>
      <input id="pin-code" class="pin-code-input" type="text" autocomplete="off" maxlength="12"
             placeholder="ABCD-EFGH" autofocus />
    </div>
    ${pinInput('pin-new', 'Nieuwe pincode')}
    ${pinInput('pin-repeat', 'Herhaal de pincode')}
    <p class="pin-error" role="alert"></p>
    <p class="hint">Geen codes meer? Zie "Pincode beheerder kwijt" in het draaiboek.</p>`,
    footer: `<button class="btn btn--primary" id="pin-ok">Inloggen</button>${ACTIONS_CANCEL}`,
  };
  return modal<PinCheck>(spec, (content, finish) => {
    const ok = content.querySelector('#pin-ok') as HTMLButtonElement;
    onSubmit(content, ok, async () => {
      const pin = value(content, 'pin-new');
      const problem = newPinProblem(pin, value(content, 'pin-repeat'));
      if (problem) {
        errorBox(content).textContent = problem;
        return;
      }
      const check = await api.recoverWithCode(user.id, value(content, 'pin-code'), pin);
      if (check.outcome === 'ok') finish(check);
      else holdOff(ok, errorBox(content), check, 'herstelcode');
    });
  });
}

type LoginResult = { check: PinCheck } | { forgot: true };

function loginDialog(user: PinUser, api: Api, roleLabel: string): Promise<LoginResult | null> {
  // The admin's "Pincode vergeten?" is a navigational action: footer, left.
  const forgot = user.isAdmin
    ? `<button type="button" class="btn btn--text" id="pin-forgot" data-align="start">Pincode vergeten?</button>`
    : '';
  const hint = user.isAdmin
    ? ''
    : '<p class="hint">Pincode vergeten? Vraag de beheerder om je pincode te resetten.</p>';
  const spec = {
    title: fullUserName(user),
    subtitle: roleLabel,
    body: `
    ${pinInput('pin-input', 'Pincode', true)}
    <p class="pin-error" role="alert"></p>
    ${hint}`,
    footer: `${forgot}<button class="btn btn--primary" id="pin-ok">Inloggen</button>${ACTIONS_CANCEL}`,
  };
  return modal<LoginResult>(spec, (content, finish) => {
    const ok = content.querySelector('#pin-ok') as HTMLButtonElement;
    content.querySelector('#pin-forgot')?.addEventListener('click', () => finish({ forgot: true }));
    onSubmit(content, ok, async () => {
      const input = content.querySelector('#pin-input') as HTMLInputElement;
      const check = await api.verifyPin(user.id, input.value.trim());
      if (check.outcome === 'ok' || check.outcome === 'noPin') {
        finish({ check });
        return;
      }
      input.value = '';
      input.focus();
      holdOff(ok, errorBox(content), check, 'pincode');
    });
  });
}

/** Shows new recovery codes once; resolves when the admin confirms they are kept. */
export function showRecoveryCodes(user: PinUser, codes: string[], api: Api): Promise<void> {
  const text = recoveryCodesText(user, codes, new Date());
  const body = `
    <p>Met deze codes kom je erin als je je pincode vergeten bent. Elke code werkt één keer.
       <strong>Ze worden maar één keer getoond.</strong> Druk ze af of sla ze op, en bewaar ze
       op een veilige plek (niet in de gedeelde map).</p>
    <ol class="recovery-codes">${codes.map((c) => `<li><code>${escHtml(c)}</code></li>`).join('')}</ol>
    <div class="form-actions">
      <button class="btn btn--secondary" id="codes-print">Afdrukken</button>
      <button class="btn btn--secondary" id="codes-save">Opslaan als…</button>
    </div>
    <label class="checkbox-row"><input type="checkbox" id="codes-kept" /> Ik heb de codes bewaard</label>`;
  return new Promise((resolve) => {
    openModal({
      title: 'Herstelcodes',
      key: 'recovery-codes',
      size: 'sm',
      body,
      footerHtml: '<button class="btn btn--primary" id="codes-done" disabled>Verder</button>',
      onShow: (content: HTMLElement) => {
        const done = content.querySelector('#codes-done') as HTMLButtonElement;
        const kept = content.querySelector('#codes-kept') as HTMLInputElement;
        kept.addEventListener('change', () => (done.disabled = !kept.checked));
        // The codes are shown only once (review 7b m4).
        guardModalClose(() => !kept.checked, {
          message: 'De herstelcodes worden maar één keer getoond. Toch sluiten?',
          title: 'Herstelcodes bewaard?',
          okLabel: 'Sluiten',
        });
        content.querySelector('#codes-print')!.addEventListener('click', () => printText(text));
        content.querySelector('#codes-save')!.addEventListener('click', async () => {
          try {
            const path = await api.saveTextAs('Maatwerk herstelcodes.txt', text);
            if (path) toast(`Opgeslagen: ${path}`, 'success');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        });
        done.addEventListener('click', () => closeModal());
      },
      onClose: () => resolve(),
    });
  });
}

/** Prints `text` alone (the rest of the page is hidden while printing). */
function printText(text: string): void {
  const sheet = document.createElement('pre');
  sheet.id = 'print-sheet';
  sheet.textContent = text;
  document.body.append(sheet);
  document.body.classList.add('printing-sheet');
  try {
    window.print();
  } finally {
    document.body.classList.remove('printing-sheet');
    sheet.remove();
  }
}

/**
 * The login after a badge click: the PIN, or a new one at the first login.
 * Resolves with the user record to log in with (fresh from the backend when it
 * changed), or null when cancelled. `roleLabel`: e.g. "Sectievoorzitter Natuurkunde".
 */
export async function pinLogin<U extends PinUser>(
  user: U,
  api: Api,
  roleLabel = '',
): Promise<U | null> {
  let hasPin = Boolean(user.pinHash);
  for (;;) {
    if (!hasPin) {
      let check: PinCheck | null;
      try {
        check = await setFirstPinDialog(user, api, roleLabel);
      } catch (e) {
        toast(errorMessage(e), 'error');
        // Set on another PC meanwhile: log in with that PIN instead. Other errors end here.
        if (String((e as Error)?.message).includes('al een pincode')) {
          hasPin = true;
          continue;
        }
        return null;
      }
      if (!check) return null;
      const fresh = (check.user ?? user) as U;
      if (check.recoveryCodes) await showRecoveryCodes(fresh, check.recoveryCodes, api);
      return fresh;
    }
    const result = await loginDialog(user, api, roleLabel);
    if (!result) return null;
    if ('forgot' in result) {
      const check = await recoverDialog(user, api);
      if (check) {
        toast('Nieuwe pincode ingesteld.', 'success');
        return (check.user ?? user) as U;
      }
      continue;
    }
    if (result.check.outcome === 'noPin') {
      // Reset by the admin meanwhile.
      hasPin = false;
      continue;
    }
    return user;
  }
}

function changePinDialog(api: Api): Promise<PinCheck | null> {
  const spec = {
    title: 'Pincode wijzigen',
    body: `
    ${pinInput('pin-current', 'Huidige pincode', true)}
    ${pinInput('pin-new', 'Nieuwe pincode')}
    ${pinInput('pin-repeat', 'Herhaal de nieuwe pincode')}
    <p class="pin-error" role="alert"></p>`,
    footer: `<button class="btn btn--primary" id="pin-ok">Wijzigen</button>${ACTIONS_CANCEL}`,
  };
  return modal<PinCheck>(spec, (content, finish) => {
    const ok = content.querySelector('#pin-ok') as HTMLButtonElement;
    onSubmit(content, ok, async () => {
      const pin = value(content, 'pin-new');
      const problem = newPinProblem(pin, value(content, 'pin-repeat'));
      if (problem) {
        errorBox(content).textContent = problem;
        return;
      }
      const check = await api.changePin(value(content, 'pin-current'), pin);
      if (check.outcome === 'ok') finish(check);
      else holdOff(ok, errorBox(content), check, 'pincode');
    });
  });
}

function renewCodesDialog(api: Api): Promise<PinCheck | null> {
  const spec = {
    title: 'Nieuwe herstelcodes',
    body: `
    <p>Je krijgt tien nieuwe codes; de oude werken daarna niet meer.</p>
    ${pinInput('pin-current', 'Pincode', true)}
    <p class="pin-error" role="alert"></p>`,
    footer: `<button class="btn btn--primary" id="pin-ok">Nieuwe codes maken</button>${ACTIONS_CANCEL}`,
  };
  return modal<PinCheck>(spec, (content, finish) => {
    const ok = content.querySelector('#pin-ok') as HTMLButtonElement;
    onSubmit(content, ok, async () => {
      const check = await api.renewRecoveryCodes(value(content, 'pin-current'));
      if (check.outcome === 'ok') finish(check);
      else holdOff(ok, errorBox(content), check, 'pincode');
    });
  });
}

/**
 * The account modal behind the top-bar badge. `onUserChanged` gets the record
 * as written after a PIN change; `onLogout` runs after "Uitloggen".
 */
/** "Pincode wijzigen" in the user menu (F-17). */
export async function changePinFlow(
  api: Api,
  onUserChanged: (user: unknown) => void,
): Promise<void> {
  const check = await changePinDialog(api);
  if (check?.user) {
    onUserChanged(check.user);
    toast('Pincode gewijzigd.', 'success');
  }
}

/** "Nieuwe herstelcodes" in the admin's user menu. */
export async function renewCodesFlow(
  user: PinUser,
  api: Api,
  onUserChanged: (user: unknown) => void,
): Promise<void> {
  const check = await renewCodesDialog(api);
  if (check?.user) onUserChanged(check.user);
  if (check?.recoveryCodes) await showRecoveryCodes(user, check.recoveryCodes, api);
}
