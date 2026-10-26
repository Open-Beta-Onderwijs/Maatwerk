// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tauri expects a fixed dev port; see src-tauri/tauri.conf.json (devUrl).
export default defineConfig({
  clearScreen: false,
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
  },
});
