// SPDX-License-Identifier: AGPL-3.0-or-later

// Entry point of the main window. Import order matters: the globals must exist
// before app.js and the screens evaluate.
import './legacy/globals';
import './app.js';
