// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * editor.js — Full-screen Typst editor overlay.
 *
 * Opens editor.html in the #editor-frame iframe that covers the entire window.
 * All window.maatwerk calls are proxied from the iframe via postMessage, since the
 * iframe does not have direct access to the contextBridge API. The live editor
 * (Step 8b) calls an allowlist of bridge methods through `maatwerk-editor`, and
 * its compile results are forwarded to the iframe as `maatwerk-editor-update`.
 */

let _messageHandler = null;
let _unsubscribeUpdates = null;
let _session = null;

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

export async function openEditor(opdracht) {
  const overlay = document.getElementById('editor-overlay');
  const frame = document.getElementById('editor-frame');

  // Read the current user badge state from the topbar so the editor can mirror it
  const badgeBtn = document.getElementById('user-badge-btn');
  const badgeInitials = badgeBtn?.textContent?.trim() ?? '?';
  const badgeColor = badgeBtn?.style?.getPropertyValue('--badge-color') ?? '#888';
  const badgeShape = badgeBtn?.classList?.contains('badge-square') ? 'square' : 'circle';

  const params = new URLSearchParams({
    id: opdracht.id,
    naam: opdracht.naam,
    badgeInitials,
    badgeColor,
    badgeShape,
  });
  frame.src = `editor.html?${params}`;
  overlay.classList.remove('hidden');

  // Remove any previous listener before adding a new one
  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler);
  }
  _messageHandler = (evt) => handleEditorMessage(evt, frame, opdracht);
  window.addEventListener('message', _messageHandler);
  _unsubscribeUpdates?.();
  _unsubscribeUpdates = window.maatwerk.onEditorUpdate((update) => {
    frame.contentWindow?.postMessage({ type: 'maatwerk-editor-update', update }, '*');
  });
}

function closeEditor() {
  const overlay = document.getElementById('editor-overlay');
  const frame = document.getElementById('editor-frame');
  frame.src = '';
  overlay.classList.add('hidden');
  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler);
    _messageHandler = null;
  }
  _unsubscribeUpdates?.();
  _unsubscribeUpdates = null;
  if (_session !== null) {
    window.maatwerk.editorClose(_session).catch(() => {});
    _session = null;
  }
}

function handleEditorMessage(evt, frame, opdracht) {
  // Only accept messages from our editor frame
  if (evt.source !== frame.contentWindow) return;

  const { type, id, ...rest } = evt.data;

  function reply(result) {
    frame.contentWindow?.postMessage({ type: 'maatwerk-response', id, result }, '*');
  }

  // D25: a failed call is answered too (with `error`), so the editor's
  // promise settles instead of waiting forever.
  function replyError(err) {
    frame.contentWindow?.postMessage(
      { type: 'maatwerk-response', id, error: String(err?.message ?? err) },
      '*',
    );
  }

  function answer(call) {
    Promise.resolve().then(call).then(reply, replyError);
  }

  switch (type) {
    case 'maatwerk-read-text':
      answer(() => window.maatwerk.readTextFile(rest.path));
      break;
    case 'maatwerk-read-text-versioned':
      answer(() => window.maatwerk.readTextFileVersioned(rest.path));
      break;
    case 'maatwerk-write-text':
      answer(() => window.maatwerk.writeTextFile(rest.path, rest.content, rest.expectedHash));
      break;
    case 'maatwerk-save-copy':
      // C17 "Mijn versie bewaren als kopie": copy the opdracht, then put the
      // editor text in the copy.
      answer(async () => {
        const copy = await Store.copyOpdracht(opdracht.id);
        const written = await window.maatwerk.writeTextFile(
          `opdrachten/${copy.id}/opdracht.typ`,
          rest.content,
        );
        if (!written.ok) throw new Error('kopie niet opgeslagen');
        return { id: copy.id, naam: copy.naam };
      });
      break;
    case 'maatwerk-list-images':
      answer(() => window.maatwerk.listOpdrachtImages(rest.opdrachtId));
      break;
    case 'maatwerk-save-image':
      answer(() =>
        window.maatwerk.saveOpdrachtImage(
          rest.opdrachtId,
          rest.name,
          rest.ext,
          rest.base64,
          rest.overwrite,
        ),
      );
      break;
    case 'maatwerk-pick-image':
      answer(() => window.maatwerk.pickImageFile());
      break;
    case 'maatwerk-import-image':
      answer(() =>
        window.maatwerk.importOpdrachtImage(rest.opdrachtId, rest.token, rest.name, rest.overwrite),
      );
      break;
    case 'maatwerk-clipboard-image':
      answer(() => window.maatwerk.readClipboardImage());
      break;
    case 'maatwerk-editor':
      if (!EDITOR_METHODS.has(rest.method) || !Array.isArray(rest.args)) {
        replyError(new Error(`not allowed: ${rest.method}`));
        break;
      }
      answer(async () => {
        const result = await window.maatwerk[rest.method](...rest.args);
        if (rest.method === 'editorOpen') _session = result.session;
        return result;
      });
      break;
    case 'maatwerk-get-data-dir':
      answer(() => window.maatwerk.getDataDir());
      break;
    case 'editor-close':
      closeEditor();
      break;
    case 'editor-logout':
      closeEditor();
      document.getElementById('user-badge-btn').click();
      break;
    default:
      break;
  }
}
