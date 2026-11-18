// SPDX-License-Identifier: AGPL-3.0-or-later

// Tauri's window-level drag and drop is off (`dragDropEnabled: false`), because
// on Windows it also swallows drags inside the page, such as moving selected
// text in the editor. File drops now reach the webview, which would open the
// file in place of the app, and CodeMirror would insert its bytes as text
// (quirk U20). This guard drops them in the capture phase; drags of text and
// other in-page data are left alone.

function isFileDrag(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false;
}

/** An element that takes file drops itself (the AI panel's attachments, step 32b). */
function acceptsDrops(e: DragEvent): boolean {
  const t = e.target;
  return t instanceof Element && t.closest('[data-file-drop]') !== null;
}

function ignoreFileDrag(e: DragEvent): void {
  if (!isFileDrag(e) || acceptsDrops(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
}

/** Ignores files dragged onto this window, except onto `[data-file-drop]`. Once per document. */
export function blockFileDrops(): void {
  window.addEventListener('dragover', ignoreFileDrag, true);
  window.addEventListener('drop', ignoreFileDrag, true);
}
