// SPDX-License-Identifier: AGPL-3.0-or-later

// The full-screen Typst editor overlay: editor.html in #editor-frame over the whole window.
// The iframe has no bridge of its own; it asks the main window through postMessage
// (editor/protocol.ts) and gets the live compile results as `maatwerk-editor-update`.
//
// U10: the requests are typed and checked here. File access names one of the opdracht's three
// files (the path is built here, for the opdracht this editor was opened on); the image calls and
// the opdracht methods of the live editor always use that opdracht; only messages from the
// editor frame count.

import { confirmDialog } from '../app.js';
import { editorSubtitle } from '../domain/editor-header';
import { EDITOR_SPLIT, clampEditorSplit, savedEditorSplit } from '../domain/preferences';
import type { Opdracht } from '../domain/types';
import {
  isEditorFile,
  type EditorFile,
  type EditorInfo,
  type EditorMessage,
  type EditorResponse,
} from '../editor/protocol';
import { Store } from '../store.js';

/** Live editor methods the iframe may call (ADR-0002 section 6: method allowlist). */
const EDITOR_METHODS = new Set([
  'editorOpen',
  'editorUpdate',
  'editorUnset',
  'editorRefresh',
  'editorResend',
  'editorComplete',
  'editorHover',
  'editorDefinition',
  'editorJumpFromClick',
  'editorJumpFromCursor',
  'projectFilesStatus',
  'restoreProjectFile',
  'bundledProjectFile',
]);
/** Of those, the ones whose first argument is the opdracht id. */
const OPDRACHT_METHODS = new Set(['editorOpen', 'projectFilesStatus', 'restoreProjectFile']);

let messageHandler: ((evt: MessageEvent) => void) | null = null;
let unsubscribeUpdates: (() => void) | null = null;
let session: number | null = null;

const overlay = () => document.getElementById('editor-overlay')!;
const frameEl = () => document.getElementById('editor-frame') as HTMLIFrameElement;

export function openEditor(opdracht: Opdracht): void {
  const frame = frameEl();
  const params = new URLSearchParams({ id: opdracht.id, naam: opdracht.naam ?? '' });
  frame.src = `editor.html?${params}`;
  overlay().classList.remove('hidden');

  if (messageHandler) window.removeEventListener('message', messageHandler);
  const handler = (evt: MessageEvent) => handleEditorMessage(evt, frame, opdracht, handler);
  messageHandler = handler;
  window.addEventListener('message', handler);
  unsubscribeUpdates?.();
  unsubscribeUpdates = window.maatwerk.onEditorUpdate((update) => {
    frame.contentWindow?.postMessage({ type: 'maatwerk-editor-update', update }, '*');
  });
}

/** The logged-in user for the editor's avatar (B-08): the same as the top bar, with the photo. */
async function userAvatar() {
  const user = Store.getActiveUser();
  if (!user) return null;
  const photo = user.foto
    ? await window.maatwerk.readPhotoAsDataUrl(user.foto).catch(() => null)
    : null;
  return {
    user: {
      voornaam: user.voornaam,
      achternaam: user.achternaam,
      afkorting: user.afkorting,
      kleur: user.kleur,
      isAdmin: user.isAdmin,
    },
    square: !!user.isAdmin || !!Store.getActiveRole(),
    name: Store.fullName(user),
    photo,
  };
}

function editorInfo(opdracht: Opdracht): EditorInfo {
  // The latest version: the teacher may have changed vak or jaarlaag just before opening.
  const latest = (Store.getOpdrachtenSync() as Opdracht[]).find((o) => o.id === opdracht.id);
  return {
    subtitle: editorSubtitle(latest ?? opdracht),
    split: savedEditorSplit(Store.getActiveUser()) ?? EDITOR_SPLIT.initial,
  };
}

function closeEditor(): void {
  const frame = frameEl();
  frame.src = '';
  overlay().classList.add('hidden');
  if (messageHandler) {
    window.removeEventListener('message', messageHandler);
    messageHandler = null;
  }
  unsubscribeUpdates?.();
  unsubscribeUpdates = null;
  if (session !== null) {
    window.maatwerk.editorClose(session).catch(() => {});
    session = null;
  }
}

/** Throws for a file the editor may not touch (U10). */
function fileOf(file: unknown): EditorFile {
  if (!isEditorFile(file)) throw new Error(`not allowed: file ${String(file)}`);
  return file;
}

function handleEditorMessage(
  evt: MessageEvent,
  frame: HTMLIFrameElement,
  opdracht: Opdracht,
  handler: (evt: MessageEvent) => void,
): void {
  // Only messages from our editor frame.
  if (evt.source !== frame.contentWindow) return;
  const msg = evt.data as EditorMessage | null;
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  if (msg.type === 'editor-close') return closeEditor();
  if (msg.type === 'editor-logout') {
    closeEditor();
    document.getElementById('user-badge-btn')?.click();
    return;
  }
  const { id } = msg;
  const send = (response: Omit<EditorResponse, 'type' | 'id'>) =>
    frame.contentWindow?.postMessage({ type: 'maatwerk-response', id, ...response }, '*');
  // D25: a failed call is answered too (with `error`), so the editor's promise settles.
  const answer = (call: () => unknown) => {
    Promise.resolve()
      .then(call)
      .then(
        (result) => send({ result }),
        (err: unknown) => send({ error: String((err as Error)?.message ?? err) }),
      );
  };
  const path = (file: unknown) => `opdrachten/${opdracht.id}/${fileOf(file)}`;
  const api = window.maatwerk;

  switch (msg.type) {
    case 'maatwerk-read-text-versioned':
      return answer(() => api.readTextFileVersioned(path(msg.file)));
    case 'maatwerk-write-text':
      return answer(() => api.writeTextFile(path(msg.file), msg.content, msg.expectedHash));
    case 'maatwerk-save-copy':
      // C17 "Mijn versie bewaren als kopie": copy the opdracht, then put the editor text in it.
      return answer(async () => {
        const copy = (await Store.copyOpdracht(opdracht.id)) as Opdracht;
        const written = await api.writeTextFile(
          `opdrachten/${copy.id}/opdracht.typ`,
          String(msg.content),
        );
        if (!written.ok) throw new Error('kopie niet opgeslagen');
        return { id: copy.id, naam: copy.naam };
      });
    case 'maatwerk-list-images':
      return answer(() => api.listOpdrachtImages(opdracht.id));
    case 'maatwerk-save-image':
      return answer(() =>
        api.saveOpdrachtImage(opdracht.id, msg.name, msg.ext, msg.base64, msg.overwrite),
      );
    case 'maatwerk-pick-image':
      return answer(() => api.pickImageFile());
    case 'maatwerk-import-image':
      return answer(() => api.importOpdrachtImage(opdracht.id, msg.token, msg.name, msg.overwrite));
    case 'maatwerk-clipboard-image':
      return answer(() => api.readClipboardImage());
    case 'maatwerk-editor': {
      const { method, args } = msg;
      if (!EDITOR_METHODS.has(method) || !Array.isArray(args))
        return send({ error: `not allowed: ${String(method)}` });
      // The opdracht methods only for the opdracht this editor was opened on (review 8b n7).
      if (OPDRACHT_METHODS.has(method) && args[0] !== opdracht.id)
        return send({ error: `not allowed: ${method} for another opdracht` });
      return answer(async () => {
        const call = (api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
          method
        ]!;
        const result = await call.apply(api, args);
        if (method === 'editorOpen') {
          const opened = (result as { session: number }).session;
          // Closed (or reopened) while opening: this session has no editor (review 8b m7).
          if (messageHandler !== handler) api.editorClose(opened).catch(() => {});
          else session = opened;
        }
        return result;
      });
    }
    case 'maatwerk-confirm':
      // The app's own dialog: in Tauri, tauri-plugin-dialog replaces window.confirm with an
      // async function, so a native confirm in the iframe never asks (M-OPD-9, review 8b m6).
      return answer(() =>
        confirmDialog(String(msg.message ?? ''), {
          okLabel: String(msg.okLabel ?? 'OK'),
          danger: msg.danger === true,
        }),
      );
    case 'maatwerk-get-data-dir':
      return answer(() => api.getDataDir());
    case 'maatwerk-user-avatar':
      return answer(userAvatar);
    case 'maatwerk-editor-info':
      return answer(() => editorInfo(opdracht));
    case 'maatwerk-set-split':
      // F-16: saved per user (decision 3); a failed save only loses the position.
      return answer(async () => {
        if (typeof msg.split !== 'number' || !Number.isFinite(msg.split))
          throw new Error('not allowed: split');
        if (!Store.getActiveUser()) return false;
        await Store.savePreferences({ editorSplit: clampEditorSplit(msg.split) });
        return true;
      });
    default:
      return send({ error: `not allowed: ${String((msg as { type: string }).type)}` });
  }
}
