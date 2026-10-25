// SPDX-License-Identifier: AGPL-3.0-or-later

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
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
