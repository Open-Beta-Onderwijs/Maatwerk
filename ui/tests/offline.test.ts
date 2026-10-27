// SPDX-License-Identifier: AGPL-3.0-or-later

// The app must work without internet (PLAN.md Step 3a): no page or source file
// may load code, styles or workers from a remote origin.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(js|ts|css|html)$/.test(entry.name) ? [path] : [];
  });
}

const files = [
  ...['index.html', 'editor.html', 'pdf-viewer.html'].map((f) => join(root, f)),
  ...sources(join(root, 'src')),
];

// import/from/url()/src=/href= followed by a remote URL.
const REMOTE = /(from\s*|import\s*\(\s*|url\(\s*|src=|href=)['"]?(https?:)?\/\/(?!localhost)/;

describe('offline', () => {
  it.each(files.map((f) => [relative(root, f), f]))('%s loads nothing remote', (_, file) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    const hits = lines.flatMap((line, i) =>
      REMOTE.test(line) ? [`${i + 1}: ${line.trim()}`] : [],
    );
    expect(hits).toEqual([]);
  });
});
