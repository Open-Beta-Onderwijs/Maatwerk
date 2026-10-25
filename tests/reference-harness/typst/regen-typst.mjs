// SPDX-License-Identifier: AGPL-3.0-or-later
// Regenerates (default) or checks (--check) the Typst goldens in tests/golden/typst/.
//
//   npm run golden:typst [-- --check] [-- <case-id> ...]
//
// Needs `_reference/` (its Typst 0.14.2 CLI, templates, fonts) and the Typst
// packages cetz 0.3.4 / unify 0.8.0 / oxifmt in the local package cache (quirk T1).
// Every case calls a real reference IPC handler; the wrapper sources it writes
// are recorded, compiled once more to PNG (30 ppi) and the PDF text is extracted.

import { setupEnvironment, freezeClock } from '../environment.mjs';
setupEnvironment();
freezeClock();

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from '../golden.mjs';
import { REFERENCE_COMMIT, REPO_ROOT, refPath, requireReference } from '../reference.mjs';
import { generate } from '../../../tools/fixtures/generate.mjs';
import { openReference } from '../session.mjs';
import { CASES, bindCompileRapport, opdrachtenByKind } from './cases.mjs';
import { inspectPdf } from './pdf.mjs';

export const TYPST_DIR = path.join(REPO_ROOT, 'tests', 'golden', 'typst');
export const PPI = 30;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function typstBinary(appDir) {
  const platformDir = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
  const archDir = process.arch === 'arm64' ? 'aarch64' : 'x_86_64';
  return path.join(
    appDir,
    'bin',
    'typst',
    platformDir,
    archDir,
    process.platform === 'win32' ? 'typst.exe' : 'typst',
  );
}

/** Absolute app paths (also in `\\?\` form and with forward slashes) -> `<app>`. */
function normalizer(appDir) {
  const forms = [`\\\\?\\${appDir}`, appDir, appDir.split(path.sep).join('/')];
  return (text) => {
    let out = text;
    for (const f of forms) out = out.split(f).join('<app>');
    return out;
  };
}
function normalizeDeep(v, norm) {
  if (typeof v === 'string') return norm(v);
  if (Array.isArray(v)) return v.map((x) => normalizeDeep(x, norm));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeDeep(x, norm)]));
  return v;
}

/** Compiles `wrapperRel` (relative to appDir) to PNGs with the reference arguments plus --format png. */
function renderPngs(appDir, wrapperRel, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync(
    typstBinary(appDir),
    [
      'compile',
      '--font-path',
      path.join(appDir, 'include', 'fonts'),
      '--package-path',
      path.join(appDir, 'include', 'packages'),
      '--root',
      appDir,
      '--format',
      'png',
      '--ppi',
      String(PPI),
      path.join(appDir, ...wrapperRel.split('/')),
      path.join(outDir, 'p{0p}.png'),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  return fs
    .readdirSync(outDir)
    .filter((f) => /^p\d+\.png$/.test(f))
    .sort()
    .map((f) => ({ name: f, buf: fs.readFileSync(path.join(outDir, f)) }));
}

const MAIN_WRAPPER = /(^|\/)(_rapport_run|_assignment_run|_assignment_svg_run|b\d+-0)\.typ$/;

/** Runs every case; returns { [id]: { json, pngs: [{name, buf}] } }. */
export async function runCases(only = []) {
  requireReference();
  const out = {};
  for (const c of CASES) {
    if (only.length && !only.includes(c.id)) continue;
    out[c.id] = await runCase(c);
  }
  return out;
}

/** One case in a fresh reference session on the tiny fixture. */
async function runCase(c) {
  const writes = [];
  const s = await openReference({
    fixture: (dir) => {
      generate('tiny', dir);
      // seedInitialData (main.js) keeps opdrachten/lib.typ equal to the bundled one.
      fs.copyFileSync(
        refPath('include/templates/lib.typ'),
        path.join(dir, 'opdrachten', 'lib.typ'),
      );
      c.prepare?.(dir);
    },
    subject: 'nat',
    main: { onWrite: (file, data) => writes.push({ file, data: String(data) }) },
  });
  try {
    const { Store, qKind, mp } = s;
    const appDir = mp.appDir;
    const norm = normalizer(appDir);
    const rel = (abs) => path.relative(appDir, abs).split(path.sep).join('/');
    await Store.getOpdrachten();
    const ops = opdrachtenByKind(Store);
    const rapportCalls = [];
    const rtti = {
      ...mp.rtti,
      renderRapportPdf: (...args) => (
        rapportCalls.push(structuredClone(args)),
        mp.rtti.renderRapportPdf(...args)
      ),
    };
    const ctx = {
      Store,
      ops,
      fns: bindCompileRapport(Store, qKind, rtti).fns,
      typSource: (kind) =>
        fs.readFileSync(path.join(s.dataDir, 'opdrachten', ops[kind].typFile), 'utf8'),
    };
    if (c.removeWatermark) fs.rmSync(path.join(s.dataDir, 'fotos', 'school-watermerk.svg'));
    writes.length = 0;
    let call;
    let result;
    if (c.rapport) {
      result = await c.rapport(ctx);
      call = ['app:renderRapportPdf', ...rapportCalls[0]];
    } else {
      call = c.args(ctx);
      result = await mp.invoke(...call);
    }
    const wrappers = writes
      .filter((w) => w.file.endsWith('.typ'))
      .map((w) => ({ file: rel(w.file), source: norm(w.data) }));
    const json = {
      format: 1,
      id: c.id,
      path: c.path,
      rule: c.rule,
      reference: { commit: REFERENCE_COMMIT, typst: '0.14.2', ppi: PPI },
      call: { channel: call[0], args: encode(call.slice(1)) },
      result: normalizeDeep(encode(result), norm),
      wrappers,
    };
    let pngs = [];
    if (result?.success && result.pdfPath) json.pdf = await inspectPdf(result.pdfPath);
    if (result?.success && Array.isArray(result.pages)) {
      json.result = { success: true, pages: result.pages.length };
      json.svg = result.pages.map((svg) => ({
        bytes: Buffer.byteLength(svg),
        viewBox: /viewBox="([^"]+)"/.exec(svg)?.[1] ?? null,
        cursorLinks: (svg.match(/href="rtti-cursor:"/g) ?? []).length,
        images: (svg.match(/<image /g) ?? []).length,
      }));
    }
    // One PNG set per case from its main wrapper (single-job batches only).
    const main = writes.filter((w) => MAIN_WRAPPER.test(rel(w.file)));
    const jobs = call[0] === 'app:renderAssignmentBatch' ? call[1].length : 1;
    if (result?.success && main.length === 1 && jobs === 1) {
      // The handler deleted its wrapper (and preview copy); put them back for the PNG run.
      const restore = writes.filter((w) => w.file.endsWith('.typ'));
      for (const w of restore) fs.writeFileSync(w.file, w.data);
      try {
        pngs = renderPngs(appDir, rel(main[0].file), path.join(mp.root, 'png'));
      } finally {
        for (const w of restore) fs.rmSync(w.file, { force: true });
      }
      json.png = pngs.map((p) => ({ file: p.name, sha256: sha256(p.buf), bytes: p.buf.length }));
    }
    return { json, pngs };
  } finally {
    s.dispose();
  }
}

export const caseJson = (json) => `${JSON.stringify(json, null, 2)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const only = args.filter((a) => !a.startsWith('--'));
  const results = await runCases(only);
  let failed = 0;
  for (const [id, { json, pngs }] of Object.entries(results)) {
    const dir = path.join(TYPST_DIR, id);
    const files = { 'case.json': Buffer.from(caseJson(json)) };
    for (const p of pngs) files[p.name] = p.buf;
    if (check) {
      const have = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
      const diff =
        Object.keys(files).sort().join() !== have.join() ||
        Object.entries(files).some(([f, buf]) => !buf.equals(fs.readFileSync(path.join(dir, f))));
      console.log(`${diff ? 'DIFF' : 'ok  '} ${id}`);
      if (diff) failed++;
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      for (const [f, buf] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), buf);
      const pages = json.pdf?.pageCount ?? json.svg?.length ?? 0;
      console.log(
        `wrote ${id}: ${json.result?.success ? `${pages} page(s)` : 'error'}, ${pngs.length} png`,
      );
    }
  }
  if (failed) process.exit(1);
}
