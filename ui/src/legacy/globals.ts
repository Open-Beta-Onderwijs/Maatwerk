// SPDX-License-Identifier: AGPL-3.0-or-later

// The reference renderer loaded store.js and custom-select.js as classic
// scripts, so screens use them as globals. This module recreates those globals;
// main.ts imports it before app.js. Remove a global once no legacy file uses it.

import { CustomSelect } from '../custom-select.js';
import { qKind } from '../domain/grades';
import { Store } from '../store.js';

// Chart.js went with the last canvas chart (step 29c): the overviews are HTML and CSS.
Object.assign(window, { CustomSelect, Store, qKind });
