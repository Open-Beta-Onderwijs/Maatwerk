// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { mockCsp } from './vite/csp.ts';
import { mockFixtures } from './vite/mock-fixtures.ts';

// "Over Maatwerk" shows the workspace version and the git build it came from,
// so a user can find the matching source (AGPL section 6).
const cargoToml = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
const version = /^version = "([^"]+)"/m.exec(cargoToml)?.[1] ?? 'onbekend';
let build = 'onbekend';
try {
  build = execFileSync('git', ['describe', '--tags', '--match', 'v*', '--always', '--dirty'], {
    encoding: 'utf8',
  }).trim();
} catch {
  // Not a git checkout (e.g. a source archive): keep "onbekend".
}

// Tauri expects a fixed dev port; see src-tauri/tauri.conf.json (devUrl).
export default defineConfig({
  clearScreen: false,
  plugins: [mockFixtures(), mockCsp()],
  define: {
    __MAATWERK_VERSION__: JSON.stringify(version),
    __MAATWERK_BUILD__: JSON.stringify(build),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    // Desktop app loading from disk: one large chunk is fine.
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        editor: fileURLToPath(new URL('editor.html', import.meta.url)),
        'pdf-viewer': fileURLToPath(new URL('pdf-viewer.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Set before the worker starts: Node reads TZ once.
    env: { TZ: 'Europe/Amsterdam' },
  },
});
