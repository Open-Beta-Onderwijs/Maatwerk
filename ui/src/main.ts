// SPDX-License-Identifier: AGPL-3.0-or-later

// Entry point of the main window. Order matters: the bridge (window.maatwerk)
// and the legacy globals must exist before app.js evaluates, so they are
// awaited and app.js is imported dynamically.
import { installBridge } from './bridge';
import { installErrorReporting } from './services/problems';
import { installQuitGuard } from './services/quit-guard';
import { watchStyleData } from './legacy/style-data';
import { blockFileDrops } from './utils/no-file-drop';
import { installLook } from './theme';
import { registerEmojiFont } from './utils/emoji-font';

// Dev and mock builds get the theme menu (Ctrl+Alt+T) until step 15.
installLook(import.meta.env.DEV || import.meta.env.MODE === 'mock');
blockFileDrops();
watchStyleData();
await installBridge();
// Open work is saved before the window closes (step 37).
installQuitGuard(window.maatwerk);
// Emoji in the embedded font, as in the PDFs (where the webview can draw it).
registerEmojiFont(window.maatwerk.emojiFontUrl());
// Errors nobody handled: logged, plus one message pointing to "Probleem melden". The message
// waits for app.js as the startup loads it: importing it from here could evaluate it before the
// legacy globals exist (review 10 n2).
type AppModule = { persistentError: (message: string) => void };
let appLoaded: (app: AppModule) => void = () => {};
const app = new Promise<AppModule>((resolve) => (appLoaded = resolve));
installErrorReporting(window.maatwerk, (message) => {
  console.error(message);
  void app.then((a) => a.persistentError(message));
});
await import('./legacy/globals');
appLoaded(await import('./app.js'));
