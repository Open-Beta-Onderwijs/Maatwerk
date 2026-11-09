// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Its own target folder: a `cargo` run by tauri on the main folder can never block this one, and
// the size-optimised profile does not rebuild the native crates.
const targetDir = `${root}target/grades-wasm`;
const built = `${targetDir}/wasm32-unknown-unknown/release/maatwerk_grades_wasm.wasm`;
const MODULE = 'virtual:maatwerk-grades-wasm';
const RESOLVED = `\0${MODULE}`;

function build(): void {
  execFileSync(
    'cargo',
    [
      'build',
      '--quiet',
      '--locked',
      '--release',
      '--package',
      'maatwerk-grades-wasm',
      '--lib',
      '--target',
      'wasm32-unknown-unknown',
      '--target-dir',
      targetDir,
    ],
    { cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_PROFILE_RELEASE_OPT_LEVEL: 's' } },
  );
}

/**
 * The grade rules for the UI (ADR-0011): builds them once per Vite run, and offers the result as
 * a module with the bytes in base64. Cargo does nothing when the Rust sources did not change. The
 * wasm target is installed through `rust-toolchain.toml`.
 */
export function gradesWasm(): Plugin {
  let base64: string | undefined;
  return {
    name: 'maatwerk-grades-wasm',
    resolveId(id) {
      return id === MODULE ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      if (base64 === undefined) {
        build();
        base64 = readFileSync(built).toString('base64');
      }
      return `export default ${JSON.stringify(base64)};`;
    },
  };
}
