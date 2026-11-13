// SPDX-License-Identifier: AGPL-3.0-or-later

// "Foto wijzigen" in the user menu (F-19, F-17): a teacher changes their own
// photo, not their name. The crop is the shared field of components/photo-crop.ts.
// The photo is saved as afbeeldingen/<user id>.jpg (D28: the name follows the
// user id) and the user file gets the path, merged like the preferences.

import { closeModal, openModal as openModalJs, toast } from '../app.js';
import {
  avatarInitials,
  forgetAvatarPhotos,
  FALLBACK_RING,
  type AvatarUser,
} from '../components/avatar';
import { setBusy } from '../components/button';
import type { Dialog, DialogOptions } from '../components/dialog';
import { mountPhotoCrop } from '../components/photo-crop';
import { READ_ONLY_SAVE_TEXT, isReadOnlyError } from '../services/read-only';
import { Store } from '../store.js';

const openModal = openModalJs as (opts: DialogOptions) => Dialog;

/** The photo file of a user: one name per user id (D28). */
export function photoPathFor(userId: string): string {
  return `afbeeldingen/${userId}.jpg`;
}

interface PhotoApi {
  readPhotoAsDataUrl(relPath: string): Promise<string | null>;
  savePhoto(relPath: string, base64Data: string): Promise<void>;
}

const saveOwnPhoto = Store.saveOwnPhoto as (foto: string | null) => Promise<unknown>;

/** Opens the dialog; `onSaved` gets the user record as written. */
export async function openFotoWijzigen(
  user: AvatarUser & { id: string },
  api: PhotoApi,
  onSaved: (saved: unknown) => void,
): Promise<void> {
  const current = user.foto ? await api.readPhotoAsDataUrl(user.foto).catch(() => null) : null;
  openModal({
    title: 'Foto wijzigen',
    key: 'foto-wijzigen',
    size: 'md',
    body: `<div class="foto-wijzigen-crop"></div>`,
    footerHtml: `
      <button class="btn btn--primary" id="foto-save">Opslaan</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>`,
    onShow: (content: HTMLElement) => {
      const crop = mountPhotoCrop(content.querySelector('.foto-wijzigen-crop') as HTMLElement, {
        current,
        ring: user.kleur || FALLBACK_RING,
        initials: avatarInitials(user),
        onError: (m) => toast(m, 'error'),
      });
      const save = content.querySelector('#foto-save') as HTMLButtonElement;
      save.addEventListener('click', async () => {
        const choice = crop.choice();
        if (choice.kind === 'unchanged') {
          closeModal();
          return;
        }
        setBusy(save, true);
        try {
          let foto: string | null = null;
          if (choice.kind === 'new') {
            foto = photoPathFor(user.id);
            await api.savePhoto(foto, choice.base64);
          }
          const saved = await saveOwnPhoto(foto);
          forgetAvatarPhotos(); // the new photo under the same name shows at once
          if (saved) onSaved(saved);
          closeModal();
          toast(foto ? 'Foto opgeslagen.' : 'Foto verwijderd.', 'success');
        } catch (e) {
          console.error('[foto]', e);
          toast(isReadOnlyError(e) ? READ_ONLY_SAVE_TEXT : 'Foto opslaan mislukt.', 'error');
          if (save.isConnected) setBusy(save, false);
        }
      });
    },
  });
}
