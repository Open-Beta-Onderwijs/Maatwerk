// SPDX-License-Identifier: AGPL-3.0-or-later
// Perceived-speed measurement on the real app (Step 7c, docs/perf.md).
//
// Starts the built exe on a data folder with WebView2's DevTools port open,
// logs in through the UI like a teacher, switches tabs and opens score modals,
// and reports the `mw:*` spans the UI records (ui/src/utils/perf.ts) plus the
// main thread's long tasks. Synthetic data only: use the `school` fixture
// (migrated to v2) or a copy of real data outside the repo.
//
//   node tools/perf/measure.mjs --data <dir> [--exe target/release/maatwerk.exe]
//     [--subject nat] [--user <id> | --admin 1] [--pin 12345] [--runs 5] [--exams 4]
//     [--tabs leerlingen,groepen,...] [--cpu 4] [--menu-ms 300] [--json out.json]
//
// --cpu N slows the webview's CPU N times (CDP throttling), a stand-in for a
// school laptop. --menu-ms is the pause between opening an exam menu and
// choosing "Scores invoeren" (a person moving the mouse; the grids are prebuilt
// meanwhile). The admin has no score modal: use --exams 0.
// The login PIN is chosen at the first login if the user has none yet.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = parseArgs(process.argv.slice(2));
const exe = path.resolve(args.exe ?? 'target/release/maatwerk.exe');
const dataDir = path.resolve(required('data'));
const subject = args.subject ?? 'nat';
const pin = args.pin ?? '12345';
const runs = Number(args.runs ?? 5);
const examCount = Number(args.exams ?? 4);
const port = Number(args.port ?? 9333);
const menuMs = Number(args['menu-ms'] ?? 300);
const TABS = (args.tabs ?? 'leerlingen,groepen,toetsen,observaties,opdrachten').split(',');

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

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('WebView2 DevTools port did not open');
}

async function appPage(browser) {
  for (let i = 0; i < 100; i++) {
    const page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => !p.url().includes('editor.html') && p.url() !== 'about:blank');
    if (page) return page;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('no app page');
}

async function login(page) {
  await page.locator(`.subject-card[data-subject="${subject}"]`).click();
  const badge = args.user
    ? page.locator(`.user-badge[data-user-id="${args.user}"]`)
    : page.locator(`.user-badge.${args.admin ? 'badge-square' : 'badge-circle'}[data-user-id]`);
  await badge.first().click();
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
  const codes = page.locator('#codes-kept');
  await codes.or(page.locator('#user-badge-btn:not(.hidden)')).waitFor();
  if (await codes.isVisible()) {
    await codes.check();
    await page.locator('#codes-done').click();
  }
  await page.locator('#topbar:not(.hidden)').waitFor();
}

const countOf = (page, name) => page.evaluate((n) => performance.getEntriesByName(n).length, name);

async function waitForSpan(page, name, before) {
  await page.waitForFunction(
    ([n, b]) => performance.getEntriesByName(n).length > b,
    [name, before],
    {
      timeout: 60_000,
    },
  );
}

// Waits until no new mw:* span appeared for `quietMs` (background fills done).
async function settle(page, quietMs = 500) {
  let last = -1;
  for (;;) {
    const n = await page.evaluate(() => performance.getEntriesByType('measure').length);
    if (n === last) return;
    last = n;
    await new Promise((r) => setTimeout(r, quietMs));
  }
}

async function switchTab(page, tab) {
  const name = `mw:tab:${tab}`;
  const before = await countOf(page, name);
  await page.locator(`.nav-btn[data-screen="${tab}"]`).click();
  await waitForSpan(page, name, before);
  await settle(page);
}

async function openScores(page, { id, kind }) {
  const btn = page.locator(`[data-action="exam-menu"][data-id="${id}"][data-kind="${kind}"]`);
  // Scroll first: the scroll event of Playwright's own scroll-into-view would
  // close the menu right after it opens.
  await btn.scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await btn.click();
  await page.waitForTimeout(menuMs);
  const before = await countOf(page, 'mw:modal:scores');
  await page.getByRole('menuitem', { name: 'Scores invoeren' }).click();
  await waitForSpan(page, 'mw:modal:scores', before);
  await settle(page, 300);
  await page.locator('#modal-close').click();
  await page.locator('#modal-overlay.hidden').waitFor({ state: 'attached' });
}

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, median: q(0.5), p90: q(0.9), max: v[v.length - 1] };
}

const child = spawn(exe, [], {
  env: {
    ...process.env,
    MAATWERK_DATA_DIR: dataDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: 'ignore',
});

try {
  const browser = await connect();
  const page = await appPage(browser);
  await page.waitForLoadState('load');
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  if (args.cpu) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(args.cpu) });
  }
  await login(page);
  await settle(page);
  await switchTab(page, 'leerlingen');
  const students = await page.locator('#student-list .card').count();

  for (let r = 0; r < runs; r++) {
    for (const tab of TABS) await switchTab(page, tab);
  }
  if (examCount) {
    await switchTab(page, 'toetsen');
    const examIds = await page.evaluate(() =>
      [...document.querySelectorAll('[data-action="exam-menu"][data-kind]')]
        .filter((b) => b.dataset.kind !== 'summary')
        .map((b) => ({ id: b.dataset.id, kind: b.dataset.kind })),
    );
    for (let r = 0; r < runs; r++) {
      for (const exam of examIds.slice(0, examCount)) await openScores(page, exam);
    }
  }

  const result = await page.evaluate(() => ({
    measures: performance
      .getEntriesByType('measure')
      .filter((m) => m.name.startsWith('mw:'))
      .map((m) => ({ name: m.name, duration: m.duration })),
    longTasks: window.__longTasks,
  }));
  console.log(`students shown on Leerlingen: ${students}`);
  const byName = {};
  for (const m of result.measures) (byName[m.name] ??= []).push(m.duration);
  const table = Object.fromEntries(
    Object.entries(byName).map(([k, v]) => [k, stats(v.map((d) => Math.round(d * 10) / 10))]),
  );
  console.table(table);
  const lt = result.longTasks;
  console.log(
    `long tasks: ${lt.length}, total ${Math.round(lt.reduce((a, b) => a + b, 0))} ms, max ${Math.round(Math.max(0, ...lt))} ms`,
  );
  if (args.json) fs.writeFileSync(args.json, JSON.stringify({ table, longTasks: lt }, null, 2));
  await browser.close().catch(() => {});
} finally {
  child.kill();
}
