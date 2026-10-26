// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * editor.js — Full-screen Typst editor overlay.
 *
 * Opens editor.html in the #editor-frame iframe that covers the entire window.
 * All window.maatwerk calls are proxied from the iframe via postMessage, since the
 * iframe does not have direct access to the contextBridge API.
 */

let _messageHandler = null;

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
    typFile: opdracht.typFile,
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
  _messageHandler = (evt) => handleEditorMessage(evt, frame);
  window.addEventListener('message', _messageHandler);
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
}

function handleEditorMessage(evt, frame) {
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
    case 'maatwerk-write-text':
      answer(() => window.maatwerk.writeTextFile(rest.path, rest.content));
      break;
    case 'maatwerk-render-assignment-svg':
      answer(() => window.maatwerk.renderAssignmentSvg(rest.typFile, rest.title, rest.content));
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
