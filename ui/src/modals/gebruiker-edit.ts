// SPDX-License-Identifier: AGPL-3.0-or-later

// Gebruiker toevoegen / bewerken (admin; design spec 4.9, board 12):
// Voornaam / Tussenvoegsel / Achternaam; Afkorting + Kleur (12 swatches);
// Schoolsoort and Vakken chips; Profielfoto with the square crop (F-19,
// components/photo-crop.ts). The user id is made once, so the photo's name and
// the user file always match (D28).

import { closeModal, escHtml, openModal as openModalJs, toast } from '../app.js';
import { avatarInitials, forgetAvatarPhotos } from '../components/avatar';
import { setBusy } from '../components/button';
import type { Dialog, DialogOptions } from '../components/dialog';
import { mountPhotoCrop } from '../components/photo-crop';
import { SUBJECT_DISPLAY } from '../domain/rapport';
import { READ_ONLY_SAVE_TEXT, isReadOnlyError } from '../services/read-only';
import { Store } from '../store.js';
import { photoPathFor } from './foto-wijzigen';

const openModal = openModalJs as (opts: DialogOptions) => Dialog;

export interface EditableUser {
  id: string;
  voornaam: string;
  tussenvoegsel?: string;
  achternaam?: string;
  afkorting?: string | null;
  kleur?: string | null;
  foto?: string | null;
  schoolsoort?: string[];
  vakken?: string[];
  isAdmin?: boolean;
  actief?: boolean;
  pinHash?: string;
  _meta?: { rev?: number };
}

const SUBJECTS = ['bio', 'nat', 'schk', 'wi'];
const SCHOOLSOORTEN = ['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium'];

/** The ring colours of board 12, in order. */
export const RING_COLOURS = [
  '#2F6FD6',
  '#3DBE4A',
  '#E2C410',
  '#E07A1F',
  '#C93636',
  '#C2387A',
  '#8A3FC2',
  '#4F46C8',
  '#0F7F86',
  '#8B5A2B',
  '#4A5568',
  '#1B2230',
];

const RING_NAMES = [
  'Blauw',
  'Groen',
  'Geel',
  'Oranje',
  'Rood',
  'Roze',
  'Paars',
  'Indigo',
  'Turquoise',
  'Bruin',
  'Leisteen',
  'Zwart',
];

/** The swatches: the 12, plus the user's own colour first when it is none of them. */
export function ringChoices(current: string | null | undefined): { c: string; name: string }[] {
  const list = RING_COLOURS.map((c, i) => ({ c, name: RING_NAMES[i]! }));
  const own = (current ?? '').trim();
  if (own && !RING_COLOURS.some((c) => c.toLowerCase() === own.toLowerCase()))
    list.unshift({ c: own, name: 'Huidige kleur' });
  return list;
}

const save = Store.upsertUser as (user: EditableUser, baseRev?: number) => Promise<unknown>;

function chips(kind: 'ss' | 'vak', items: [string, string][], on: string[], off: string[] = []) {
  return items
    .map(([key, label]) => {
      const disabled = off.includes(key);
      return `<button type="button" class="tog-btn ${kind}-toggle${on.includes(key) ? ' selected' : ''}${disabled ? ' tog-btn-disabled' : ''}"
        data-${kind}="${escHtml(key)}" aria-pressed="${on.includes(key)}"${disabled ? ' disabled' : ''}>${escHtml(label)}</button>`;
    })
    .join('');
}

export async function openUserModal(
  user: EditableUser | null,
  onSaved: () => Promise<void>,
): Promise<void> {
  const isNew = !user;
  const isAdmin = user?.isAdmin === true;
  // D28: one id, used for the file and for the photo.
  const id = user?.id ?? `gebr-${Date.now()}`;
  const title = isNew
    ? 'Gebruiker toevoegen'
    : isAdmin
      ? 'Beheerder bewerken'
      : 'Gebruiker bewerken';
  const current = user?.foto
    ? await window.maatwerk.readPhotoAsDataUrl(user.foto).catch(() => null)
    : null;

  const schoolSS = (Store.getSchoolSync() as { schoolsoort?: string[] }).schoolsoort ?? [];
  const offSS = schoolSS.length ? SCHOOLSOORTEN.filter((s) => !schoolSS.includes(s)) : [];
  const rings = ringChoices(user?.kleur);
  let kleur = user?.kleur?.trim() || RING_COLOURS[0]!;

  const body = `
    <div class="form-row user-form-names">
      <div class="u-flex-2 form-group">
        <label for="f-uvoornaam">Voornaam</label>
        <input id="f-uvoornaam" type="text" value="${escHtml(user?.voornaam ?? '')}" />
      </div>
      <div class="u-flex-1 form-group">
        <label for="f-utussen">Tussenvoegsel</label>
        <input id="f-utussen" type="text" value="${escHtml(user?.tussenvoegsel ?? '')}" placeholder="van" />
      </div>
      <div class="u-flex-2 form-group">
        <label for="f-uachter">Achternaam</label>
        <input id="f-uachter" type="text" value="${escHtml(user?.achternaam ?? '')}" />
      </div>
    </div>
    <div class="form-row user-form-badge">
      <div class="form-group">
        <label for="f-uafkorting">Afkorting</label>
        <input id="f-uafkorting" type="text" maxlength="5" value="${escHtml(user?.afkorting ?? '')}" placeholder="bijv. JAN" class="u-uppercase user-form-afk" />
      </div>
      <div class="form-group u-flex-1">
        <span class="form-label" id="f-ukleur-label">Kleur</span>
        <div id="f-ukleur" class="ring-swatches" role="radiogroup" aria-labelledby="f-ukleur-label">
          ${rings
            .map(
              (r) =>
                `<button type="button" class="ring-swatch" role="radio" data-ring="${escHtml(r.c)}"
                   aria-label="${escHtml(r.name)}" title="${escHtml(r.name)}"></button>`,
            )
            .join('')}
        </div>
      </div>
    </div>
    <div class="form-group">
      <span class="form-label">Schoolsoort</span>
      <div class="vak-toggle-group">${chips(
        'ss',
        SCHOOLSOORTEN.map((s) => [s, s]),
        user?.schoolsoort ?? [],
        offSS,
      )}</div>
    </div>
    ${
      isAdmin
        ? ''
        : `<div class="form-group">
      <span class="form-label">Vakken</span>
      <div class="vak-toggle-group">${chips(
        'vak',
        SUBJECTS.map((s) => [s, (SUBJECT_DISPLAY as Record<string, string>)[s] ?? s]),
        user?.vakken ?? [],
      )}</div>
    </div>`
    }
    <div class="form-group">
      <span class="form-label">Profielfoto (optioneel)</span>
      <div class="user-form-photo"></div>
    </div>`;

  openModal({
    title,
    key: 'user-edit',
    size: 'form',
    body,
    footerHtml: `
      <button class="btn btn--primary" id="f-u-save">${isNew ? 'Toevoegen' : 'Opslaan'}</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>`,
    onShow: (content: HTMLElement) => {
      const val = (sel: string) => (content.querySelector(sel) as HTMLInputElement).value.trim();
      const crop = mountPhotoCrop(content.querySelector('.user-form-photo') as HTMLElement, {
        current,
        ring: kleur,
        initials: avatarInitials({ ...user, afkorting: user?.afkorting ?? '' }),
        onError: (m) => toast(m, 'error'),
      });

      // Ring swatches: one selected; arrows move along them (a radio group).
      const swatches = [...content.querySelectorAll<HTMLButtonElement>('.ring-swatch')];
      const pick = (b: HTMLButtonElement, focus = false) => {
        kleur = b.dataset.ring!;
        for (const s of swatches) {
          const on = s === b;
          s.setAttribute('aria-checked', String(on));
          s.tabIndex = on ? 0 : -1;
        }
        crop.setRing(kleur);
        if (focus) b.focus();
      };
      for (const b of swatches) {
        b.style.background = b.dataset.ring!;
        b.style.setProperty('--ring', b.dataset.ring!);
        b.addEventListener('click', () => pick(b));
        b.addEventListener('keydown', (e) => {
          const i = swatches.indexOf(b);
          const step =
            e.key === 'ArrowRight' || e.key === 'ArrowDown'
              ? 1
              : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                ? -1
                : 0;
          if (!step) return;
          e.preventDefault();
          pick(swatches[(i + step + swatches.length) % swatches.length]!, true);
        });
      }
      pick(
        swatches.find((s) => s.dataset.ring!.toLowerCase() === kleur.toLowerCase()) ?? swatches[0]!,
      );

      content.querySelectorAll<HTMLButtonElement>('.ss-toggle, .vak-toggle').forEach((btn) =>
        btn.addEventListener('click', () => {
          const on = btn.classList.toggle('selected');
          btn.setAttribute('aria-pressed', String(on));
        }),
      );

      const saveBtn = content.querySelector('#f-u-save') as HTMLButtonElement;
      saveBtn.addEventListener('click', async () => {
        const voornaam = val('#f-uvoornaam');
        if (!voornaam) {
          toast('Voornaam is verplicht.', 'error');
          return;
        }
        const selected = (sel: string, key: string) =>
          [...content.querySelectorAll<HTMLElement>(`${sel}.selected`)].map((b) => b.dataset[key]!);
        setBusy(saveBtn, true);
        let foto = user?.foto ?? null;
        const choice = crop.choice();
        try {
          if (choice.kind === 'new') {
            foto = photoPathFor(id);
            await window.maatwerk.savePhoto(foto, choice.base64);
          } else if (choice.kind === 'removed') {
            foto = null;
          }
        } catch (e) {
          // The reference awaited a promise that never settled here (review 6 m5).
          console.error('[gebruikers]', e);
          toast(isReadOnlyError(e) ? READ_ONLY_SAVE_TEXT : 'Foto opslaan mislukt.', 'error');
          setBusy(saveBtn, false);
          return;
        }
        // Fields this form does not show (pinHash, recoveryCodeHashes, preferences)
        // are kept from the record the form was opened with.
        const saved: EditableUser = {
          ...(user ?? {}),
          id,
          voornaam,
          tussenvoegsel: val('#f-utussen'),
          achternaam: val('#f-uachter'),
          afkorting: val('#f-uafkorting').toUpperCase() || voornaam.slice(0, 3).toUpperCase(),
          schoolsoort: selected('.ss-toggle', 'ss'),
          vakken: isAdmin ? (user?.vakken ?? SUBJECTS) : selected('.vak-toggle', 'vak'),
          kleur,
          foto,
          isAdmin: user?.isAdmin ?? false,
          actief: user?.actief ?? true,
        };
        try {
          // C16: saved over the version this form was opened with. A conflict or a
          // read-only refusal goes to the app's own message (app.js).
          await save(saved, user?._meta?.rev);
        } finally {
          if (saveBtn.isConnected) setBusy(saveBtn, false);
        }
        forgetAvatarPhotos(); // a new photo under the same name shows at once (review 15 m8)
        closeModal();
        toast(isNew ? `${voornaam} toegevoegd.` : `${voornaam} opgeslagen.`, 'success');
        await onSaved();
      });
    },
  });
}
