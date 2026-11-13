// SPDX-License-Identifier: AGPL-3.0-or-later

// The profile photo field with a square crop (F-19, design spec 4.9, board
// 12): any image (not only square ones), a square to drag over it, scrolling
// (or + / -) zooms, the arrow keys move it; a round preview in the user's ring
// colour; "Andere foto…" and "Verwijderen". Used by "Foto wijzigen" in the
// user menu (modals/foto-wijzigen.ts) and by "Gebruiker bewerken".
//
// Positions go through the CSSOM (el.style.x), not style attributes: strict CSP.

import {
  fitScale,
  initialSquare,
  keyStep,
  moveSquare,
  outputSide,
  zoomSquare,
  type Size,
  type Square,
} from '../domain/crop';

/** The crop area of board 12. */
const AREA: Size = { width: 300, height: 190 };
const PREVIEW = 72;

export type PhotoChoice =
  | { kind: 'unchanged' }
  | { kind: 'removed' }
  /** A new square photo, JPEG, base64 without the data: prefix. */
  | { kind: 'new'; base64: string };

export interface PhotoCrop {
  /** What to save. */
  choice(): PhotoChoice;
  /** The ring colour of the preview (the colour picker of Gebruiker bewerken). */
  setRing(color: string): void;
}

export interface PhotoCropOptions {
  /** The current photo as a data URL, or null. */
  current: string | null;
  ring: string;
  /** Text in the preview without a photo (the initials). */
  initials: string;
  /** Reports a file that is not an image (a toast). */
  onError?: (message: string) => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Deze afbeelding kan niet worden geopend.'));
    img.src = src;
  });
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Lezen mislukt'));
    reader.readAsDataURL(file);
  });
}

export function mountPhotoCrop(host: HTMLElement, opts: PhotoCropOptions): PhotoCrop {
  host.classList.add('photo-crop');
  host.innerHTML = `
    <div class="photo-crop__area" aria-label="Uitsnede kiezen">
      <img class="photo-crop__img" alt="" draggable="false" />
      <div class="photo-crop__frame" tabindex="0" role="group"
           aria-label="Uitsnede: sleep of gebruik de pijltjestoetsen; + en - zoomen"></div>
      <p class="photo-crop__empty">Geen foto</p>
    </div>
    <div class="photo-crop__preview-wrap">
      <span class="photo-crop__preview">
        <canvas width="${PREVIEW * 2}" height="${PREVIEW * 2}"></canvas>
        <span class="photo-crop__initials"></span>
      </span>
      <span class="photo-crop__caption">voorbeeld</span>
    </div>
    <div class="photo-crop__side">
      <span class="photo-crop__hint">Sleep het vierkant om de uitsnede te kiezen; scroll om te zoomen.
        Elke afbeelding mag, ook als die niet vierkant is.</span>
      <div class="photo-crop__actions">
        <button type="button" class="btn btn--secondary btn--sm" data-action="pick">Andere foto…</button>
        <button type="button" class="btn btn--text btn--sm photo-crop__remove" data-action="remove">Verwijderen</button>
      </div>
      <input type="file" accept="image/*" class="photo-crop__file" hidden />
    </div>`;

  const area = host.querySelector('.photo-crop__area') as HTMLElement;
  const imgEl = host.querySelector('.photo-crop__img') as HTMLImageElement;
  const frame = host.querySelector('.photo-crop__frame') as HTMLElement;
  const preview = host.querySelector('.photo-crop__preview') as HTMLElement;
  const canvas = host.querySelector('canvas') as HTMLCanvasElement;
  const initials = host.querySelector('.photo-crop__initials') as HTMLElement;
  const fileInput = host.querySelector('.photo-crop__file') as HTMLInputElement;
  const removeBtn = host.querySelector('[data-action="remove"]') as HTMLButtonElement;
  initials.textContent = opts.initials;

  let image: HTMLImageElement | null = null;
  let size: Size = { width: 0, height: 0 };
  let sq: Square = { x: 0, y: 0, size: 0 };
  let scale = 1;
  let offset = { x: 0, y: 0 };
  let state: 'unchanged' | 'removed' | 'new' = 'unchanged';

  function setRing(color: string): void {
    preview.style.setProperty('--badge-color', color);
  }
  setRing(opts.ring);

  function draw(): void {
    const has = image !== null;
    host.classList.toggle('photo-crop--empty', !has);
    removeBtn.disabled = !has;
    frame.tabIndex = has ? 0 : -1;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    frame.style.left = `${offset.x + sq.x * scale}px`;
    frame.style.top = `${offset.y + sq.y * scale}px`;
    frame.style.width = `${sq.size * scale}px`;
    frame.style.height = `${sq.size * scale}px`;
    ctx?.drawImage(image, sq.x, sq.y, sq.size, sq.size, 0, 0, canvas.width, canvas.height);
  }

  function show(img: HTMLImageElement, fresh: boolean): void {
    image = img;
    size = { width: img.naturalWidth, height: img.naturalHeight };
    scale = fitScale(size, AREA);
    offset = {
      x: (AREA.width - size.width * scale) / 2,
      y: (AREA.height - size.height * scale) / 2,
    };
    imgEl.src = img.src;
    imgEl.style.left = `${offset.x}px`;
    imgEl.style.top = `${offset.y}px`;
    imgEl.style.width = `${size.width * scale}px`;
    imgEl.style.height = `${size.height * scale}px`;
    sq = initialSquare(size);
    if (fresh) state = 'new';
    draw();
  }

  function change(next: Square): void {
    sq = next;
    state = 'new';
    draw();
  }

  // Dragging the square (pointer events: mouse, pen and touch).
  frame.addEventListener('pointerdown', (e) => {
    if (!image) return;
    e.preventDefault();
    frame.setPointerCapture(e.pointerId);
    frame.focus({ preventScroll: true });
    let last = { x: e.clientX, y: e.clientY };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - last.x) / scale;
      const dy = (ev.clientY - last.y) / scale;
      last = { x: ev.clientX, y: ev.clientY };
      change(moveSquare(sq, dx, dy, size));
    };
    const onUp = () => {
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('pointerup', onUp);
      frame.removeEventListener('pointercancel', onUp);
    };
    frame.addEventListener('pointermove', onMove);
    frame.addEventListener('pointerup', onUp);
    frame.addEventListener('pointercancel', onUp);
  });
  area.addEventListener(
    'wheel',
    (e) => {
      if (!image) return;
      e.preventDefault();
      change(zoomSquare(sq, e.deltaY < 0 ? 0.92 : 1 / 0.92, size));
    },
    { passive: false },
  );
  frame.addEventListener('keydown', (e) => {
    if (!image) return;
    const next = keyStep(sq, e.key, e.shiftKey, size);
    if (!next) return;
    e.preventDefault();
    change(next);
  });

  host.querySelector('[data-action="pick"]')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      show(await loadImage(await readFile(file)), true);
      frame.focus({ preventScroll: true });
    } catch (e) {
      opts.onError?.(e instanceof Error ? e.message : String(e));
    }
  });
  removeBtn.addEventListener('click', () => {
    image = null;
    imgEl.removeAttribute('src');
    state = 'removed';
    draw();
  });

  draw();
  if (opts.current) {
    void loadImage(opts.current)
      .then((img) => {
        // Not when a new file was chosen or the photo removed meanwhile.
        if (state === 'unchanged') show(img, false);
      })
      .catch(() => undefined);
  }

  return {
    setRing,
    choice(): PhotoChoice {
      if (state === 'removed') return { kind: 'removed' };
      if (state === 'unchanged' || !image) return { kind: 'unchanged' };
      const side = outputSide(sq);
      const out = document.createElement('canvas');
      out.width = side;
      out.height = side;
      const ctx = out.getContext('2d')!;
      // JPEG has no transparency: a white background.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, side, side);
      ctx.drawImage(image, sq.x, sq.y, sq.size, sq.size, 0, 0, side, side);
      const url = out.toDataURL('image/jpeg', 0.9);
      return { kind: 'new', base64: url.slice(url.indexOf(',') + 1) };
    },
  };
}
