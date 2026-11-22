// SPDX-License-Identifier: AGPL-3.0-or-later

// "Kopieer naar…" (step 36, PLAN-2 decision 82): a gast copies an opdracht to another sectie.
// Pick the sectie, then yourself as a teacher there, then your PIN; the backend checks the PIN
// (throttled like a login) and writes the copy under that teacher's name. The copy's vak is the
// target; the linked observaties (of this vak) stay behind, and the dialog says so.

import { closeModal, openModal, toast } from '../app.js';
import { setBusy } from '../components/button';
import { esc } from '../components/dialog';
import type { Opdracht } from '../domain/types';
import { errorMessage, holdOff } from '../screens/pin';
import { Store } from '../store.js';

interface TeacherLike {
  id: string;
  actief?: boolean;
  isAdmin?: boolean;
  vakken?: string[];
  [key: string]: unknown;
}

/** The active teachers of `vak` (not the admin), by name. */
export function teachersOf(users: readonly TeacherLike[], vak: string): TeacherLike[] {
  return users
    .filter((u) => u.actief !== false && !u.isAdmin && (u.vakken ?? []).includes(vak))
    .sort((a, b) => (Store.fullName(a) as string).localeCompare(Store.fullName(b) as string, 'nl'));
}

export async function openKopieerNaar(opdracht: Opdracht): Promise<void> {
  const users = (await Store.loadUsers()) as TeacherLike[];
  const display = Store.SUBJECT_DISPLAY as Record<string, string>;
  const own = Store.getActiveSubject() as string;
  const secties = Object.keys(display).filter((v) => v !== own && teachersOf(users, v).length > 0);
  const linked = (opdracht.observaties ?? []).length;
  const note = linked
    ? `<p class="hint">De ${linked === 1 ? 'gekoppelde observatie gaat' : `${linked} gekoppelde observaties gaan`} niet mee: die horen bij ${esc(display[own] ?? own)}.</p>`
    : '';
  openModal({
    title: 'Kopieer naar…',
    key: 'kopieer-naar',
    size: 'md',
    subtitle: opdracht.naam ?? '',
    body: secties.length
      ? `<div class="form-group">
          <label class="form-label" for="kn-vak">Sectie</label>
          <select id="kn-vak" class="input">
            <option value="">Kies een sectie</option>
            ${secties.map((v) => `<option value="${esc(v)}">${esc(display[v] ?? v)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="kn-docent">Docent (jij)</label>
          <select id="kn-docent" class="input" disabled><option value="">Kies eerst een sectie</option></select>
        </div>
        <div class="form-group">
          <label class="form-label" for="kn-pin">Je pincode</label>
          <input id="kn-pin" class="input pin-input" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password" disabled />
        </div>
        ${note}
        <p class="pin-error" role="alert"></p>`
      : '<p class="hint">Er is geen andere sectie met docenten.</p>',
    footerHtml: `
      <button class="btn btn--primary" id="kn-ok" disabled>Kopiëren</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>`,
    onShow: (content: HTMLElement) => {
      const root = content.closest('.dlg') ?? content;
      const vak = root.querySelector<HTMLSelectElement>('#kn-vak');
      const docent = root.querySelector<HTMLSelectElement>('#kn-docent');
      const pin = root.querySelector<HTMLInputElement>('#kn-pin');
      const ok = root.querySelector<HTMLButtonElement>('#kn-ok')!;
      const box = root.querySelector<HTMLElement>('.pin-error');
      if (!vak || !docent || !pin || !box) return;
      const ready = () => {
        if (!ok.dataset.holding) ok.disabled = !(vak.value && docent.value && pin.value.trim());
      };
      vak.addEventListener('change', () => {
        const list = vak.value ? teachersOf(users, vak.value) : [];
        docent.innerHTML = list.length
          ? `<option value="">Kies jezelf</option>${list
              .map(
                (u) => `<option value="${esc(u.id)}">${esc(Store.fullName(u) as string)}</option>`,
              )
              .join('')}`
          : '<option value="">Kies eerst een sectie</option>';
        docent.disabled = !list.length;
        pin.disabled = true;
        pin.value = '';
        box.textContent = '';
        ready();
      });
      docent.addEventListener('change', () => {
        pin.disabled = !docent.value;
        box.textContent = '';
        if (docent.value) pin.focus();
        ready();
      });
      pin.addEventListener('input', ready);
      const submit = async () => {
        if (ok.disabled) return;
        box.textContent = '';
        setBusy(ok, true);
        try {
          const done = await window.maatwerk.copyOpdrachtToSectie(
            opdracht.id,
            vak.value,
            docent.value,
            pin.value.trim(),
          );
          if (done.outcome !== 'ok' || !done.opdracht) {
            pin.value = '';
            pin.focus();
            holdOff(ok, box, { ...done, user: null, recoveryCodes: null }, 'pincode');
            return;
          }
          closeModal();
          const teacher = users.find((u) => u.id === docent.value);
          toast(
            `Gekopieerd naar ${display[vak.value] ?? vak.value}, op naam van ${teacher ? (Store.fullName(teacher) as string) : docent.value}.`,
            'success',
          );
        } catch (e) {
          box.textContent = errorMessage(e);
        } finally {
          if (ok.isConnected) {
            setBusy(ok, false);
            if (ok.dataset.holding) ok.disabled = true;
            else ready();
          }
        }
      };
      ok.addEventListener('click', () => void submit());
      pin.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void submit();
        }
      });
      vak.focus();
    },
  });
}
