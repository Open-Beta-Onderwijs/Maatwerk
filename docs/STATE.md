# State

Last updated: 2026-10-30 (after the Step 6 manual test) Branch: `main` Last tags: `step-06`, `v0.2.0-parity`

## Current step

Between Step 6 and Step 7, branch `fix/manual-test-6` (not merged yet). The user ran the manual
test (`docs/reviews/manual-test-step-06.md`): two failures, both fixed (M-GRP-1 quirk U21,
M-OPD-6 quirk U20 update). Full third-party notices: `THIRD_PARTY_NOTICES.txt`
(`npm run notices`, cargo-about 0.9.3, CI check). PLAN Step 7 extended to 7a/7b/7c with the
user's ideas (C16-C19, PIN, sectievoorzitter, snapshots, speed); remarks from the test are in
PLAN and the backlog.

## Step 6b summary

- Startup error screen (4b m5): commands `data_folder_status`, `restart_app`; UI
  `screens/startup-error.ts` (Dutch reason, folder, "Opnieuw proberen" = restart); quirks.spec.
- Start failure (no WebView2): main-thread panic hook + `build()` error -> Dutch `rfd` message
  box (`src-tauri/src/start_error.rs`); checked by hand with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`
  set to a missing folder (Tauri panics "Could not find the webview runtime" in the event loop).
- School logo input: six image types, Dutch toast otherwise (6a M1).
- `ui/e2e/real-pdf.spec.ts`: real rapport PDF (written by `typst_rapport`) in pdf.js under the
  CSP; CI step after `cargo test`.
- CI already built and uploaded the portable exe (since Step 0); new CI checks: no MockApi in the
  app bundle, real-PDF spec after `cargo test`.
- Docs: `docs/manual-test.md` (click-through, ids `M-…`), `docs/parity.md` complete (all 32
  handlers; manual ids linked), backlog "From Step 6b" (compat layer stays until Step 10).
- Review `docs/reviews/step-06.md`: 0 blockers, M1 (Tauri's English WebView2 box came first in
  release builds -> `wry::webview_version()` pre-check before Tauri, logging before Tauri) and
  m1-m5, n1-n9 fixed; m6, n10 in the backlog; drift notes in ADR-0002 section 11.
  `/security-review`: no findings. Release exe checked without WebView2: one Dutch box.

## Step 6a so far

- Core: `opdracht_images` (list with 48 px PNG thumbs, store/overwrite, copy, delete with
  background folder retry, empty-folder cleanup at start, clipboard RGBA -> PNG; quirk T30) and
  `outputs` (`OutputStore` in the OS cache dir under output IDs `<n>-<name>.pdf`, emptied at
  start; `print_copy` to `rapporten/<schooljaar>/<YYYY-MM-DD HHmm> <soort> <vak> <groep>
<toets>.pdf` with ` (2)` on a clash). `create_v1_opdracht_file`, `storage.write_bytes/list_dir`.
- App: commands `create_assignment_typ_file`, 7 image commands, `render_rapport_pdf`,
  `render_assignment_svg`, `render_assignment_batch` (+ `assignment:progress` event),
  `open_path` (output ID or data-relative path), `print_pdf`, `set_watch_year` (C7). Plugins
  dialog/clipboard/opener used from Rust only (no capability grants). URI scheme `maatwerk-out`
  (`scheme.rs`, CORS for the app origins). Error code `typst`. Presence offline on window
  destroy.
- UI: TauriApi complete (no stubs); `printPdf` + `setWatchYear` added to the bridge (mock too);
  print listeners use `printOutput` with `domain/print.ts` names; CSP `connect-src` has the
  scheme; pdf.js `isEvalSupported: false`; `setWatchYear` at `initSubject` and year selectors.
- Kept the current app icon (already the Maatwerk icon from the reference, step 0) instead of
  the older `_reference/build/icon.ico`; window config was already right; no splash.

## Fix between steps: bundled emoji font (`fix/emoji-font`)

- First CI run on `main` failed: `rapport_valid_matches_the_golden` p14, 1 pixel in 🥈 (the
  runner's Segoe UI Emoji differs from this machine's). User decided: bundle Noto Color Emoji now
  (PLAN section 9 decision 2) and regenerate the goldens with it.
- `assets::FONTS` + `NotoColorEmoji-COLRv1.ttf` (5 MB, OFL, `THIRD_PARTY_LICENSES.md`).
  `FontStore` drops its code points from system fonts' fallback coverage (`without_emoji`), since
  Typst's fallback preferred "Segoe UI Emoji" (shorter name). Checked: PDF (Type3 colour glyphs,
  Poppler render), SVG facts, PNG goldens with and without system fonts.
- Harness: temp `include/fonts` is a copy + Noto (junctions for the rest), PNGs with
  `--ignore-system-fonts`. Goldens regenerated: only PNG hashes/bytes changed. Tests use
  `support::fonts()` (no system fonts); tofu test uses a Tibetan icon (U+0F00).

## Step 5b summary

- `TypstProject` (`folder` for the CLI, `opdracht_v1` = virtual project: bundled `main.typ` and
  `lib.typ`, `opdracht.typ`, own `images/<id>/` only); `opdracht-main.typ` replaces the generated
  wrapper, data via `sys.inputs` `maatwerk-data` (`OpdrachtInputs`; placeholder only for preview).
- `render_assignment_pdf`, `render_assignment_svg_pages` (in memory), `render_assignment_batch`
  (workers `max(2, min(4, cpus-1))`, monotonic progress, first failure stops), `pdf_merge`
  (lopdf 0.46, duplex padding), tofu warning, `maatwerk-cli typst compile`, version lines +
  released hashes (`assets::ProjectFile`), cursor marker `__maatwerk_cursor`/`maatwerk-cursor:`.
- Parity: all opdracht/SVG/batch goldens (`tests/typst_opdracht.rs`, 24 tests); JPEG within 3
  levels; quirks T28 (1-based columns) and T29 (sandbox, v1 details). `docs/perf.md`: 30-student
  batch ~118 MiB. **Step 6 must** map Tauri args to `OpdrachtInputs`/`BatchJob` (label fallback
  `label ?? typFile`), run them in `spawn_blocking`, and call `normaliseForTypst` for the rapport.

## Step 5a summary

- `maatwerk-core::assets`: embedded `rapport.typ` (= `rtti_export.typ`, SPDX header, input
  guards), `rapport-main.typ` (entry, reads `data.json`), `lib.typ` (markers `__maatwerk_*`,
  counters `maatwerk-vraag*`), `base_assignment.typ` (unchanged); fonts Source Serif 4 (12) +
  STIX Two Math; packages zero/cetz/oxifmt/unify embedded by `build.rs` (`PACKAGE_FILES`).
- `maatwerk-core::typst_svc`: `MaatwerkWorld` (virtual files + `Mount`s behind
  canonicalise/prefix check, embedded packages only, injectable clock for `today()` and the PDF
  date), `FontStore` (template fonts, system fonts searched once via `FontStore::shared()`, then
  Typst's), `Diagnostic`/`Location`/`TraceFrame` + `to_text` (CLI-like, virtual paths only),
  `compile_document`, `compile_pdf`, `render_rapport_pdf(fonts, &RapportData, &DataDir, now)`.
- Parity: `tests/typst_rapport.rs` (12 tests) matches `rapport-one-student` and `rapport-valid`
  **pixel for pixel** (30 ppi) plus page count/sizes/text; no-watermark gives the same error.
- Quirks fixed template side: T26 (non-colour colours, non-number scores), T11/T27 (`$` guard on
  `uitleg_rtti` and leeradvies; only unescaped `$` count, review M2, also in the UI's
  `sanitizeTypstMarkup`). `rapport-markup` and `rapport-tiny` data now compile.
- Review M1: `normaliseForTypst` (UI) restores the `toTypst` values (`undefined` -> `null`,
  non-finite -> `0`) for the JSON payload. **Step 6 must call it** in `TauriApi.renderRapportPdf`.
- `deny.toml`: RUSTSEC-2026-0194/0195 (quick-xml via typst 0.14.2) ignored with reason; backlog.
- Watcher test `m1_a_failed_own_write_releases_the_file` was flaky (same-size content); test fixed,
  product edge case in the backlog.

## In progress

- Nothing.

## Next action (concrete, resumable)

1. Wait for the user's answers: PLAN section 9 decisions 12 (encryption), 13 (sectievoorzitter
   rights), 14 ("Over Maatwerk" content). Then build the "Over Maatwerk" screen on
   `fix/manual-test-6`, run the gate, merge into `main`.
2. Record the answers in ADR-0003 (C16-C19) and start Step 7a on `step/07-data-v2`.

## Open questions for the user

- PLAN section 9, decisions 12-14 (asked 2026-10-30).
- Other section 9 items: domain logic location (Step 10), versioning, macOS.

## How to resume

After the folder move, release builds also needed `cargo clean --release -p maatwerk-core -p
maatwerk-app -p maatwerk-cli` (stale build-script path). PowerShell for npm/cargo (Git Bash's
`link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). In PowerShell 5.1, commit with
`git commit -F <file>` (inline messages with quotes get split into pathspecs). `npm ci; npm run
build:ui`, then the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright
install chromium` in `ui/`). Rapport parity: `cargo test -p maatwerk-core --test typst_rapport` / `--test typst_opdracht`
(machine-independent, no system fonts; failing pages are written to
`target/tmp/golden/<case>/`). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and
the Typst packages in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is installed.
