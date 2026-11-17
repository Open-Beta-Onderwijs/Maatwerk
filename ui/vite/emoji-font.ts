// SPDX-License-Identifier: AGPL-3.0-or-later

// The mock build (e2e and visual tests in a browser) has no Tauri scheme, so it gets the core's
// emoji font as `/maatwerk-emoji.ttf` next to its pages (`MockApi.emojiFontUrl`). Only the mock
// build: the app serves the copy in the binary (src-tauri/src/scheme.rs), never a second one.

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const SOURCE = new URL(
  '../../crates/maatwerk-core/assets/fonts/NotoColorEmoji-COLRv1.ttf',
  import.meta.url,
);
const NAME = 'maatwerk-emoji.ttf';

export function mockEmojiFont(): Plugin {
  let enabled = false;
  return {
    name: 'maatwerk-mock-emoji-font',
    configResolved(config) {
      enabled = config.mode === 'mock';
    },
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use(`/${NAME}`, (_req, res) => {
        res.setHeader('Content-Type', 'font/ttf');
        res.end(readFileSync(SOURCE));
      });
    },
    generateBundle() {
      if (!enabled) return;
      this.emitFile({ type: 'asset', fileName: NAME, source: readFileSync(SOURCE) });
    },
  };
}
