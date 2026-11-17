// SPDX-License-Identifier: AGPL-3.0-or-later

// The messages between the editor iframe (editor.html) and the main window (modals/editor.ts).
// U10: typed, and no paths: the iframe names one of its opdracht's three files and the main
// window builds the path for the opdracht it opened; the image calls always use that opdracht.

/** The files of an opdracht folder the editor may read and write (C14, ADR-0002 5a). */
export const EDITOR_FILES = ['opdracht.typ', 'main.typ', 'lib.typ'] as const;
export type EditorFile = (typeof EDITOR_FILES)[number];

export function isEditorFile(v: unknown): v is EditorFile {
  return typeof v === 'string' && (EDITOR_FILES as readonly string[]).includes(v);
}

/** What the header shows and where the divider starts (`maatwerk-editor-info`). */
export interface EditorInfo {
  /** "Opdracht · Natuurkunde · gymnasium 4, 5, 6" */
  subtitle: string;
  /** The editor's share of the width (F-16), saved per user. */
  split: number;
}

/** A request from the iframe; every one is answered with `maatwerk-response` and its `id`. */
export type EditorRequest =
  | { type: 'maatwerk-read-text-versioned'; file: EditorFile }
  | { type: 'maatwerk-write-text'; file: EditorFile; content: string; expectedHash?: string }
  | { type: 'maatwerk-save-copy'; content: string }
  | { type: 'maatwerk-list-images' }
  | { type: 'maatwerk-save-image'; name: string; ext: string; base64: string; overwrite?: boolean }
  | { type: 'maatwerk-pick-image' }
  | { type: 'maatwerk-import-image'; token: string; name: string; overwrite?: boolean }
  | { type: 'maatwerk-clipboard-image' }
  | { type: 'maatwerk-editor'; method: string; args: unknown[] }
  | { type: 'maatwerk-confirm'; message: string; okLabel?: string; danger?: boolean }
  | { type: 'maatwerk-get-data-dir' }
  | { type: 'maatwerk-user-avatar' }
  | { type: 'maatwerk-editor-info' }
  | { type: 'maatwerk-set-split'; split: number };

/** A notice from the iframe (no answer). */
export type EditorNotice = { type: 'editor-close' } | { type: 'editor-logout' };

export type EditorMessage = (EditorRequest & { id: number }) | EditorNotice;

/** The answer to a request. */
export interface EditorResponse {
  type: 'maatwerk-response';
  id: number;
  result?: unknown;
  error?: string;
}
