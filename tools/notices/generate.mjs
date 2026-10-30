// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes THIRD_PARTY_NOTICES.txt: the licence texts of everything shipped in
// maatwerk.exe (Rust crates via cargo-about, production npm packages of ui/,
// fonts and Typst packages). AGPL section 5(d)/6 and the notice clauses of
// MIT/BSD/Apache need them in the distributed program; "Over Maatwerk" shows
// this file. `--check` fails when the committed file is out of date (CI).
//
// Needs cargo-about 0.9 (`cargo install cargo-about --locked --features cli`).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'THIRD_PARTY_NOTICES.txt');
const ASSETS = join(ROOT, 'crates/maatwerk-core/assets');
const RULE = '='.repeat(80);
// npm is a .cmd script on Windows and needs a shell; cargo does not.
const shell = process.platform === 'win32';

/** Normalises line endings and trailing space so the output is the same on every OS. */
const clean = (text) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();

function rustNotices() {
  // `-o`: cargo-about refuses to write to a pipe when started from PowerShell.
  const dir = mkdtempSync(join(tmpdir(), 'maatwerk-notices-'));
  const file = join(dir, 'rust.txt');
  try {
    execFileSync(
      'cargo',
      [
        'about',
        'generate',
        '--offline',
        '--fail',
        '-c',
        'tools/notices/about.toml',
        '-m',
        'src-tauri/Cargo.toml',
        '-o',
        file,
        'tools/notices/about.hbs',
      ],
      { cwd: ROOT, stdio: 'inherit' },
    );
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Production packages of ui/, as tools/check-npm-licenses.mjs walks them, minus
// optional Node-only packages that Vite never bundles for the webview.
const NOT_BUNDLED = /^@napi-rs\/canvas/; // pdfjs-dist's optional canvas for Node

// Production packages of ui/, as tools/check-npm-licenses.mjs walks them.
function npmPackages() {
  const tree = JSON.parse(
    execFileSync('npm', ['ls', '-w', 'ui', '--omit=dev', '--all', '--json', '--long'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell,
    }),
  );
  const paths = new Set();
  (function walk(node) {
    for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
      if (NOT_BUNDLED.test(name)) continue;
      if (dep.path && !paths.has(dep.path)) {
        paths.add(dep.path);
        walk(dep);
      }
    }
  })(tree.dependencies?.['maatwerk-ui'] ?? {});
  return [...paths]
    .map((path) => {
      const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
      // Dual-licensed packages ship one file per licence (LICENSE-MIT, LICENSE-APACHE-2.0).
      const files = readdirSync(path)
        .filter((f) => /^(licen[cs]e|copying)([-.].*)?$/i.test(f) && !f.endsWith('.spdx'))
        .sort();
      if (files.length === 0) throw new Error(`${pkg.name}: no licence file in ${path}`);
      const text = files.map((f) => readFileSync(join(path, f), 'utf8')).join('\n\n');
      return { name: pkg.name, version: pkg.version, license: pkg.license, text };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Non-code assets: [title, licence file] (THIRD_PARTY_LICENSES.md, "Assets").
const ASSET_LICENCES = [
  ['Source Serif 4 (font)', join(ASSETS, 'fonts/OFL-SourceSerif4.md')],
  ['STIX Two Math (font)', join(ASSETS, 'fonts/OFL-STIXTwo.txt')],
  ['Noto Color Emoji (font)', join(ASSETS, 'fonts/OFL-NotoColorEmoji.txt')],
  [
    'Libertinus Serif (font, via typst-assets)',
    join(ROOT, 'tools/notices/fonts/OFL-Libertinus.txt'),
  ],
  [
    'New Computer Modern (font, via typst-assets): GUST Font License',
    join(ROOT, 'tools/notices/fonts/GUST-FONT-LICENSE.txt'),
  ],
  [
    'New Computer Modern (font, via typst-assets): LaTeX Project Public License 1.3c',
    join(ROOT, 'tools/notices/fonts/LPPL-1.3c.txt'),
  ],
  [
    'DejaVu Sans Mono (font, via typst-assets)',
    join(ROOT, 'tools/notices/fonts/LICENSE-DejaVu.txt'),
  ],
  [
    'Foxit PDF fonts from PDFium (font, via typst-assets)',
    join(ROOT, 'tools/notices/fonts/LICENSE-PDFium.txt'),
  ],
];

function typstPackages() {
  const base = join(ASSETS, 'packages/preview');
  return readdirSync(base)
    .flatMap((name) => readdirSync(join(base, name)).map((version) => ({ name, version })))
    .map(({ name, version }) => [
      `@preview/${name}:${version} (Typst package)`,
      join(base, name, version, 'LICENSE'),
    ])
    .sort(([a], [b]) => a.localeCompare(b));
}

function section(title, text) {
  return `${RULE}\n${title}\n${'-'.repeat(80)}\n\n${clean(text)}\n`;
}

function build() {
  const parts = [
    `Maatwerk: third-party notices

Maatwerk is free software under the GNU Affero General Public License, version 3
or later (see LICENSE). It includes the third-party components below, each under
its own licence. This file is generated by tools/notices/generate.mjs; do not
edit it by hand.

Contents: 1. Rust crates  2. JavaScript packages  3. Fonts  4. Typst packages
`,
    `${RULE}\n1. RUST CRATES\n`,
    clean(rustNotices()) + '\n',
    `${RULE}\n2. JAVASCRIPT PACKAGES (user interface)\n`,
    ...npmPackages().map((p) => section(`${p.name} ${p.version} (${p.license})`, p.text)),
    `${RULE}\n3. FONTS\n`,
    ...ASSET_LICENCES.map(([title, file]) => section(title, readFileSync(file, 'utf8'))),
    `${RULE}\n4. TYPST PACKAGES (embedded, compiled at run time from source)\n`,
    ...typstPackages().map(([title, file]) => section(title, readFileSync(file, 'utf8'))),
  ];
  return parts.join('\n');
}

const text = build();
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('THIRD_PARTY_NOTICES.txt is out of date: run `node tools/notices/generate.mjs`.');
    process.exit(1);
  }
  console.log('THIRD_PARTY_NOTICES.txt is up to date.');
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote ${OUT} (${Math.round(text.length / 1024)} KiB).`);
}
