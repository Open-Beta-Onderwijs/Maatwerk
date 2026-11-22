// SPDX-License-Identifier: AGPL-3.0-or-later

// The save status of Projectgroep beoordelen, for the PO score table's footer under it (step 37,
// review 23 n3: the footer said "● Alles opgeslagen" whatever happened). A tiny broadcaster: the
// grading reports every change, also the save on closing, when its own status is gone.

export type SaveKind = 'ok' | 'busy' | 'error';
type Listener = (text: string, kind: SaveKind) => void;

const listeners = new Set<Listener>();

export function reportPoSave(text: string, kind: SaveKind): void {
  for (const l of listeners) l(text, kind);
}

/** Listens until the returned function is called. */
export function onPoSave(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
