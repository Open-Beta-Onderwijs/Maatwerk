// SPDX-License-Identifier: AGPL-3.0-or-later
// Regenerates ui/src/bridge/bindings.ts from the Tauri commands (tauri-specta, ADR-0005).
// `cargo test` fails while the committed file is stale; this rewrites it.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'cargo',
  [
    'test',
    '-p',
    'maatwerk-app',
    '--lib',
    'bindings_are_up_to_date',
    '--',
    '--exact',
    'tests::bindings_are_up_to_date',
  ],
  { stdio: 'inherit', env: { ...process.env, MAATWERK_UPDATE_BINDINGS: '1' } },
);
process.exit(result.status ?? 1);
