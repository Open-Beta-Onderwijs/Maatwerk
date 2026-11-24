# Performance notes

Measurements that decisions rest on. Synthetic data only.

## Opdracht batch memory (Step 5b, ADR-0002 section 5a "Limits")

Question: a class batch keeps every compiled job until the merge. Does it need a cap on
parallelism?

Setup: `cargo run --release -p maatwerk-core --example batch_memory -- <students> <workers>` on
the tiny fixture's opdrachten (`crates/maatwerk-core/tests/fixtures`). Every student gets two
opdrachten (the images one, 2 pages, and the 3-page one), duplex. Peak working set polled from
PowerShell every 50 ms (`Process.PeakWorkingSet64`). Windows 11, 16 logical CPUs, system fonts
on, 2026-10-28.

| Students | Jobs | Workers     | Pages | Merged PDF | Time  | Peak working set |
| -------- | ---- | ----------- | ----- | ---------- | ----- | ---------------- |
| 30       | 60   | 1           | 179   | 2.0 MiB    | 1.3 s | ~109 MiB         |
| 30       | 60   | 4 (default) | 179   | 2.0 MiB    | 0.5 s | ~118 MiB         |
| 60       | 120  | 4 (default) | 359   | 4.0 MiB    | 1.1 s | ~153 MiB         |

Findings:

- Each job keeps only its PDF bytes until the merge (~35 KiB per job here); the laid-out document
  is dropped right after export. Memory grows with the PDFs and Typst's memoisation cache, not
  with the number of workers.
- Students with the same opdracht differ only in the header, so Typst's memoisation (comemo)
  reuses most of the work; the time per job falls well below a cold compile. The cache is
  trimmed after every compile (`comemo::evict(10)`, as the Typst CLI does).
- **Decision:** no cap beyond the reference's `max(2, min(4, cpus - 1))`. Revisit if teachers'
  opdrachten with many large images show otherwise (images are embedded once per job PDF).

Not measured yet: the Tauri process as a whole (Step 6), and opdrachten with large photos.

## Perceived speed (Step 7c)

Budget (PLAN Step 7c): tab switch and score-modal open < 100 ms on the `school` fixture and on
a real copy (500+ students).

### How it is measured

- The UI records spans as `performance.measure` entries named `mw:*` (`ui/src/utils/perf.ts`):
  `tab:<screen>` from the nav click to the first paint after the render, `modal:scores` from
  "Scores invoeren" to the first paint with the grids (all grids in the baseline; the first
  group grid since the staged build, see below), `scores:read|compute|dom` per group grid,
  `menu:exam`, and the background fills after a render (`leerlingen:checks`, `groepen:stats`,
  `toetsen:stats`). They show in the DevTools Performance panel too.
- `node tools/perf/measure.mjs --data <dir>/shared/data` (the data folder itself) starts the release exe on that folder with the
  WebView2 DevTools port open, logs in through the UI, switches the tabs 5 times, opens 4 score
  modals 5 times, and prints median / p90 / max per span plus the main thread's long tasks.
  `--cpu 4` throttles the webview 4x (CDP), as a stand-in for a school laptop; `--admin 1`
  logs in as the admin.
- Data: `node tools/fixtures/generate.mjs school <dir>/shared/data`, then
  `maatwerk-cli migrate --apply --backup-dir <dir>/backups <dir>/shared/data` (600 students,
  4 vakken, 2 years). The real copy is measured by the user, outside the repo.
- Machine: Windows 11, 16 logical CPUs, release build, 2026-10-31. Times in ms.

### Baseline (before any change)

Teacher (nat), 600 students shown on Leerlingen:

| Span                 | 1x median | 1x p90 | 4x median | 4x p90 |
| -------------------- | --------- | ------ | --------- | ------ |
| tab:leerlingen       | 33        | 185    | 153       | 1176   |
| leerlingen:dom       | 4         | 6      | 20        | 27     |
| leerlingen:checks    | 13        | 289    | 56        | 1963   |
| tab:groepen          | 10        | 19     | 44        | 90     |
| tab:toetsen          | 13        | 24     | 61        | 101    |
| toetsen:stats        | 9         | 10     | 40        | 47     |
| tab:observaties      | 6         | 9      | 13        | 40     |
| tab:opdrachten       | 16        | 23     | 44        | 97     |
| modal:scores         | 41        | 73     | 209       | 367    |
| scores:dom (1 group) | 3         | 4      | 15        | 22     |
| scores:read (1 grp)  | 0.1       | 0.3    | 0.4       | 1.4    |

Long tasks at 4x: 65, 7.7 s in total, the longest 905 ms (first Leerlingen after login: 600
delete checks, each a `querySelector` over all cards).

Admin at 4x: tab:leerlingen 345 / 1339 (dom 62: every card has edit and delete buttons;
checks read all years x vakken), tab:groepen 144 / 196, tab:gebruikers 28 / 92.

Findings:

- **Reading is not the cost.** Score files are read once and cached; `scores:read` is below
  2 ms even throttled. No disk cache (PLAN: only if reading is the cost).
- Every tab visit re-renders from scratch, also when nothing changed: that is most of the
  repeat-visit time.
- The score modal spends little in JS (`scores:dom` x 4 groups); the rest is style, layout
  and paint of four full grids in one frame, plus a forced layout per grid.
- Closing the score modal re-renders the Toetsen list (and its statistics) every time.

### What changed (Step 7c)

1. **Kept screens.** Leerlingen, Groepen, Toetsen, Observaties, Opdrachten and Gebruikers keep
   their DOM between visits. `navigateTo` renders again only when the view key changed:
   `Store.generation()` (grows on own writes, deletes and colleagues' data changes; not on
   reads, not on presence), the filter bar, the user, role and vak. Closing the score modal
   redraws the exam list only when something was saved.
2. **Long lists.** Leerlingen renders the first 60 cards at once and the rest in idle slices
   (`ui/src/utils/idle.ts`), with one delegated click handler. The delete checks run only for
   the admin (teachers have no delete button) and apply through a map instead of one
   `querySelector` per student. Cards use `content-visibility: auto`, so showing the screen
   does not lay out cards out of view. No full virtualisation: not needed at these numbers.
3. **One read per score folder.** New command `read_json_dir` (`Storage::read_all_json_named`):
   `Store.preloadScores` reads a year's `scores/<vak>/` in one call instead of one call per
   student; newer cached records are kept, absent files are cached as absent, and a single
   read waits for a folder read in flight. Used before the statistics of Toetsen and Groepen
   and before the admin's delete checks (8 calls instead of 4800).
4. **Memoised grades.** `Store.examResults` is memoised per (score record, exam) identity: a
   changed record or exam is a new object in the cache.
5. **Score modal.** The first group grid is built at once, each further group in idle time; a
   waiting group reads its records right before it is built. When an exam menu opens, the
   first group is prebuilt off-screen (`.sc-prebuild`); "Scores invoeren" moves it into the
   modal. No presence is written before the modal opens; a prebuild is used only if
   `Store.generation()` did not change since it started and is dropped after 15 s.

Decisions from the measurements:

- No disk cache in `%LOCALAPPDATA%`: the disk was never the cost. The cost was one IPC call per
  file (seconds at 4x for 600-4800 calls), solved with one call per folder.
- The first prebuild version built all groups ahead. At 4x that made the modal slower (126 ms
  median instead of 65 ms): moving four finished grids into the modal lays out all four in its
  first frame. Only the first group is prebuilt now.

### After (same machine and data, 2026-10-31)

Teacher (nat), 600 students:

| Span            | 1x median | 1x p90 | 4x median | 4x p90 | 4x before (median / p90) |
| --------------- | --------- | ------ | --------- | ------ | ------------------------ |
| tab:leerlingen  | 15        | 21     | 39        | 96     | 153 / 1176               |
| tab:groepen     | 5         | 16     | 19        | 69     | 44 / 90                  |
| tab:toetsen     | 6         | 25     | 14        | 113    | 61 / 101                 |
| tab:observaties | 6         | 9      | 11        | 39     | 13 / 40                  |
| tab:opdrachten  | 5         | 22     | 17        | 79     | 44 / 97                  |
| modal:scores    | 10        | 14     | 48        | 70     | 209 / 367                |

Long tasks at 4x: 12, 0.9 s in total, the longest 120 ms (before: 65, 7.7 s, 905 ms). At 1x:
none. The teacher's delete checks (1.9 s at 4x before) are gone; the exam statistics run once
per visit instead of after every score-modal close (26 times in the run before, 1 now).

Admin at 4x: tab:leerlingen 55 / 217 (before 345 / 1339), leerlingen:checks 575 (before 2192),
tab:groepen 42 / 154 (before 144 / 196), tab:gebruikers 14 / 62.

Budget (< 100 ms): met at 1x everywhere. At 4x every median is within budget; the p90s above
100 ms are the **first** visit of a tab after login (Toetsen 113, admin Leerlingen 217, admin
Groepen 154), where the first folder reads and statistics run. Still to measure: the user's
real copy (`docs/manual-test.md` M-PERF-1).

After the review fixes (three more runs at 4x, same build): medians stable (modal:scores 50-53,
tabs 11-64, admin Leerlingen 51-64); the first-visit p90s move between runs (admin Leerlingen
252-320, admin Groepen 130-290, Toetsen 63-113); long tasks 1.0-3.2 s in total per run, the
longest 123-184 ms; admin delete checks 0.6-0.8 s (one run right after a build: 4.2 s, not
repeated). The teacher's run reads the score folder once instead of twice (review M3). Single
first-visit samples at 4x vary by a factor of two: compare medians.

Read the modal numbers with care (review 7c m1): after the change `modal:scores` ends when the
**first** group is painted (the others follow in idle time), and the script pauses 300 ms in the
exam menu (`--menu-ms`), so the prebuild runs before the span starts. "209 -> 48 ms" is what a
teacher waits for the first rows, not the cost of all grids; `menu:exam` (median 2-3 ms at 4x)
covers the menu itself. The Toetsen p90 at 4x is 113 ms against 101 before: its first visit now
also waits for the score folder read.

## Live editor compile (Step 8a)

Question: is a long-lived `EditorSession` fast enough to compile on (almost) every key, and does
it grow during a long editing session?

Setup: `cargo run --release -p maatwerk-core --example editor_latency -- <typ file> <edits>` on
the tiny fixture's opdrachten (`crates/maatwerk-core/tests/fixtures`) with the preview inputs
(placeholder header, cursor marker). Every edit types one more character into the second
paragraph (page 1) and compiles; the one-shot column renders the **first 50** of those edits
with a fresh World and every page, as `render_assignment_svg` does per compile today. Peak
working set polled from PowerShell every 50 ms; it covers the whole run, one-shot part included,
and runs differ by tens of MiB, so it shows the absence of growth, not a precise footprint. Windows 11, 16 logical
CPUs, system fonts on, 2026-10-31. Times in ms (median / p90 / max).

| Opdracht            | Edits | Cold (layout + SVG) | Layout     | SVG of changed pages | Session total | Pages sent | One-shot total | Peak working set |
| ------------------- | ----- | ------------------- | ---------- | -------------------- | ------------- | ---------- | -------------- | ---------------- |
| `…203.typ`, 3 pages | 200   | 65 + 28             | 4 / 5 / 6  | 14 / 16 / 21         | 20 / 22 / 29  | 1 / 1 / 2  | 40 / 44 / 73   | ~80 MiB          |
| `…203.typ`, 3 pages | 2000  | 60 + 24             | 5 / 6 / 9  | 14 / 16 / 29         | 20 / 23 / 45  | 1 / 1 / 2  | 33 / 37 / 57   | ~57 MiB          |
| `…204.typ`, 4 pages | 200   | 54 + 39             | 4 / 5 / 7  | 14 / 16 / 21         | 19 / 22 / 43  | 1 / 1 / 2  | 62 / 69 / 150  | ~55 MiB          |
| `…204.typ`, 4 pages | 2000  | 55 + 40             | 4 / 6 / 30 | 11 / 14 / 27         | 17 / 21 / 52  | 1 / 1 / 2  | 37 / 43 / 50   | ~61 MiB          |

Findings:

- Incremental layout is ~4 ms; the SVG of the one changed page is most of the cost. Sending only
  changed pages halves the time against a full render and keeps the IPC payload to one page.
- Memory does not grow with the number of edits (the 2000-edit runs peak no higher than the
  200-edit runs): the World holds only the files Typst asked for (unit test
  `a_long_session_holds_no_more_files`), and comemo is evicted after every compile.
- comemo's cache is process-wide and `evict(10)` counts compiles of any kind, so a batch running
  next to the editor ages the editor's entries out; the editor may then fall back to near-cold
  compiles (~60 ms layout) until the batch ends (review 8a m2, backlog).
- **Budgets** (this machine, release build, 3-4 page opdracht): an edit compile (layout + SVG of
  the changed pages) **< 50 ms p90**; the opening compile **< 200 ms**; peak memory flat over
  2000 edits. With `DEFAULT_DEBOUNCE` (150 ms) the preview follows ~170 ms after the last key
  (the old editor: 600 ms autosave delay, then a Typst CLI process per compile). Step 8b measures
  the end-to-end latency in the app, IPC and DOM included.

Not measured yet: opdrachten with large photos (the SVG embeds images as data URIs, so a changed
page with a photo costs its base64 again), and school laptops.

## Live editor in the app (Step 8b)

`node tools/perf/editor.mjs --data <dir>\shared\data --edits 300` on the release exe (2026-11-01,
`school` fixture migrated to v2, first opdracht of `nat`, this dev machine, CPU unthrottled). The
script works on a copy of the folder (the editor autosaves), types into `render_uitleg` (rendered
content) and times each keystroke until the `editor:update` with that generation arrives in the
editor iframe.

| Measure                                  | Median | p90    | Max    |
| ---------------------------------------- | ------ | ------ | ------ |
| Keystroke -> preview patched (300 edits) | 182 ms | 185 ms | 202 ms |
| `compileMs` (layout, incremental)        | 1 ms   | 2 ms   | 2 ms   |
| `renderMs` (changed pages to SVG)        | 0 ms   | 1 ms   | 1 ms   |
| Editor opened -> first preview           | 432 ms |        |        |

The latency is almost all the 150 ms debounce (`DEFAULT_DEBOUNCE`) plus the IPC hops (Rust ->
main window -> editor iframe). A burst of 20 keystrokes gave one compile of the last text.
**Memory** (working set of `maatwerk.exe`, Typst runs in it): 56 MiB at the start, 59-60 MiB
after 50-300 edits, no growth trend. The webview processes are not included.

Checks the script also makes against the real Typst path (all passed): a syntax error is reported
and underlined and the preview stays; `typst-ide` autocomplete offers `table`; a click in the
preview moves the cursor (the header text leads into `lib.typ`).

**m2 (comemo shared with batch compiles):** not seen in this measurement: a single editor session
compiles in 1-2 ms after every edit. A batch run while the editor is open would evict the
editor's cache once (the next edit then costs about one full compile, ~300-400 ms here). Kept in
the backlog; measure again with a large opdracht if teachers notice it.

### Without the compile debounce (2026-11-01, `0.3.0-rc.1`)

User decision: no compile delay; new errors are shown after 500 ms without typing (ADR-0002
section 12). Same script, data and machine:

| Measure                                  | Median | p90   | Max    |
| ---------------------------------------- | ------ | ----- | ------ |
| Keystroke -> preview patched (300 edits) | 61 ms  | 83 ms | 210 ms |
| `compileMs`                              | 4 ms   | 5 ms  | 7 ms   |
| `renderMs`                               | 1 ms   | 3 ms  | 5 ms   |
| Editor opened -> first preview           | 280 ms |       |        |

A burst of 20 keystrokes (15 ms apart) now gives 18 compiles instead of one, each of a newer text
(generations only go up). Memory: 55 MiB at the start, 58-60 MiB from 50 to 300 edits, flat.

## Cutover readiness (Step 10, 2026-11-03)

### Batch of 200 PDFs

`batch_memory` example (release), 100 students x 2 opdrachten = 200 jobs, 4 workers, duplex,
peak working set polled every 50 ms: **599 pages, 5.0 MiB merged PDF, 1.9 s, peak 171 MiB**
(60 students: 1.1 s, ~153 MiB in Step 5b). Memory still grows with the PDFs only; no cap needed.

### `school` fixture in the release exe

`tools/perf/measure.mjs` on the migrated `school` fixture (teacher nat, 600 students), release
exe built from `step/10-cutover-readiness` (`4466a7f` + docs), same machine as Step 7c.

| Span            | 1x median | 1x p90 | 4x median (2 runs) | 4x p90 (2 runs) | 4x in Step 7c |
| --------------- | --------- | ------ | ------------------ | --------------- | ------------- |
| tab:leerlingen  | 21        | 38     | 133 / 110          | 152 / 178       | 39 / 96       |
| tab:groepen     | 10        | 35     | 51 / 48            | 221 / 246       | 19 / 69       |
| tab:toetsen     | 10        | 50     | 55 / 54            | 290 / 312       | 14 / 113      |
| tab:observaties | 8         | 29     | 35 / 42            | 112 / 138       | 11 / 39       |
| tab:opdrachten  | 10        | 54     | 45 / 69            | 229 / 191       | 17 / 79       |
| modal:scores    | 24        | 44     | 137 / 128          | 215 / 236       | 48 / 70       |

Long tasks: 1x one (57 ms); 4x 154-161, 16.5 s in total, the longest 411-443 ms.

**Budget (< 100 ms):** met at 1x everywhere; at 4x not met in these runs.

**Cause investigated (2026-11-03): not a regression.** The `step-07c` exe, built from its tag
in a worktree, measured alternately with the `step-10` exe on the same fixture with the same
script (unchanged since 7c), 4x, two runs each:

| Exe      | modal:scores median | scores:dom median | tab:leerlingen median | long tasks total |
| -------- | ------------------- | ----------------- | --------------------- | ---------------- |
| step-07c | 122 / 131           | 51 / 49           | 124 / 110             | 17.3 / 17.7 s    |
| step-10  | 129 / 136           | 53 / 50           | 113 / 120             | 18.1 / 17.9 s    |

Both are equally slow, so the difference with the Step 7c table is the environment, not the
code: the laptop ran **on battery** (Win32_Battery status "discharging", 51 %, power plan
Balanced) during all Step 10 runs; the Step 7c baseline was presumably taken on mains power.
The JS of the measured screens (scores, store, app, score grid) did not change since 7c.
WebView2 runtime here: 156.0.4314.58. To confirm: repeat on mains power (expected: back to the
Step 7c numbers). For the cutover, M-PERF-1/2 on a school laptop (also on battery) is the
relevant check.

## Perf hotfix 0.24.1 (step 33b, 2026-11-20)

User report: the first visit of some tabs, Toetsen most of all, is slow. Setup as in Step 7c:
`school` fixture (600 students, migrated), teacher nat, release exe, Windows 11, 16 logical
CPUs; `tools/perf/measure.mjs --cpu 4|1 --runs 3 --exams 2` (fixed in this step: login and
dialog selectors; new `first` column = first visit after login). One run each, back to back, same
machine; single samples vary (Step 7c), the long-task totals are the clearest signal.
Function-level profiles came from `npm run dev:mock` with `MAATWERK_FIXTURE=school` in Chromium
(the release bundle is minified).

### Causes

1. **Leerlingen swap sync.** Each card's "laatste / SE" swap was a CSS animation; the app set its
   `startTime` through `el.getAnimations()` per card, between the writes that fill the cards.
   Every call computed style for the list: ~10-12 s of a 4x profile, running in the background
   right after login and competing with whatever tab was opened next. Batched per frame it was
   still ~12 s (per element it computes the style of off-screen and hidden cards one by one), and
   `document.getAnimations()` leaves out off-screen cards (`content-visibility: auto`).
2. **Statistics before the first paint.** Toetsen and Groepen awaited cached score reads; those
   resolve as microtasks, so all statistics ran as one task before the browser could paint the
   cards.
3. **One grade-rules call per student per attempt.** ~5,400 calls into WebAssembly for 8 nat exams;
   each call serialised the exam with all its questions (JSON, `TextEncoder`, serde).

### Changes

- One clock for the swap (`cards/swap-clock.ts`): `data-card-swap` on `<html>` flips every 4,5 s,
  the cards cross-fade in CSS (same timing as before). No per-card work at all.
- Toetsen paints its cards first (`afterPaint`) and fills the numbers in 8 ms slices
  (`utils/idle.ts` `yieldSlice`); Groepen fills its groups in slices too.
- `examResults` / `bestAttempt` skip the rules for a record without scores or an override for
  the exam (the rules answer null without computing). New batch calls `examResultsMany` /
  `bestAttemptMany` in `maatwerk-grades-wasm` (no rule changed; equal to the single calls, tested
  in Rust and Vitest); Toetsen calls them per 60 students.

### Before (0.24.0) and after (0.24.1)

`first / median` in ms.

| Span                | 4x before  | 4x after   | 1x before  | 1x after |
| ------------------- | ---------- | ---------- | ---------- | -------- |
| tab:leerlingen      | 264 / 121  | 242 / 127  | 56 / 17    | 92 / 32  |
| leerlingen:grades   | 31972      | 7251       | 12616      | 839      |
| leerlingen:rest     | 40829      | 7487       | 93         | 150      |
| tab:groepen         | 192 / 116  | 142 / 106  | 32 / 32    | 53 / 28  |
| groepen:stats       | 2175       | 8708       | 324        | 1240     |
| tab:toetsen         | 1918 / 107 | 266 / 114  | 367 / 59   | 74 / 45  |
| toetsen:stats       | 1750       | 1115       | 338        | 140      |
| modal:scores        | 189 / 171  | 164 / 108  | 50 / 23    | 24 / 27  |
| long tasks (n, sum) | 80, 49 447 | 78, 12 228 | 11, 12 952 | 5, 325   |
| longest task        | 7418       | 672        | 4578       | 79       |

Findings:

- At 1x the main thread is free again: 0.3 s of long tasks instead of 13 s, the longest 79 ms
  instead of 4,6 s. The first Toetsen visit is within the 100 ms budget at 1x (74 ms) and 266 ms
  at 4x (was 1,9 s).
- `groepen:stats` takes longer in wall time (324 -> 1240 ms at 1x): it now yields and shares the
  main thread with the Leerlingen fill that runs right after login. It no longer blocks a paint or
  input (`tab:groepen` stays within budget). The background fills as a whole are the next target:
  backlog "Grade cache" (from the perf hotfix 0.24.1).
- The synthetic fixture gives every student scores in every exam of the vak, so the "skip empty
  records" change hardly shows here; on real data (an exam per jaarlaag) it skips most calls.
- Not measured: WebKit (macOS, Linux) and the user's real copy (M-PERF-1).

### After the review fixes (review 33b, same day)

Review 33b m3: `yieldSlice` yielded with `setTimeout(0)` (>= 4 ms clamp once nested, throttled in
a hidden window). First replaced by `scheduler.yield()`: the first Toetsen visit at 1x went 74 ->
310 ms, because a `scheduler.yield()` continuation goes ahead of other queued tasks, so the app's
own timers (and the span's `afterPaint`) waited for the whole background fill. Now a
`MessageChannel` message: no clamp, no queue-jumping. Also: Toetsen fills test by test in reading
order and stops after a redraw (m1, n2); Groepen stops after a redraw (m2).

`first / median` in ms; "1x (a)" was the first run after the build, "1x (b)" the next one.

| Span              | 4x      | 1x (a) | 1x (b) |
| ----------------- | ------- | ------ | ------ |
| tab:leerlingen    | 197/115 | 38/17  | 34/34  |
| leerlingen:grades | 3916    | 5075   | 662    |
| leerlingen:rest   | 4379    | 65     | 50     |
| tab:groepen       | 141/99  | 21/21  | 62/39  |
| groepen:stats     | 4225    | 3482   | 1031   |
| tab:toetsen       | 261/116 | 40/47  | 76/35  |
| toetsen:stats     | 1668    | 1956   | 189    |
| modal:scores      | 160/121 | 70/50  | 63/37  |
| long tasks, sum   | 8273    | 629    | 445    |
| longest task      | 265     | 89     | 82     |

The background fills' wall times move a lot between runs (they yield to everything else; run
(a) was right after a build, probably a cold start); the long tasks do not: at 1x no task over
~90 ms, at 4x none over ~270 ms (0.24.0: 4,6 s and 7,4 s).

## Grade numbers in Rust (step 38, 2026-11-24)

Step 38 moved the list screens' numbers (Leerlingen, Groepen and Toetsen cards, Groepsoverzicht,
Profiel) to one native call per year and vak (`maatwerk_core::numbers`, command `vak_numbers`)
and took the small wins of backlog "Grade cache" (WASM parses once, history map, `yieldSlice`,
topbar fit in the next frame). Measured as in 0.24.1: `school` fixture (600 students, migrated),
teacher nat, release exe, Windows 11, 16 logical CPUs, `tools/perf/measure.mjs --runs 3
--exams 2`. "Before" is the 0.28.0 release exe, "after" this branch at `143e0de`; each on its
own copy of the same migrated data, back to back. At 4x both builds ran twice (a / b).

`first / median` in ms; a background fill has one sample.

| Span                | 4x before (a / b)   | 4x after (a / b)    | 1x before | 1x after |
| ------------------- | ------------------- | ------------------- | --------- | -------- |
| tab:leerlingen      | 168/77 · 171/77     | 152/70 · 158/66     | 32/15     | 29/14    |
| leerlingen:grades   | 3238 · 3231         | 908 · 923           | 644       | 341      |
| leerlingen:rest     | 3448 · 3481         | 562 · 572           | 64        | 58       |
| tab:groepen         | 93/53 · 94/45       | 137/48 · 112/46     | 17/13     | 22/9     |
| groepen:stats       | 2943 · 2953         | 6 · 4               | 324       | 1        |
| tab:toetsen         | 175/72 · 185/70     | 247/73 · 198/79     | 42/15     | 45/14    |
| toetsen:stats       | 1230 · 1158         | 180 · 379           | 112       | 43       |
| modal:scores        | 84/75 · 87/71       | 89/76 · 86/72       | 17/14     | 17/14    |
| long tasks (n, sum) | 50, 5505 · 52, 5535 | 31, 2634 · 34, 2790 | 0, 0      | 0, 0     |
| longest task        | 226 · 238           | 223 · 179           | 0         | 0        |

Findings:

- The background fills are 3-700x shorter: Groepen's statistics are a lookup now (2,9 s -> 5 ms
  at 4x), the Leerlingen grades 3,2 s -> 0,9 s, the Toetsen statistics 1,2 s -> 0,2-0,4 s. At 4x
  the long tasks halve (5,5 s -> 2,7 s in total); the longest stays ~200 ms (not profiled).
- The first visits stay within the 0.24.1 range; at 1x all are under 50 ms. The first Toetsen
  visit at 4x reads 200-250 ms against 175-185 ms before: within the run-to-run spread seen in
  0.24.1 (141-266 ms); Groepen 112-137 ms against 93-94 ms likewise. Neither cause is profiled yet.
- The synthetic fixture gives every student scores in every exam of the vak (worst case); real
  data has far fewer graded records per exam. Not measured: WebKit (macOS, Linux) and the
  user's real copy (M-PERF-1, the user runs it).
- A disk cache (backlog "Grade cache" part 2) is not needed for now (user, 2026-11-24): it stays
  "After 1.0".

**Why Groepen went to milliseconds and Leerlingen did not** (user's question). The three screens
share one `vak_numbers` call per year and vak, cached per data generation
(`services/vak-numbers.ts`). The script visits Leerlingen first, so Leerlingen pays for the call
and Groepen, visited next, gets the cached result: `groepen:stats` now times only writing the
group cards (in 0.28.0 it computed every group's statistics itself in WebAssembly). The cost
moved, it did not vanish. `leerlingen:grades` (~0,9 s at 4x) holds:

1. `Store.loadYear` (the exams that name the bars; `store:readDir` alone is 200-300 ms at 4x);
2. the native call: `maatwerk-cli numbers` on the same data takes ~240 ms (process start and
   file reads included; the CPU throttle does not apply to Rust), and its answer is ~690 KB of
   JSON that the webview parses;
3. 600 cards' HTML, built in ~8 ms slices that share the main thread with `leerlingen:rest`
   (the other cards' DOM, built at the same time).

A Groepen visit before Leerlingen would show the call's cost in `groepen:stats` instead.
