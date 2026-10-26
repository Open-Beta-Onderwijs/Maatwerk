// SPDX-License-Identifier: AGPL-3.0-or-later
// Child process for regen.mjs: runs one suite and prints its golden JSON.

import { DEFAULT_NOW, freezeClock, setupEnvironment } from './environment.mjs';
setupEnvironment();
freezeClock(DEFAULT_NOW);

const { serialize } = await import('./golden.mjs');
const name = process.argv[2];
const mod = await import(`./suites/${name}.mjs`);
const suite = await mod.default();
process.stdout.write(serialize(suite));
