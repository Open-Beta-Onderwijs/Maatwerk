# State

Last updated: 2026-11-01 (Step 8b) Branch: `step/08-editor` Last tags: `step-07`, `step-07c`,
`step-07b`, `step-07a`, `step-06`, `v0.2.0-parity`

## Current step

**Step 8b in progress** on `step/08-editor` (8a tagged `step-08a`; the step branch merges into
`main` at the end of Step 8).

## Step 8b plan (sub-tasks, one commit each)

1. Core `LiveEditor` v2: compile thread behind a coordinator, **watchdog** (time limit; abandoned
   thread, fresh session from a factory + the buffer overlay, Dutch error update), queries on the
   session (`LiveEditor::query`), `unset_file` (n4), `__maatwerk/` not editable;
   `instellingen.json` `editor.compileTimeoutSeconds` (`EditorSettings`), data-files-v2 doc.
2. Core IDE: `typst-ide` 0.14.2 (Apache-2.0): `IdeWorld` for `MaatwerkWorld`; session methods
   complete / tooltip / definition / jump from click / jump from cursor, UTF-16 offsets, only
   while the document matches the source (n7).
3. Core vragen: `lib.typ` v2 (adds `punten` to the `<__maatwerk_vraag>` metadata, output
   unchanged; migrate golden regenerated), `vragen(document)` -> `{opgave, label, punten,
antwoord}` + total + checks, in every ok `EditorUpdate`. Project file status + silent update of
   unmodified old `lib.typ`/`main.typ`, restore bundled version.
4. Tauri: `editor` commands (open/update/refresh/resend/close/ide queries/project files), event
   `editor:update`, timeout from `instellingen.json`; bridge + mock session.
5. UI editor on the session: file tabs (opdracht/main/lib, banner, Herstel standaardversie,
   Bekijk verschillen), `@codemirror/lint`, autocomplete, hover, Ctrl+click definition, preview
   click -> source, cursor -> preview, page patches, vragen panel; BOM strip (n8).
6. Instellingen: compile time limit field.
7. Playwright editor spec (mock session); docs (parity, perf incl. m2, manual tests, ADR); gate;
   review `docs/reviews/step-08b.md`.

Done: 1 (b98ac1d), 2 (14f8e16), 3 (56050ed). Next: 4.

## Step 8a so far

1. `typst_svc::EditorSession` (commit 4376cc4): one long-lived `MaatwerkWorld` per open
   opdracht; `set_file` (buffer in memory, incremental reparse via `Source::replace`), `reset`
   before each compile (mount folders re-resolved, disk files re-checked by mtime + length,
   missing files looked up again); `compile(generation, stale)` returns `EditorUpdate`
   (`ok`, diagnostics, `preview_generation`, `page_count`, only changed `pages` as SVG + hash,
   `compile_ms`, `render_ms`); last good document kept; `resend_all`. `LiveEditor`: worker
   thread, debounce (`DEFAULT_DEBOUNCE` 150 ms, generation 0 at once), latest generation wins
   (stale result dropped before the SVG render), panics reported as an error update, drop stops
   the thread. `Location.range_utf16` for CodeMirror. Tests: 15 in `editor::tests`, parity test
   `editor_session_patches_equal_the_one_shot_render`.
2. `examples/editor_latency.rs`, `docs/perf.md` section, parity section, ADR-0002 section 12
   (cancellation deviation: open question).
3. Review `docs/reviews/step-08a.md`: 0 blockers; M1 (cursor marker) decided in ADR-0002
   section 12 (no marker in the live session; 8b uses typst-ide jumps); m1 (sink panic), m3
   (`refresh` / `reload_disk_files`), m4, m5, m6 partly, n1 fixed; m2, m6 rest, n2-n8 in
   `docs/backlog.md` "From Step 8a".

## Step 7a result

User decisions (2026-10-30): C10 = opaque ids for _new_ exams/groups only, existing ids kept;
C9 = `"N"` instead of `null`, invalid input stays the typed string. Format spec:
`docs/reference/data-files-v2.md`; ADR-0003 has C16-C19.

Done on the branch (`step/07-data-v2`, one commit each):

1. ADR-0003 C16-C19 + C9/C10 shapes; `docs/reference/data-files-v2.md`.
2. `maatwerk-core::integrity` (C19 stamp: SHA-256 of canonical JSON without `_meta.hash`).
3. `maatwerk-core::migrate` (plan -> verified backup zip outside shared/OneDrive folder -> apply
   -> `schema_version: 2` last; resumable; blocks on unmigrated legacy data / corrupt JSON).
   Golden fixture `crates/maatwerk-core/tests/fixtures/migrate/{v1,v2}`
   (`MAATWERK_UPDATE_GOLDEN=1` regenerates v2). Error codes `needs_migration`,
   `migration_blocked`. zip 9.1.3 + sha2 0.11 (cargo deny ok, notices regenerated).
4. `maatwerk-core::validate` (validate-data: version, corrupt, stamps, placement, conflict
   copies/strays, references, images, opdracht folders; Dutch messages).
5. CLI `validate-data`, `migrate --dry-run | --apply --backup-dir`; CI migrates the generated
   `school` fixture and validates it.
6. Storage/app on v2: v1 -> `needs_migration`; stamp on write, check on read (`stamp_issues`,
   `accept_stamp`); trailing newline; v2 seed; opdracht folders (`TypstProject::opdracht`,
   create/copy/delete folder, `read_opdrachten`); text CAS (C17); `rapporten/` next to `data/`
   (C18); commands `migrate_data_folder`, `validate_data_folder`.
7. UI on v2: `domain/v2.ts` codec at the Store boundary (in memory still `null` = N and a plain
   student array, so grades/reports unchanged); users per file + school rev check (C16); opaque
   ids (C10) with CSV group match by name; editor conflict bar (C17); migration screen at start;
   admin tab Gegevenscontrole + check at admin login. `tools/fixtures/to-v2.mjs` converts the
   mock fixture and the golden scenarios. All golden differences were format-only.
8. e2e updated (94 pass); `docs/cutover-runbook.md`; manual tests M-MIG-1..5, M-SYNC-5/6,
   M-START-3, M-TOE-6, M-OPD-1 updated; quirks B9/B21/B25/B26; parity rows.

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

Nothing.

## Step 7c result

Commits 269a203..88b299f, gate green (109 e2e, 309 Vitest, cargo, deny, licences, SPDX):

1. `mw:*` spans (`ui/src/utils/perf.ts`), `tools/perf/measure.mjs` (release exe over the WebView2
   DevTools port, `--cpu 4`, `--admin 1`), baseline and results in `docs/perf.md`.
2. Kept list screens: `Store.generation()` + view key in `navigateTo`; score-modal close redraws
   the exam list only after a save.
3. Leerlingen: 60 cards at once, rest via `utils/idle.ts`, delegated clicks, delete checks
   admin-only, `content-visibility: auto` on cards.
4. `read_json_dir` command: `Store.preloadScores` reads a score folder in one call.
5. Memoised `Store.examResults`.
6. Score modal: first group at once, rest in idle; prebuild of the first group when the exam
   menu opens (no presence before the modal opens).
7. Docs: parity "Perceived speed", manual `M-PERF-1/2`, backlog "From Step 7c".

Result (4x CPU, school fixture): modal 209 -> 48 ms median, tabs within budget at the median,
first visit after login still above 100 ms p90 (backlog). 1x: everything < 25 ms.

Review `docs/reviews/step-07c.md`: 0 blockers; M1 (scroll on refresh), M2 (generation on every
colleague change), M3 (folder re-reads), m1-m4, n1, n3, n4, n6 fixed; m4/m5 rest, n2, n5 in
`docs/backlog.md` "From Step 7c".

## Step 7b result

- Nothing. **Step 7b done** and tagged `step-07b` on `step/07-data-v2` (not merged: the step branch
  merges into `main` at the end of Step 7). Review `docs/reviews/step-07b.md`: 0 blockers; M1
  (snapshot names), M2 (restore as CAS with fresh `_meta`), m2-m5, m6 (tests), n1-n3, n6, n7 fixed;
  m1 partly, n4, n5 in `docs/backlog.md`. Gate green (102 e2e). What 7b contains (ADR-0006):

- core `auth` (Argon2id `pinHash`, admin `recoveryCodeHashes`, throttle, login session in Rust),
  core `snapshots` (`instellingen.json`, CAS claim on `snapshots/state.json`, retention,
  single-file restore), CLI `admin reset-pin`, app commands + bridge (Tauri + mock), background
  snapshot at start.
- UI: PIN dialogs (`screens/pin.ts`, texts in `domain/accounts.ts`), account modal on the
  top-bar badge, Gebruikers (photos, "Pincode resetten", sectievoorzitters), sectievoorzitter
  badge and group rights, tab Instellingen, Gegevenscontrole "Herstellen uit snapshot", badge
  photos everywhere (`utils/badges.js`).
- Tests: Rust `auth::tests` (13), `snapshots::tests` (8), validate, CLI; Vitest; e2e
  `accounts.spec.ts` (8), all 102 e2e pass. Local visual baselines updated (badge photo,
  Gebruikers).
- Docs: data-files-v2, runbook sections 6-7, manual tests M-PIN/M-VZ/M-SNAP, parity, ADR-0006.

## Next action (concrete, resumable)

1. Wait for the user. Then Step 8b on `step/08-editor`: Tauri commands + event for
   `LiveEditor` (open/update/refresh/close per editor, `spawn`ed thread, sink emits events), the
   editor UI on it (CodeMirror lint from `range_utf16`, only changed pages), typst-ide
   (verify what 0.14.2 offers), vraag extraction, Playwright test; backlog items n4, n7, n8.
   Watchdog on `LiveEditor` with the time limit as an admin setting (Instellingen tab,
   `instellingen.json` `editor.compileTimeoutSeconds`, default 30, range 2-300; user decision
   2026-11-01, ADR-0002 section 12). Also document it in `docs/reference/data-files-v2.md`.
2. Before the cutover: the user runs `docs/manual-test.md` M-MIG-1..5, M-PIN/M-VZ/M-SNAP and
   M-PERF-1/2 on a copy of real data, and M-SYNC-1..4 on two machines.

## Open questions for the user

- Snapshot contents: photos (`fotos/`) are left out until M-SNAP-4 is measured on a real copy.
- None blocking. Section 9 items still open: versioning policy (9), domain logic location
  (Step 10), macOS.

## How to resume

Perf measurement: `node tools/fixtures/generate.mjs school <dir>/shared/data`,
`target/debug/maatwerk-cli.exe migrate --apply --backup-dir <dir>/backups <dir>/shared/data`,
`npm run build:exe`, then `node tools/perf/measure.mjs --data <dir>/shared/data --cpu 4`.
Commit messages: from Git Bash (`git commit -F - <<'EOF'`); PowerShell `Out-File` adds a BOM.

After the folder move, release builds also needed `cargo clean --release -p maatwerk-core -p
maatwerk-app -p maatwerk-cli` (stale build-script path). PowerShell for npm/cargo (Git Bash's
`link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). In PowerShell 5.1, commit with
`git commit -F <file>` (inline messages with quotes get split into pathspecs). `npm ci; npm run
build:ui`, then the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright
install chromium` in `ui/`). Rapport parity: `cargo test -p maatwerk-core --test typst_rapport` / `--test typst_opdracht`
(machine-independent, no system fonts; failing pages are written to
`target/tmp/golden/<case>/`). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and
the Typst packages in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 and cargo-about 0.9.3 (`--features cli`) are installed.
