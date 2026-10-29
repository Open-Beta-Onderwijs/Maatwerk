# Review: Step 6b and the Step 6 drift check

Reviewer: fresh-context subagent, 2026-10-29. Scope: `git diff step-06a..HEAD` on `step/06-tauri`
(`a4e0680` … `0009ea0`, 9 commits), plus `git diff step-05..HEAD -- src-tauri crates
ui/src/bridge` for the architecture drift check. I read every changed file in 6b
(`src-tauri/src/{start_error,state,commands,lib}.rs`, `src-tauri/Cargo.toml`, `ci.yml`,
`ui/src/{app.js,screens/startup-error.ts,screens/school.js,bridge/*}`, `ui/e2e/{real-pdf,
quirks}.spec.ts`, `typst_rapport.rs`, `docs/{parity,manual-test,backlog,STATE}.md`), plus the
6a shell modules (`render.rs`, `opdrachten.rs`, `scheme.rs`) for the drift check. I compared the
WebView2 handling with the sources of `tauri` 2.12.5 and `tauri-runtime-wry` 2.12.3 in the cargo
registry, and checked `manual-test.md` labels against `ui/src` and `ui/index.html`, and the
drag-and-drop claim against `_reference/`.

What I ran: `npx prettier --check docs ui/src/screens ui/e2e .github` (clean), plus read-only
git and grep. I did **not** run cargo or the Playwright suites. Their results are taken from CI
or the implementer's gate.

Overall, 6b does what the plan asks. `docs/parity.md` has all 32 reference handlers (28 ported, 4
dropped with reasons), and the new methods have rows too. Every `M-…` id cited in `parity.md` and
`backlog.md` exists in `manual-test.md`. The labels I spot-checked in `manual-test.md` exist in the
UI (about 30 of them). The startup error screen builds its DOM with `textContent` only. CI checks
that the app bundle contains no MockApi, and the compat-layer remainder is in the backlog. The
capabilities still grant only `core:default`.

No blockers. One major: in a **release** build without WebView2, Tauri's runtime first shows its
own English dialog, and only then does the Dutch message box appear. The hand check was most
likely done on a debug build, where that English dialog is compiled out.

## Blockers

None.

## Major

### M1. Without WebView2 the release exe shows an English dialog before the Dutch one

- `tauri-runtime-wry-2.12.3/src/lib.rs:4678-4692` (`create_webview`): when
  `context.webview_runtime_installed` is false, it runs
  `#[cfg(all(not(debug_assertions), windows))] dialog::error("Could not find the WebView2
Runtime. … <A href=…>…")` and only then returns `Error::WebviewRuntimeNotInstalled`. Tauri
  creates the config windows inside `setup()` (`tauri-2.12.5/src/app.rs:2688-2693`). The error
  then becomes `panic!("Failed to setup app: {e}")` in the event loop (`app.rs:1444`), and only
  then does our panic hook (`src-tauri/src/start_error.rs:34-48`) show the Dutch box.
- So a teacher on a machine without WebView2 first sees an English message box (with the raw
  `<A href=…>` markup, depending on how wry renders it), then a second, Dutch one. PLAN Step 6b
  asks for "a clear Dutch error". `docs/STATE.md` says the check was done by hand with
  `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`. That was most likely a `tauri dev` or debug build, where
  `debug_assertions` removes the English dialog. `M-START-4` in `manual-test.md` runs the
  release exe, so the user will see two dialogs, not the one the checklist describes.
- Related: `init_logging` runs inside the setup closure (`src-tauri/src/lib.rs:169`), after the
  window is created. For this failure (and for any `build()` error), the `tracing::error!` lines
  go nowhere, but the Dutch text tells the teacher to send "het logbestand" to the beheerder.
- Fix: at the top of `run()`, before building, call `tauri::webview_version()` (re-exported from
  `tauri_runtime_wry`, `tauri-2.12.5/src/lib.rs:209`). If it fails, show the Dutch `rfd` box and
  `exit(1)`, so wry never reaches its own dialog. Keep the panic hook as a fallback. Start logging
  before `Builder::build` (the log dir can be resolved without an `App`, or fall back to stderr
  until setup). Change `M-START-4` to say "release exe, exactly one dialog, in Dutch".

## Minor

### m1. `restart_app` skips the app's shutdown and can be called at any time

- `src-tauri/src/commands.rs:150-156`: a sync command, so it runs on the main thread, and
  `AppHandle::restart` there calls `cleanup_before_exit()` and `process::restart` directly
  (`tauri-2.12.5/src/app.rs:606-610`). `RunEvent::Exit` is never delivered, so `Core::shutdown`
  (`state.rs:142-148`, presence offline and watcher close) does not run. The windows are hidden,
  not destroyed, so `WindowEvent::Destroyed` → `mark_offline` does not run either. Blocking
  tasks still writing (atomic temp file plus rename) are cut off.
- Today this is harmless: the only caller is the startup error screen, where `storage` is `Err`
  and there is no presence or watcher. But the command is open to the whole webview at any time.
  A later caller (or a stray `restartApp()`) would leave the teacher "online" for colleagues
  until the 60 s timeout and could leave a `.tmp` file in the shared folder.
- Fix: use `app.request_restart()`, which goes through `RunEvent::Exit` (`app.rs:633-643`), or
  refuse with `invalid_argument` when `core.storage()` is `Ok`. Add a one-line Rust test for the
  guard.

### m2. The main-thread panic hook calls every later panic a start failure

- `start_error.rs:45-47`: the hook shows "Maatwerk kan niet starten" / "Er ging iets mis bij het
  starten" for **any** panic on the main thread, including after the app has started. The main
  thread also runs sync commands (`restart_app`), the `app.run` closure (presence write on
  window close) and URI-scheme dispatch. The text is misleading there.
- The modal `MessageBoxW` also runs a nested message loop while the panic is still in progress
  (the hook runs before unwinding). A re-entrant tao callback that panics again aborts the
  process silently. That is rare, but the pre-check from M1 keeps the common case out of this
  path entirely.
- Fix: set a flag (`AtomicBool STARTED`) on `RunEvent::Ready`. After that, use a neutral title
  ("Maatwerk is gestopt door een fout") and keep the advice about the log file.

### m3. The real-PDF test can skip silently in CI and does not test the app's CSP

- `ui/e2e/real-pdf.spec.ts:16`: `test.skip(!existsSync(PDF))`. If the PDF is not at
  `target/tmp/e2e/` (a `CARGO_TARGET_DIR` change, a renamed test, a filter), the CI step
  "npx playwright test … real-pdf" reports one skipped test and passes. `Swatinem/rust-cache`
  can also restore an old `target/tmp`, so the first `npm run test:e2e` step may already run it
  against a stale PDF.
- The page runs under `MOCK_CSP` (`ui/vite/csp.ts:44`, `connect-src 'self' blob:`), not
  `APP_CSP`. The PDF arrives as a `blob:` URL, not through `http://maatwerk-out.localhost`. So
  the fonts and `worker-src` are checked, but the app's `connect-src` and the scheme's CORS
  headers are not. Only `M-TOE-5` covers them. `parity.md:155` and `backlog.md` say "under the
  CSP" without that qualifier.
- `watchErrors` (`ui/e2e/helpers.ts:12-19`) only collects `console.error` and page errors. pdf.js
  reports a font it could not load as a `console.warn` ("Warning: …"), so a font fallback under
  the CSP would pass.
- Fix: `test.skip(!existsSync(PDF) && !process.env.CI, …)` (fail in CI), or check in the CI step
  that the file exists. Delete `target/tmp/e2e` before `cargo test`. Also collect warnings that
  match `/font|Warning/` from pdf.js. Write "mock CSP" in the parity row.

### m4. Parity table: most manual checks are not linked, and some 6a behaviours have no row

- `docs/parity.md:5-7` says that whatever no automated test reaches has a manual line. But only 6
  of the 33 `M-…` ids are cited. These rows rely on mock and compat tests only, and do not cite
  the manual line that exercises the real backend:
  - row 21 `updatePresence` and the `data:changed` event (`M-SYNC-1`…`4`, `M-END-1`);
  - rows 22/23 local session (`M-START-2`);
  - row 25 `savePhoto` (its Tests cell is "—"; `M-ADM-1`, `M-ADM-2`);
  - row 12 `writeTextFile` (`M-OPD-3`);
  - row 13 `createAssignmentTypFile` and rows 19/20 (`M-OPD-1`);
  - row 28 (`M-TOE-5`) and row 30 (`M-OPD-2`).
- The "UI behaviour" table has no rows for these PLAN 6a items: window config (`M-START-1`),
  offline on window close (`M-END-1`), output folder per run and cleanup (`M-END-2`), and the
  removal of empty image folders at start. `M-START-5` (offline) is not linked to the "works
  offline" row.
- Fix: add the ids to the Tests cells and the four missing rows. This is a docs-only change.

### m5. The user photo upload hangs on a save error

- `ui/src/screens/gebruikers.js:218-226`: `await window.maatwerk.savePhoto(…)` inside
  `reader.onload` has no `try`. If it rejects (I/O, OneDrive lock, `invalid_path`), the outer
  promise never resolves, and the "Opslaan" flow hangs with no message. 6b fixed this exact
  pattern in `school.js` (`saveImageField`, toast "Opslaan mislukt.") but not here. The
  reference has the same code, so this is parity. But save errors are a fixed quirk class (U3),
  and the fix is three lines.
- Fix: wrap it the same way as in `school.js` (`reject`/toast, keep the modal open).

### m6. The data folder opens on the UI thread at start

- `src-tauri/src/lib.rs:176` (`Core::open` in the setup closure, main thread):
  `Storage::open` (reads `config.json` for the schema check), `seed_initial_data`,
  `opdracht_images::remove_empty_dirs` (walks `opdrachten/images/`) and `OutputStore::open`
  (removes old run folders) all run on the event-loop thread, after the window exists. On a
  OneDrive folder with files on demand, this can leave a white, "Not responding" window for
  seconds. PLAN 2.5 and ADR-0002 section 3 say directory walks never run on the UI thread.
  Partly pre-6b (4b/6a), but not recorded.
- Fix: open the core on a background thread and `manage` a cell that commands wait on. The UI
  already calls `data_folder_status` first, so it can await readiness. Or record the exception
  in ADR-0002.

## Nits

- **n1.** `src-tauri/src/lib.rs:190`: `format!("{e:?}")` puts Tauri's `Debug` form
  (`Runtime(…)`) into the "Technische melding". Use `{e}` (Display), as the panic path does.
- **n2.** `ui/src/screens/startup-error.ts:29-35`: the `corrupt_json` branch cannot be reached.
  `Storage::check_schema` ignores an unreadable `config.json`
  (`storage/mod.rs:158-164`), and the compat `readJson` maps corrupt files to `null`, so
  `Store.preload` never rejects with it. Drop it, or comment why it is there.
- **n3.** `startup-error.ts:86-90`: if `restartApp()` rejects, the button stays disabled and the
  rejection is unhandled. Re-enable the button and show the error text.
- **n4.** `ui/src/bridge/api.ts:43-46` re-declares `DataFolderStatus` with a narrower `error`
  type than the generated `bindings.ts`. Import the generated type, or note why. There is also
  no `tauri-api.test.ts` case for `dataFolderStatus` (`orThrow`) and `restartApp`.
- **n5.** `ci.yml` "No MockApi in the app bundle": `! grep -rl …` also passes when `ui/dist` is
  missing (grep exits 2). Use `test -d ui/dist && ! grep …`.
- **n6.** `manual-test.md` `M-SYNC-1`: "werkt hierin" is the exam-card tooltip only
  (`toetsen.js:164`). In the score grid the badge says "heeft de afgelopen 2 minuten scores
  ingevoerd" / "heeft dit scorescherm open" (`scores.js:391-394`).
- **n7.** `manual-test.md` `M-OPD-6` leaves an open question for the user. The reference has no
  drop handler and no `will-navigate` guard (`_reference/main.js`, `renderer/editor-init.js`), so
  Electron's default applied: a dropped image file navigates the window away from the app. Record
  that in `quirks.md`. Ask the user to check something else instead: whether dragging
  **selected text** inside the CodeMirror editor still works. Tauri's default `dragDropEnabled`
  intercepts drag and drop on Windows, which can block HTML5 drag inside the webview.
- **n8.** `manual-test.md` `M-START-4`: prettier left the PowerShell line wrapped at column 0
  inside the list item. Put the command in a fenced block.
- **n9.** `school.js:245`: a file without an extension gives "Bestandstype .<whole name> wordt
  niet ondersteund". The watermark path also reaches `saveImageField` after its own SVG check, so
  the message there mentions PNG/JPG. Both are cosmetic.
- **n10.** `src-tauri/src/opdrachten.rs:170`: `import_opdracht_image` reads the picked file with
  `std::fs::read` in the shell, with no size cap (a multi-GB file is read fully into memory).
  Move the read into `opdracht_images` with a limit (see also backlog 6a m4).

## Checked and found fine

- **Parity completeness:** every one of the 32 handlers in `docs/reference/ipc-api.md` has a row
  with the same number and name. The dropped rows (6, 26, 27, 29) give reasons that match
  ADR-0002 section 2. Every `M-…` reference in `parity.md` and `backlog.md` (`M-OPD-4/5`,
  `M-START-3/4`, `M-TOE-6/7`) exists in `manual-test.md`, and every id there is unique.
- **Manual-test accuracy (spot checks):** labels match the code: "Schooljaar:", the empty-year
  hint, "Toets verwijderen" blocked with resits, student delete blocked with scores or a group,
  the overview tab names, "0,5 punten"/"1 punt", "Kopiëren naar…", "Blijven bewerken"/"Toch
  sluiten", "Alles aan/uit", "Genereren", "📂 Van schijf kiezen…", "📋 Plakken van klembord",
  "Overschrijven", `afbeelding-N`, "Er staat geen afbeelding op het klembord.", the "Maatwerk"
  back button in the editor, "Nieuwe toets toegevoegd", and the conflict texts. Also checked:
  printed names (`Rapport`/`Opdrachten`/`Antwoordsleutel`, ` (n)` suffix), window size and
  minimum size, and the `output/<pid>/` folder.
- **Startup error screen:** `data_folder_status` reports the opened root or the configured path
  plus the stored `CommandError`. `state::tests` cover both cases (unsupported schema with
  `found`). `app.js` skips `Store.preload` when there is an error and also catches a rejected
  preload. The screen uses `textContent` only (no `innerHTML` with the path or message).
  `quirks.spec` checks that `listYears` is not called.
- **Security:** `data_folder_status` exposes nothing beyond `get_data_dir`. Neither new command
  is reachable from the editor iframe's proxy (explicit `case` list in `modals/editor.js`). The
  capabilities are unchanged (`core:default`). The `rfd` licence is MIT, it is recorded in
  `THIRD_PARTY_LICENSES.md`, and it is already in the tree through the dialog plugin. The panic
  hook is installed only in `run()`, so `cargo test` never shows a dialog (test threads are not
  named `main` anyway). A panic inside the hook (for example in `rfd`) aborts as
  panic-while-panicking, so it cannot loop. Panics on worker threads are only logged.
- **School logo:** the `accept` list and the JS check use the six `IMAGE_EXTS`, matching
  `check_photo_path`. `toast` uses `textContent`. A rejected `savePhoto` now gives a toast.
- **TauriApi only:** `installBridge` picks the mock only for `MODE === 'mock'` (a build-time
  constant with a dynamic import). The CI grep checks both the hook name and the mock path
  string.
- **CI:** the portable exe is built and uploaded after the licence check. The real-PDF step runs
  after `cargo test`, which writes the PDF to `CARGO_TARGET_TMPDIR`.

## Architecture drift check (ADR-0002)

Scope: `git diff step-05..HEAD -- src-tauri crates ui/src/bridge` (32 files, about 2.9k lines).

| #   | ADR-0002 rule                                                                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                  | Recorded in ADR?                                                                                                  |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1  | §1 layering `ui -> bridge -> Tauri -> commands -> core`; core never depends on tauri | Holds. No `tauri` in `maatwerk-core` (CI check). The UI reaches the backend only through `bindings.ts` (`TauriApi`). The plugins are called from Rust only.                                                                                                                                                                                                                                              | n/a (conforms)                                                                                                    |
| D2  | §1 "commands -> core … no business logic" in `src-tauri`                             | Mostly holds. Logic in the shell beyond parse, call and map errors: `render.rs` maps argument defaults and `mode` (parsing, acceptable); `opdrachten.rs:162-176` reads the picked file from disk itself (I/O outside core, no size cap, n10); `state.rs` `Core::open` orchestrates seeding, image-folder cleanup and the output store (start-up wiring, acceptable). `start_error.rs` is shell UI, fine. | No (the I/O in `import_opdracht_image` is not recorded)                                                           |
| D3  | §1 core module list                                                                  | Core gained `outputs`, `opdracht_images` and `presence`, which are not in the §1 layout list. They are described in §7 and §9.                                                                                                                                                                                                                                                                           | Partly (§7, §9 "Implemented"; §1 list not updated)                                                                |
| D4  | §2 "The UI maps `code` to Dutch text"                                                | Rust produces Dutch text for the UI: `invalid_file_name` "Ongeldige bestandsnaam", "Kies de afbeelding opnieuw.", the `ImageStored::Rejected` messages, `print_pdf` "Opgeslagen als …, maar openen lukte niet", the dialog title "Afbeelding kiezen", and the `rfd` start text. `error.rs` passes `InvalidArgument` messages through as UI text. Done for reference parity of the old texts.             | No. Add a sentence to §2 (Dutch reference messages may come from Rust for parity; new codes are mapped in the UI) |
| D5  | §2 commands mirror the 28 reference methods                                          | New commands beyond the reference: `print_pdf`, `set_watch_year`, the `maatwerk-out` scheme (all in §7/§9), `data_folder_status` and `restart_app` (6b).                                                                                                                                                                                                                                                 | `print_pdf`/scheme/`set_watch_year`: yes. `data_folder_status`/`restart_app`: no (only `parity.md`)               |
| D6  | §3 "All filesystem work runs in `spawn_blocking`"                                    | Commands: yes (`blocking`, the dialog, the clipboard and the opener on blocking threads, the scheme reads on a blocking thread). Exceptions: `Core::open` at start runs on the main thread (m6), and the presence write in `RunEvent::WindowEvent::Destroyed` runs on the event-loop thread (accepted in review 6a n5).                                                                                  | No                                                                                                                |
| D7  | §2 compat layer, deleted screen by screen after parity                               | Still in place. `TauriApi` is the only backend in the bundle; the remainder is recorded in `backlog.md` ("From Step 6b").                                                                                                                                                                                                                                                                                | Yes (§2 Consequences, backlog)                                                                                    |
| D8  | §7 capabilities `core:default` plus the plugins used                                 | Stricter than the ADR: only `core:default`, plugins from Rust only, opener's JS link handler off.                                                                                                                                                                                                                                                                                                        | Yes (§7 "Implemented (Step 6a)")                                                                                  |
| D9  | §7 CSP                                                                               | `tauri.conf.json` equals `APP_CSP` (test). `connect-src` gained `maatwerk-out:` and `http://maatwerk-out.localhost`. The §7 CSP string itself does not list them, but §7 names `ui/vite/csp.ts` as the source of truth and §9 describes the scheme.                                                                                                                                                      | Yes, indirectly (§7 source of truth, §9)                                                                          |
| D10 | §7 paths through `RelPath`; `open_path` limited                                      | Holds. Every path argument goes through `rel()`, `check_photo_path` or `check_opdracht_typ_path`, or is an output ID (`parse_id`). `open_path` goes through `outputs::openable_path`. The picked image path stays in Rust behind a token.                                                                                                                                                                | Yes (§7)                                                                                                          |
| D11 | §8 logging in the app log dir                                                        | Holds for normal runs (daily files, 14 kept). Logging starts inside setup, so start failures before or during window creation are not logged (M1).                                                                                                                                                                                                                                                       | No (gap, not a decision)                                                                                          |
| D12 | §9 PDFs in the OS cache dir, "cleared at start"                                      | Changed to a per-process `output/<pid>/`, with other runs' folders removed after 24 h (review 6a m1).                                                                                                                                                                                                                                                                                                    | Yes (§7 "Implemented", last sentence)                                                                             |
| D13 | §9 "Opslaan als" via the dialog plugin                                               | Not built (no screen asks for it).                                                                                                                                                                                                                                                                                                                                                                       | Yes (§9 "Implemented")                                                                                            |
| D14 | §2 bindings generated by `tauri-specta`, CI fails on stale bindings                  | Holds (`bindings_are_up_to_date`). One hand-written duplicate type in `api.ts` (`DataFolderStatus`, n4).                                                                                                                                                                                                                                                                                                 | n/a                                                                                                               |
| D15 | New dependency `rfd` (§ Consequences lists the expected crates)                      | `rfd` 0.17.2 (MIT, default features off). Already in the tree through `tauri-plugin-dialog`. Licence table updated.                                                                                                                                                                                                                                                                                      | No (not in the Consequences list; THIRD_PARTY updated)                                                            |

Suggested ADR-0002 updates when Step 6 merges: D4 (Dutch text from Rust for the reference
messages), D5 (`data_folder_status`, `restart_app`), D6 (`Core::open` at start, unless m6 is
fixed), D3 (module list) and D15 (`rfd`). None of these needs the user's OK under PLAN 2.6. They
record what was built and change no decided behaviour.

## Verdict

No blockers. Fix **M1** before tagging `v0.2.0-parity`. Pre-check WebView2 with
`tauri::webview_version()` before `build()` so that only the Dutch dialog appears, start logging
earlier, and re-run `M-START-4` on the **release** exe. m1 (`request_restart` or a guard) and
m4 (link the manual ids in `parity.md`) are cheap and worth doing now. m3 should at least fail
instead of skipping in CI. m2, m5 and m6 can go to the backlog, with the ADR notes from the drift
table.

## Triage (implementer, 2026-10-29)

| Id    | Decision                                                                                                                                                             | Where                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| M1    | Fixed: WebView2 pre-check with `wry::webview_version()` before `build()` (one Dutch box); logging starts before Tauri on Windows; `M-START-4` now on the release exe | `start_error.rs`, `lib.rs`, `manual-test.md` |
| m1    | Fixed: `request_restart()` (normal exit: presence offline, watcher stopped). Calling it when the folder is fine only restarts the app; no guard                      | `commands.rs`                                |
| m2    | Fixed: the hook shows the box only before `RunEvent::Ready`                                                                                                          | `start_error.rs`, `lib.rs`                   |
| m3    | Fixed: fails in CI when the PDF is missing; the mock-CSP/scheme gap is documented in the spec and the backlog                                                        | `real-pdf.spec.ts`, `backlog.md`             |
| m4    | Fixed: manual ids on 19 more rows; rows for window config, offline on close, outputs per run, empty image folders, file drops                                        | `parity.md`                                  |
| m5    | Fixed: a failed user photo save shows "Foto opslaan mislukt."                                                                                                        | `gebruikers.js`                              |
| m6    | Backlog                                                                                                                                                              | `backlog.md`, ADR-0002 section 11            |
| n1    | Fixed (`Display`)                                                                                                                                                    | `lib.rs`                                     |
| n2    | Fixed: branch removed, comment why                                                                                                                                   | `startup-error.ts`                           |
| n3    | Fixed: the button comes back with the error text                                                                                                                     | `startup-error.ts`                           |
| n4    | Fixed: type re-exported from `bindings.ts`; `tauri-api.test.ts` case                                                                                                 | `api.ts`, `tauri-api.test.ts`                |
| n5    | Fixed: `test -d ui/dist &&`                                                                                                                                          | `ci.yml`                                     |
| n6    | Fixed                                                                                                                                                                | `manual-test.md`                             |
| n7    | Fixed: quirk U20, `M-OPD-6` checks text drag                                                                                                                         | `quirks.md`, `manual-test.md`                |
| n8    | Fixed: fenced block                                                                                                                                                  | `manual-test.md`                             |
| n9    | Fixed for a name without extension; watermark text in the backlog                                                                                                    | `school.js`, `backlog.md`                    |
| n10   | Backlog                                                                                                                                                              | `backlog.md`                                 |
| Drift | D2-D6, D11, D15 recorded in ADR-0002 section 11                                                                                                                      | `0002-target-architecture.md`                |

Security review (`/security-review`, 2026-10-29): no findings at confidence 8 or higher.
