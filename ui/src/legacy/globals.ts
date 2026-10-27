// SPDX-License-Identifier: AGPL-3.0-or-later

// The reference renderer loaded Chart.js, store.js and
// custom-select.js as classic scripts, so screens use them as globals. This
// module recreates those globals from npm packages; main.ts imports it before
// app.js. Remove a global once no legacy file uses it.

import Chart from 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';
import { CustomSelect } from '../custom-select.js';
import { qKind } from '../domain/grades';
import { Store } from '../store.js';

// The CDN build of the annotation plugin registered itself on load.
Chart.register(annotationPlugin);

Object.assign(window, { Chart, CustomSelect, Store, qKind });
