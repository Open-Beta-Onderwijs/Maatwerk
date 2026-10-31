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
  "Scores invoeren" to the first paint with all grids, `scores:read|compute|dom` per group grid,
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
