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
- `node tools/perf/measure.mjs --data <dir>` starts the release exe on that folder with the
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
