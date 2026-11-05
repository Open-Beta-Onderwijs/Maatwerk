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
import { cssToken } from '../theme';

// The CDN build of the annotation plugin registered itself on load.
Chart.register(annotationPlugin);

// Axis text and grid lines follow the theme (design spec 2.1). Charts are built
// when a modal opens, so new charts pick up a theme change.
function themeCharts(): void {
  Chart.defaults.color = cssToken('--muted');
  Chart.defaults.borderColor = cssToken('--line');
}
themeCharts();
document.documentElement.addEventListener('maatwerk:look', themeCharts);

Object.assign(window, { Chart, CustomSelect, Store, qKind });
