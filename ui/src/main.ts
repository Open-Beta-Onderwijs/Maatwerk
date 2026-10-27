// SPDX-License-Identifier: AGPL-3.0-or-later

// Entry point of the main window. Order matters: the bridge (window.maatwerk)
// and the legacy globals must exist before app.js evaluates, so they are
// awaited and app.js is imported dynamically.
import { installBridge } from './bridge';
import { watchStyleData } from './legacy/style-data';

watchStyleData();
await installBridge();
await import('./legacy/globals');
await import('./app.js');
