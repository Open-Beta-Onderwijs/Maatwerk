// SPDX-License-Identifier: AGPL-3.0-or-later
// Typst goldens (tests/golden/typst/<case>/). In CI: structure, PNG hashes, and
// the wrapper contract (the recorded wrapper sources must follow from the call
// arguments through the verbatim reference builders in tools/reference-shims).
// With `_reference/`: the reference CLI re-renders everything and must match.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode } from '../reference-harness/golden.mjs';
import { REFERENCE_COMMIT, referenceAvailable } from '../reference-harness/reference.mjs';

const require = createRequire(import.meta.url);
const W = require('../../tools/reference-shims/typst-wrappers.cjs');
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'typst');
const cases = fs.readdirSync(DIR).filter((d) => fs.statSync(path.join(DIR, d)).isDirectory()).sort();
const load = (id) => JSON.parse(fs.readFileSync(path.join(DIR, id, 'case.json'), 'utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('there are Typst goldens for paths A-D', () => {
  const paths = new Set(cases.map((id) => load(id).path));
  assert.deepEqual([...paths].sort(), ['A', 'B', 'C', 'D']);
});

for (const id of cases) {
  test(`typst ${id}: structure and PNG hashes`, () => {
    const c = load(id);
    assert.equal(c.format, 1);
    assert.equal(c.id, id);
    assert.equal(c.reference.commit, REFERENCE_COMMIT);
    const pngs = fs.readdirSync(path.join(DIR, id)).filter((f) => f.endsWith('.png')).sort();
    assert.deepEqual(pngs, (c.png ?? []).map((p) => p.file));
    for (const p of c.png ?? []) assert.equal(sha256(fs.readFileSync(path.join(DIR, id, p.file))), p.sha256, p.file);
    if (c.result.success) {
      const pages = c.pdf?.pageCount ?? c.svg?.length;
      assert.ok(pages > 0);
      if (c.pdf) assert.equal(c.pdf.pages.length, c.pdf.pageCount);
      if (c.png) assert.equal(c.png.length, pages);
    } else {
      assert.equal(typeof c.result.error, 'string');
      assert.ok(!/[A-Z]:\\Users/i.test(c.result.error), 'absolute paths are normalised');
    }
  });

  test(`typst ${id}: wrapper sources follow from the call (verbatim builders)`, () => {
    const c = load(id);
    const args = decode(c.call.args);
    const byFile = Object.fromEntries(c.wrappers.map((w) => [w.file, w.source]));
    switch (c.call.channel) {
      case 'app:renderRapportPdf':
        assert.equal(byFile['temp/_rapport_run.typ'], W.rapportWrapper(args[1], args[2]).wrapperContent);
        break;
      case 'app:renderAssignmentPdf':
        assert.equal(byFile['temp/_assignment_run.typ'], W.buildAssignmentWrapper(`/data/opdrachten/${args[0]}`, W.placeholderHeader(args[1])));
        break;
      case 'app:renderAssignmentSvg': {
        const preview = `_preview_${args[0]}`;
        assert.equal(byFile[`data/opdrachten/${preview}`], args[2]);
        assert.equal(byFile['temp/_assignment_svg_run.typ'], W.buildAssignmentWrapper(`/data/opdrachten/${preview}`, W.placeholderHeader(args[1]), { cursorMarker: true }));
        break;
      }
      case 'app:renderAssignmentBatch': {
        const [jobs, opts] = args;
        const files = Object.keys(byFile).filter((f) => /^temp\/opdrachten_run\/b\d+-\d+\.typ$/.test(f));
        assert.equal(files.length, jobs.length);
        for (const f of files) {
          const i = Number(/-(\d+)\.typ$/.exec(f)[1]);
          const job = jobs[i];
          assert.equal(byFile[f], W.buildAssignmentWrapper(`/data/opdrachten/${job.typFile}`, job.header ?? {}, { includeAnswers: opts.includeAnswers, mode: job.mode }), f);
        }
        break;
      }
      default:
        assert.fail(`unknown channel ${c.call.channel}`);
    }
  });
}

test('Typst goldens match a fresh reference render', { skip: referenceAvailable() ? false : '_reference/ not available', timeout: 600_000 }, () => {
  const script = fileURLToPath(new URL('../reference-harness/typst/regen-typst.mjs', import.meta.url));
  execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe', env: { ...process.env, TZ: 'Europe/Amsterdam' } });
});
