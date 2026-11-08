// SPDX-License-Identifier: AGPL-3.0-or-later

// Entry point of the main window. Order matters: the bridge (window.maatwerk)
// and the legacy globals must exist before app.js evaluates, so they are
// awaited and app.js is imported dynamically.
import { installBridge } from './bridge';
import { initCore } from './domain/core';
import { installErrorReporting } from './services/problems';
import { watchStyleData } from './legacy/style-data';
import { blockFileDrops } from './utils/no-file-drop';
import { installLook } from './theme';

// Dev and mock builds get the theme menu (Ctrl+Alt+T) until step 15.
installLook(import.meta.env.DEV || import.meta.env.MODE === 'mock');
blockFileDrops();
watchStyleData();
await installBridge();
// Errors nobody handled: logged, plus one message pointing to "Probleem melden".
installErrorReporting(window.maatwerk, (message) => {
  import('./app.js')
    .then((app) => app.persistentError(message))
    .catch(() => console.error(message));
});
await initCore();
await import('./legacy/globals');
await import('./app.js');
