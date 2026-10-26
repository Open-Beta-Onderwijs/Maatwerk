// SPDX-License-Identifier: AGPL-3.0-or-later

// Vite plugin providing `virtual:maatwerk-fixtures`: a synthetic data folder
// from tools/fixtures (fixed seed), inlined as a MockSeed for the MockApi.
// MAATWERK_FIXTURE selects the profile (`tiny` default, `school`).

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
// Shared with the reference harness (plain JS, checked via allowJs).
import { generate } from '../../tools/fixtures/generate.mjs';

const ID = 'virtual:maatwerk-fixtures';
const BINARY = /\.(png|jpe?g|gif|webp)$/i;

export function snapshotFixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), 'maatwerk-fixture-'));
  try {
    generate(name, root);
    const files: Record<string, { text: string } | { base64: string }> = {};
    const dirs: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          dirs.push(path);
          walk(path);
        } else {
          const bytes = readFileSync(join(root, path));
          files[path] = BINARY.test(entry.name)
            ? { base64: bytes.toString('base64') }
            : { text: bytes.toString('utf8') };
        }
      }
    };
    walk('');
    return { files, dirs };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function mockFixtures(): Plugin {
  return {
    name: 'maatwerk-mock-fixtures',
    resolveId(id) {
      return id === ID ? `\0${ID}` : undefined;
    },
    load(id) {
      if (id !== `\0${ID}`) return undefined;
      const seed = snapshotFixture(process.env.MAATWERK_FIXTURE ?? 'tiny');
      return `export default ${JSON.stringify(seed)};`;
    },
  };
}
