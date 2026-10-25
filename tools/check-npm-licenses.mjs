// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks the licences of the npm packages that ship in the exe (production
// dependencies of ui/) against an AGPL-compatible allowlist (PLAN.md 2.5).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAllowed } from './spdx.mjs';

// Keep in sync with deny.toml [licenses].allow. OFL-1.1 is for fonts only.
const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'Zlib',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'OFL-1.1',
  'MPL-2.0',
  'LGPL-3.0-or-later',
  'GPL-3.0-or-later',
  'AGPL-3.0-or-later',
]);

const tree = JSON.parse(
  execFileSync('npm', ['ls', '-w', 'ui', '--omit=dev', '--all', '--json', '--long'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }),
);

const seen = new Map();
(function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (dep.path && !seen.has(dep.path)) {
      seen.set(dep.path, name);
      walk(dep);
    }
  }
})(tree.dependencies?.['maatwerk-ui'] ?? {});

if (seen.size === 0) {
  console.error('No production packages found; the check would pass vacuously.');
  process.exit(1);
}

let failed = false;
for (const [path, name] of seen) {
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : 'UNKNOWN';
  const ok = isAllowed(license, ALLOWED);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}@${pkg.version}: ${license}`);
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
