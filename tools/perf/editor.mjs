// SPDX-License-Identifier: AGPL-3.0-or-later
// Live editor on the real app (Step 8b, docs/perf.md): latency, stale results
// and memory in a long session, plus a smoke check of the Typst path the e2e
// tests only mock (diagnostics, vragen, autocomplete, preview <-> source).
//
// Starts the built exe on a data folder with WebView2's DevTools port open,
// logs in, opens the first opdracht in the editor and types into opdracht.typ.
// Every edit is timed from the keystroke to the `editor:update` that carries
// its generation (or a newer one). The working set of the app process is
// sampled along the way. Synthetic data only (the `school` fixture, migrated).
//
//   node tools/perf/editor.mjs --data <dir> [--exe target/release/maatwerk.exe]
//     [--edits 300] [--burst 20] [--cpu 1] [--json out.json]
//
// --edits: single edits with a pause (one compile each); --burst: keystrokes
// typed without pause (debounce, latest wins: one compile at the end).

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = parseArgs(process.argv.slice(2));
const exe = path.resolve(args.exe ?? 'target/release/maatwerk.exe');
const dataDir = path.resolve(required('data'));
const pin = args.pin ?? '12345';
const edits = Number(args.edits ?? 300);
const burst = Number(args.burst ?? 20);
const port = Number(args.port ?? 9334);

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i += 2) out[list[i].replace(/^--/, '')] = list[i + 1];
  return out;
}

function required(name) {
  if (!args[name]) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return args[name];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Working set of the app process in MiB (Windows). */
function workingSetMiB(pid) {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
    { encoding: 'utf8' },
  );
  return Math.round(Number(out.trim()) / 1048576);
}

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await sleep(200);
    }
  }
  throw new Error('WebView2 DevTools port did not open');
}

async function appPage(browser) {
  for (let i = 0; i < 100; i++) {
    const page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url() !== 'about:blank');
    if (page) return page;
    await sleep(200);
  }
  throw new Error('no app page');
}

async function login(page) {
  await page.locator('.subject-card[data-subject="nat"]').click();
  await page.locator('.user-badge.badge-circle[data-user-id]').first().click();
  const first = page.locator('#pin-new');
  const again = page.locator('#pin-input');
  await first.or(again).waitFor();
  if (await first.isVisible()) {
    await first.fill(pin);
    await page.locator('#pin-repeat').fill(pin);
  } else {
    await again.fill(pin);
  }
  await page.locator('#pin-ok').click();
  await page.locator('#topbar:not(.hidden)').waitFor();
}

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, median: q(0.5), p90: q(0.9), max: v[v.length - 1] };
}

// The editor autosaves: work on a copy, so every run starts from the same opdracht.
const runDir = fs.mkdtempSync(path.join(path.dirname(dataDir), 'editor-run-'));
fs.cpSync(dataDir, path.join(runDir, 'data'), { recursive: true });

const child = spawn(exe, [], {
  env: {
    ...process.env,
    MAATWERK_DATA_DIR: path.join(runDir, 'data'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: 'ignore',
});

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

try {
  const browser = await connect();
  const page = await appPage(browser);
  await page.waitForLoadState('load');
  await login(page);
  await page.locator('.nav-btn[data-screen="opdrachten"]').click();
  await page.locator('[data-action="open-editor"]').first().click();
  const frameEl = page.frameLocator('#editor-frame');
  const opened = Date.now();
  await frameEl.locator('.svg-page').first().waitFor({ timeout: 60_000 });
  const firstPreviewMs = Date.now() - opened;
  const frame = page.frames().find((f) => f.url().includes('editor.html'));
  if (args.cpu) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(args.cpu) });
  }

  // Record every update with its arrival time, in the editor frame.
  await frame.evaluate(() => {
    window.__updates = [];
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'maatwerk-editor-update') {
        const u = e.data.update;
        window.__updates.push({
          t: performance.now(),
          generation: u.generation,
          ok: u.ok,
          pages: u.pages.length,
          pageCount: u.pageCount,
          compileMs: u.compileMs,
          renderMs: u.renderMs,
          errors: u.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message),
          vragen: u.vragen && { n: u.vragen.items.length, total: u.vragen.totalPunten },
        });
      }
    });
  });
  const updates = () => frame.evaluate(() => window.__updates);
  const now = () => frame.evaluate(() => performance.now());
  /** Waits for the first update that arrived after `since`. */
  async function nextUpdate(since, timeout = 30_000) {
    const end = Date.now() + timeout;
    for (;;) {
      const u = (await updates()).find((x) => x.t > since);
      if (u) return u;
      if (Date.now() > end) throw new Error('no editor update');
      await sleep(10);
    }
  }

  const content = frameEl.locator('.cm-content');
  // Type inside the rendered content (render_uitleg), not at the end of the module, whose
  // top-level text main.typ never shows.
  await content.locator('.cm-line', { hasText: 'render_uitleg' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const memory = [{ edits: 0, mib: workingSetMiB(child.pid) }];

  // Single edits: keystroke -> update.
  const latency = [];
  const compile = [];
  const render = [];
  for (let i = 1; i <= edits; i++) {
    const t0 = await now();
    await page.keyboard.type(i % 10 === 0 ? '\n' : 'x');
    const u = await nextUpdate(t0);
    latency.push(Math.round(u.t - t0));
    compile.push(u.compileMs);
    render.push(u.renderMs);
    if (i % 50 === 0) memory.push({ edits: i, mib: workingSetMiB(child.pid) });
    await sleep(200);
  }

  // A burst: only the last generation's result counts; nothing goes back.
  const tb = await now();
  await page.keyboard.type('y'.repeat(burst), { delay: 15 });
  await sleep(1500);
  const burstUpdates = (await updates()).filter((u) => u.t > tb);
  const gens = burstUpdates.map((u) => u.generation);
  check(
    'burst: generations only go up',
    gens.every((g, i) => i === 0 || g > gens[i - 1]),
    `${burstUpdates.length} updates for ${burst} keys`,
  );

  // A syntax error: diagnostics, the preview stays.
  const pagesBefore = await frameEl.locator('.svg-page').count();
  let t = await now();
  await page.keyboard.type('\n#opgave[');
  let u = await nextUpdate(t);
  check('syntax error reported', !u.ok && u.errors.length > 0, u.errors[0]);
  check('preview kept on error', (await frameEl.locator('.svg-page').count()) === pagesBefore);
  await frameEl.locator('.cm-lintRange-error').first().waitFor({ timeout: 5000 });
  check('lint underline shown', true);
  t = await now();
  await page.keyboard.type('#vraag(punten: 3, antwoord: [Ja])[Klopt het?]]');
  u = await nextUpdate(t);
  check('fixed again', u.ok, `vragen ${JSON.stringify(u.vragen)}`);

  // Autocomplete from typst-ide.
  await page.keyboard.type('\n#tab');
  const option = frameEl.locator('.cm-tooltip-autocomplete li', { hasText: 'table' }).first();
  const completed = await option
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check('autocomplete offers table', completed);
  await page.keyboard.press('Escape');
  // `#tab` alone does not compile; jumps need a document of the current text (review 8a n7).
  t = await now();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  u = await nextUpdate(t);
  check('compiles again after removing #tab', u.ok, u.errors[0]);

  // Preview -> source: a click on the first page's text moves the cursor there
  // (another line, or the tab of the file the text comes from, e.g. main.typ).
  await sleep(500);
  const where = async () => ({
    line: await frameEl.locator('.cm-activeLine').first().textContent(),
    tab: await frameEl.locator('.file-tab.active').textContent(),
  });
  const before = await where();
  const target = frameEl.locator('.svg-page').first().locator('svg use, svg path').nth(5);
  await target.click({ force: true });
  await sleep(800);
  const after = await where();
  check(
    'preview click moves the cursor',
    after.line !== before.line || after.tab !== before.tab,
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );

  memory.push({ edits: 'end', mib: workingSetMiB(child.pid) });
  const result = {
    firstPreviewMs,
    latency: stats(latency),
    compileMs: stats(compile),
    renderMs: stats(render),
    memory,
    checks,
  };
  console.log(`first preview after opening: ${firstPreviewMs} ms`);
  console.table({ latency: result.latency, compile: result.compileMs, render: result.renderMs });
  console.table(memory);
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(result, null, 2));
  // Leave without saving the test edits to the fixture: the folder is a temp copy anyway.
  await browser.close().catch(() => {});
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} finally {
  child.kill();
  await sleep(1000);
  fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5 });
}
