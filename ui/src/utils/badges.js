// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════════════════════════════════════════
// User badge photos — the same photo wherever a user's badge is shown: login
// screen, top bar, Gebruikers (Step 7b, manual test M-ADM-1)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shows the photo `relPath` (`fotos/<id>.jpg`) in the badge element `el`
 * instead of its initials. Without a photo, or when it cannot be read, the
 * initials stay. Read fresh each time: an admin may replace the photo under
 * the same name.
 */
export async function loadBadgePhoto(el, relPath) {
  if (!el || !relPath) return;
  let dataUrl = null;
  try {
    dataUrl = await window.maatwerk.readPhotoAsDataUrl(relPath);
  } catch (e) {
    console.warn('[badges]', e);
  }
  if (!dataUrl || !el.isConnected) return;
  el.style.backgroundImage = `url(${dataUrl})`;
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  el.textContent = '';
  el.classList.add('badge-has-photo');
}

/** Undoes loadBadgePhoto on an element that is reused for another user. */
export function clearBadgePhoto(el) {
  el.style.backgroundImage = '';
  el.style.backgroundSize = '';
  el.style.backgroundPosition = '';
  el.classList.remove('badge-has-photo');
}

/** Loads the photos of every `[data-foto]` badge under `root`. */
export function loadBadgePhotosIn(root) {
  return Promise.all(
    Array.from(root.querySelectorAll('[data-foto]')).map((badge) =>
      loadBadgePhoto(badge.querySelector('.badge-initials') ?? badge, badge.dataset.foto),
    ),
  );
}
