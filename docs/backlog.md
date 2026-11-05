# Backlog

Minor review findings and deferred work (PLAN.md 2.3). Newest first.

## From the Step 10 manual test (`docs/reviews/manual-test-step-10.md`, 2026-11-03)

- ~~**M-OPD-9** "Herstel standaardversie" did not ask first; "Bekijk verschillen" missing~~
  Fixed in 0.3.2 (`fix/manual-test-10`): the editor's questions use the app dialog (Tauri's
  dialog plugin makes `window.confirm` async), the diff button shows for every existing
  `main.typ`/`lib.typ`. Re-check by hand on the 0.3.2 exe.
- **M-OPD-8** smooth preview scrolling: `ROADMAP.md` V-03.
- **M-OPD-11** a sign that a compile is still running: `ROADMAP.md` F-05.
- **M-ADM-1** photos inconsistent (Step 6 comment repeated): `ROADMAP.md` B-04, re-check.
- **M-LEER-3, M-GRP-3** example CSV: `ROADMAP.md` F-02. **M-TOE-6** `rapporten\` next to
  `data\`: done in Step 7a (C18); re-check against the current checklist.

## From the Step 6 manual test (`docs/reviews/manual-test-step-06.md`, 2026-10-30)

- ~~**M-GRP-1** a deleted group stayed in the admin list until a restart~~ Fixed
  (`fix/manual-test-6`, quirk U21).
- ~~**M-OPD-6** selected text could not be dragged in the editor~~ Fixed (`dragDropEnabled`
  off + `no-file-drop.ts`, quirk U20); re-check by hand in the next exe.
- **M-START-3** could not be run: a v1 folder has no `schema_version` (the checklist now says to
  add it). Re-run after Step 7a writes `schema_version`.
- **M-LEER-3, M-GRP-3** CSV import screens: show a 5-row example CSV of the expected format
  (PLAN Step 10).
- **M-TOE-6** printed copies next to the data folder, not inside it (PLAN Step 7a, C18).
- **M-ADM-1** user photos show inconsistently across the app (PLAN Step 7b).
- **M-SYNC-1..4** not run (needs two machines): required before the cutover (PLAN Step 8,
  cutover readiness).
- Opdracht images inside the opdracht's own folder: already ADR-0003 C14 (PLAN Step 7a).

## From Step 6b

- ~~**Review 6 m6:** `Core::open` (schema check, seeding, image-folder walk, output cleanup) runs in
  Tauri's setup on the main thread; a slow OneDrive folder delays the window. Open the core on a
  blocking thread and let the UI wait on `data_folder_status`.~~ Done (Step 10): `CoreSlot`.
- **Review 6 n10:** `import_opdracht_image` reads the picked file in the shell with `std::fs::read`
  and no size cap. Move the read into `opdracht_images` with a limit (with 6a m4).
- **Review 6 m3 (rest):** the real-PDF test runs under the mock CSP (`blob:`), not through the
  `maatwerk-out` scheme, and does not fail on pdf.js warnings (manual `M-TOE-5` covers the scheme).
- **Review 6 n9 (rest):** the watermark upload reuses the logo message, which lists PNG/JPG
  although only SVG is offered there (unreachable today: the watermark input checks SVG first).

- **Compat layer stays (PLAN Step 6b):** `TauriApi` is the only backend in the app bundle (CI
  checks the bundle has no MockApi), but no legacy screen uses the typed results yet, so the
  compat shapes in `ui/src/bridge/tauri-api.ts` stay. Per ADR-0002 they are removed screen by
  screen in Step 10, as each screen moves to TypeScript and the typed `{ code, message }` errors.
- **Command-level tests (from 6a):** covered by `docs/manual-test.md` for now (M-OPD-4/5,
  M-TOE-6/7, M-START-3/4); a `tauri::test` mock-runtime test remains a Step 10 option.

## From Step 6a

- **Typst warnings are only logged:** the render commands return compile warnings (tofu etc.,
  deduplicated); `TauriApi` writes them to the console. Show them in the editor preview and the
  generate/rapport modals (6b or Step 8).
- **`rapporten/` retention:** printed copies are never cleaned up (ADR-0002 section 9). Decide on
  a policy with the user.
- **Command-level tests:** the Tauri commands are thin and their core functions are tested, but
  no test invokes a command through Tauri (`tauri::test` mock runtime). Add a few for the
  render/print/image commands, or cover them in the 6b manual checklist.
- ~~**Startup error screen (4b m5)**~~ Done (6b): `data_folder_status` + `restart_app`,
  `ui/src/screens/startup-error.ts`, quirks.spec "4b m5".
- **Review 6a m4:** `list_opdracht_images` decodes and resizes every image on each call (slow for
  phone photos, no decode limits). Cache thumbnails by file hash/mtime and set
  `image::Limits`.
- **Review 6a n7:** a picked file whose name is not valid Unicode gets "Bestandstype . wordt niet
  ondersteund." instead of a clear message.
- ~~**`save_photo` takes image types only (review 6a M1)**~~ Done (6b): the logo input accepts
  the six image types and other types get a Dutch toast (quirks.spec "6a M1").

## From Step 5b

- **Review 5b m2 (Step 6):** `TypstProject::folder` accepts any root and does not bound links on
  it; today only the CLI uses it (a path the user typed). Before the app opens v2 opdracht folders
  (Step 7/8), add an app constructor from `DataDir` + `RelPath` with `.within(data root)` and keep
  `folder` for the CLI.
- ~~**Review 5b n1:** a panic inside one compile is not caught; the other workers run all remaining
  jobs before it surfaces. Catch per job (`catch_unwind`) and report it as that job's error.~~ Done (Step 10): `BatchError::Panic`.
- **Review 5b n2:** the batch holds every job's PDF until the merge (fine at ~35 KiB per job,
  `docs/perf.md`); opdrachten with large photos could change that. Merge in job order as results
  arrive if a real class batch gets heavy.
- ~~**Review 5b n3:** tofu warnings repeat once per job in a batch~~ Done (6a): the batch
  command deduplicates the warning texts across jobs.
- **Review 5b n4:** decide before the first release whether the lib.typ/main.typ hash
  normalisation also ignores trailing whitespace/final newline.
- **Review 5b n5:** the mount boundary is the data dir, so a junction from `images/<id>` to another
  opdracht's images is followed. Tighten to `opdrachten/images/<id>` if Step 7 keeps v1 folders.
- **Review 5b n6:** the CLI panics on a non-UTF-8 argument and writes its output non-atomically.
- **Review 5b n7:** the old app removed stale `opdrachten/_preview_*.typ` at start; nobody does now.
  Step 7 migration deletes them.

## From Step 5a

- **Review 5a m3:** an error in eval'd teacher text (leeradvies, uitleg) points at the `eval`
  call in `rapport.typ`; pre-parse each field and name it (student, category) in the diagnostic.
- **Review 5a m4 (watcher, Step 4b code):** a colleague's write with the same size inside one
  mtime tick of the previous state is not seen as a change by the stat check. Compare a content
  hash when size and mtime are equal but an event arrived.
- **Review 5a nit n8 (done 2026-10-28):** the pixel tests and golden PNGs no longer use system
  fonts (`support::fonts`, `--ignore-system-fonts`). The app still uses them; an installed
  "Libertinus Serif" could still shadow Typst's own copy there. Nits n1-n6 and n9 were done in 5b.

- **quick-xml advisories ignored (RUSTSEC-2026-0194/0195, `deny.toml`):** pulled in by typst 0.14.2
  through hayagriva/citationberg; the fix needs quick-xml 0.41. Ignore accepted by the user
  (2026-10-28); resolved by the Typst upgrade below.
- **Step 10: upgrade Typst to a current version (user, 2026-10-28).** The 0.14.2 pin only serves
  (near) parity with the reference CLI through Step 6; there is no other reason to stay on it.
  Upgrade `typst`, `typst-pdf`, `typst-svg`, `typst-kit` (and `typst-render` in tests) together,
  then: re-check the embedded packages' `compiler` versions, rerun the Typst goldens and record any
  visible change (the goldens stay the record of the reference), drop the quick-xml ignores from
  `deny.toml`, and check `typst-ide` for the Step 8 editor if that comes first.
- **Emoji font (done 2026-10-28, pulled forward from Step 10):** the first CI run failed on
  `rapport-valid` p14 (1 pixel in 🥈: the runner's Segoe UI Emoji differs). Noto Color Emoji
  (COLRv1) is bundled and the goldens were regenerated with it (quirk T2). With the Typst upgrade
  below, update Noto with it and check COLRv1 still renders; a newer Noto release changes emoji
  pixels, so regenerate the goldens and say so in the commit.

## From Step 4b

- ~~**Startup error screen (review 4b m5)**~~ Done in 6b (see "From Step 6a").
- ~~**Watcher thread panic (n6):** a panic ends change reporting silently; shutdown also waits for
  a slow OneDrive read in progress. Catch, log and restart the thread.~~ Done (Step 10).
- ~~**`save_photo` / `write_text_file` accept any data path (n8)**~~ Done (6a):
  `check_photo_path` (`fotos/<name>`) and `check_opdracht_typ_path` (`opdrachten/<name>.typ`).
- **Lock folder errors carry an absolute local path (n4, remaining part):** `CommitLock` errors
  name the lock folder under `%LOCALAPPDATA%` (with the Windows user name) in `details.path`.
- **Overflow of `ReadDirectoryChangesW` (review 4b M1 note):** `notify` drops it silently; the
  periodic re-start of OS notifications plus the poll limit the damage. Revisit if colleagues
  report missed changes in non-active years.
- ~~**`set_scope_year` not wired (n3)**~~ Done (6a): `set_watch_year`, called by the UI at
  `initSubject` and on the year selectors.

## From Step 4a

- **`update()` does not retry a read that fails with `io` (review 4a m6):** on Windows a read can
  hit a file that is being replaced. Retry with the rename backoff; needs read fault injection.
- **RTTI modal and an unreadable template file (review 4a m4):** the tab shows defaults and every
  save conflicts; offer "overwrite the unreadable file" explicitly.
- **`Locked.path` names the local lock file, not the data file (n4).**
- **`update_locks` map never shrinks (n6):** one small entry per file updated in a session.
- **`read_all_json` skips non-UTF-8 files, `read_json` decodes lossily (n7):** align (lossy).
- **`save_photo` is stricter than Node's base64 (n8):** invalid characters are an error, not
  skipped. Record in quirks if a real caller ever sends such data.
- **`schema_version` checked only at open (n9):** re-check before writes once Step 7 can migrate a
  folder while an app is running.
- **Blind `Expect::Any` writes still possible in the core API (n10):** used for text files and
  presence; consider removing it for JSON in 4b.
- **JSON edge cases (n11):** integers above 2^53 are printed exactly (JS would round); a file with
  a lone surrogate escape is rejected as corrupt.
- **No on-disk test for non-ASCII names or paths over 260 characters (n12).**
- **Junction created between `resolve` and the write (n13):** needs local write access to the data
  folder; accepted.

## From Step 3b

- **Cut (Ctrl+X) in the score grid (review 3b m5):** Handsontable had it; the own grid has copy,
  paste and Delete. Add if teachers miss it (copy + Delete is the workaround).
- **Licence ban covers production deps only (review 3b m8):** `tools/check-npm-licenses.mjs` walks
  `--omit=dev`; Vite would bundle a dev dependency if UI code imported it. Add a check on the
  built bundle (or an ESLint import rule) when the dependency list grows.
- **Colleague change on an unsaved cell (review 3b n4):** a background update can replace a cell
  whose save failed; the cell keeps its "not saved" mark. Clear the mark when a colleague's value
  replaces it.
- **Queued saves stamp the user at run time:** `updateStudentScores` stamps `_meta.updatedBy` when
  the save runs. Logging in waits for the queue (review 3b M1), so this only matters if the user
  could change without the login screen.

## From Step 3a

- **Styling cleanup (Step 10):** the 268 inline styles became pixel-identical CSS (Step 3a): about
  130 one-declaration `u-*` utilities (`!important`, mirroring inline precedence) plus a few
  component classes (`grade-pill`, `gl-*`, `obs-icon-btn`). Consolidate them into semantic
  component classes and fix the inconsistencies they preserve (e.g. grade pills 34 vs 36 px, two
  panel paddings `10px` vs `10px 12px 14px`, `#aaa` vs `#9aa0ab` greys). Each visible change needs
  the user's eye; `npm run test:visual` shows the diff.
- ~~**Step 6 CSP checklist (review 3a m8)**~~ Done: scheme in `connect-src` and
  `isEvalSupported: false` (6a); `ui/e2e/real-pdf.spec.ts` shows a real compiled rapport (from
  the `typst_rapport` tests) in pdf.js under the CSP (6b, CI after `cargo test`).
- **Utilities are `!important` (review 3a m7):** a later `el.style.x = …` on an element with a
  `u-*` class for the same property is ignored. Use a component class there instead.
- **Review 3a n5:** `csp.spec.ts` waits a fixed 600 ms; `smoke.spec.ts` retries opening the exam
  menu while the list re-renders. Replace with a "list rendered" signal when the screens are touched.
- **U18:** the period separators in the group students modal never rendered; add them if wanted.
- **Dependency updates after parity (Step 10):** pdfjs-dist 4.9.155, chart.js 4.4.2 and
  chartjs-plugin-annotation 3.0.1 are pinned to the reference versions.

## From the Step 2 review (`docs/reviews/step-02.md`)

- **m3/m4 (Step 5):** Typst error goldens: normalise canonical and 8.3 temp paths too, and compare
  diagnostics separator-neutrally (`\` vs `/`).
- **m6 (Step 5/6):** store an explicit merged-page map for batch goldens (job, page, blank) and
  PNGs for multi-job batches if pixel parity of the merge matters.
- **m7 (Step 6):** record `assignment:progress` events in the batch goldens. (6a: the event is
  wired; the goldens still only check "0, then one per job".)

## From the Step 2a review (`docs/reviews/step-02a.md`)

- **n4:** `attempts` golden: store the grade `resolveBestAttempts` compared
  (`Store.calcResults(...).grade`) next to each history entry, so the case explains itself.

## From the Step 0 review (`docs/reviews/step-00.md`)

- ~~**m6 (Step 6):** full third-party notices and an "Over Maatwerk" screen~~ Done 2026-10-30:
  `THIRD_PARTY_NOTICES.txt` (`npm run notices`, CI check, shipped next to the exe) and "Over
  Maatwerk" (licence notice, source link, version and build, licence texts; startup screen and
  top-bar title).
- ~~**n1 (Step 3):** CSP~~: done in Step 3a (classes + CSSOM style data, `ui/vite/csp.ts`,
  `ui/e2e/csp.spec.ts`).
- **n3:** `LICENSE` is the SPDX reflowed AGPL-3.0 text; replace with the verbatim gnu.org text when
  gnu.org is reachable.
- ~~**n5:** `tauri.conf.json` `version` duplicates the Cargo workspace version~~ Done 2026-10-30:
  the field is gone (Tauri takes the Cargo version), version bumped to 0.2.0 to match the
  `v0.2.0-parity` tag. The versioning policy itself is still PLAN section 9, decision 9.
- **n6:** SPDX check skips toml/yml; decide whether config files need headers and whether to add a
  copyright line convention.
- **n9:** CI hygiene: pin actions by SHA (Dependabot), avoid double runs on push + PR, avoid
  installing the Windows target on Linux runners.
- **n2:** keep the two licence allowlists (`deny.toml`, `tools/check-npm-licenses.mjs`) in sync;
  consider generating one from the other.

## From Step 7a (review `docs/reviews/step-07a.md`)

- **m2:** `stamp_issues`/`stampIssues` are not shown in the UI yet; use them for "Herstellen uit
  snapshot" in 7b or drop them.
- **m6:** CI check that `tools/fixtures/to-v2.mjs` and `maatwerk-cli migrate` give the same tree
  for the tiny fixture (ignoring `_meta.hash` and migration-added `_meta`).
- **n1:** `TypstProject::opdracht_v1`/`v1_opdracht_id` are only used by tests and an example now;
  remove after the cutover.
- **n3:** the data-files-v2 text on merging duplicate students vs. the Rust merge details.
- **n4:** the conflict-copy check can label a misplaced file as a conflict copy.
- **n5:** validate at admin login reads every year (Files-On-Demand downloads) and stamping clones
  each file; measure in 7c.
- **n6:** the user active toggle changes the cached user before saving; a conflict leaves the
  wrong state on screen.
- **n8:** saving the students file drops top-level keys other than `students`.

## From Step 7b (review `docs/reviews/step-07b.md`)

- ~~m1: two PCs that start in the same minute can both write a snapshot (the claim in
  `snapshots/state.json` is per OneDrive replica). Option: after claiming, wait 20-60 s on the
  background thread, re-read the state and give up if another PC claimed later.~~ Done (Step 10): 45 s settle wait.
- ~~m6: test for losing the snapshot claim to a concurrent writer (needs a hook between read and
  CAS in `Storage`).~~ Done (Step 10): injected settle hook.
- n4: the sectievoorzitter role is checked against `school.json` only at login; a removal by the
  admin takes effect at the next login.
- n5: the Rust login session survives a webview reload (dev only; release builds have no reload).
- After "Herstellen uit snapshot" of year data (groups, exams, scores) the Store reloads it only at
  the next login.

## From Step 7c (perceived speed)

- **Read vs. colleague change, file not cached yet** (older than 7c, also with single reads):
  a score file read in flight when the watcher reports a colleague's change to that file is not
  refreshed (the event is skipped because nothing is cached yet), so the read's older content
  stays until the next login. Window: one read. Option: count external changes per path while
  a read is in flight and read again.
- **First tab visit after login at 4x CPU** is above 100 ms (Toetsen 113, admin Leerlingen 217,
  admin Groepen 154 p90; `docs/perf.md`): the first folder reads and statistics. If the real
  copy (M-PERF-1) shows it at 1x too: start `preloadScores` for the active year in idle time
  right after login.
- **Review 7c m4 (rest):** `loadInstellingen` and `invalidateSchool` (School screen) drop a cached
  entry on every visit, which counts as a change, so the kept screens render once more for nothing.
  Load Instellingen without invalidating (the versioned read gives the rev).
- **Review 7c m5 (rest):** e2e for a colleague's change to a group still waiting for idle time
  (stub `requestIdleCallback`), closing the score modal while groups are pending, and the 15 s
  prebuild TTL.
- **Review 7c n2:** closing the score modal after a save redraws the exam list without updating
  the kept-screen key, so the next Toetsen visit renders once more.
- **Review 7c n5:** `contain-intrinsic-size: auto 40px` on student cards is an estimate; measure a
  real card (cards not shown yet count as 40 px for the scrollbar).
- **e2e `examMenuItem` retries** because Playwright's scroll-into-view delivers a `scroll` event a
  frame after the click, which closes the menu. Replace the retry with the scroll-first click of
  `openExamMenu` in `ui/e2e/perceived-speed.spec.ts`.

## From Step 8a (review `docs/reviews/step-08a.md`)

- **m2 comemo shared by batch and editor:** `evict(10)` is process-wide; a batch ages the
  editor's cache out. Option: evict by the editor's own compile count only, or evict less
  often while a session is open. Step 8b measured 1-2 ms per edit without a batch (`docs/perf.md`);
  a batch costs the editor one full compile afterwards. Revisit with a large opdracht.
- **m6 rest:** tests for a compiler panic (hard to provoke) and `close()` during a compile.
- **n2:** after a panic in the SVG render, `failed()` reports a `preview_generation` the client
  never got (set `document` only after the render succeeded).
- **n3:** `close()` called from the sink would join its own thread. The app's sink only emits an
  event (never blocks, never closes); keep it that way (documented on `LiveEditor`).
- **n5:** one moved mount drops the disk files of every mount (performance only).
- **n6:** check staleness between pages of the SVG render too.

## From Step 8b (review `docs/reviews/step-08b.md`)

- **m5:** help queries whose caller gave up (2 s) still run later on the compile thread and count
  against the next compile's time limit; pass a cancel flag.
- **m6:** the editor iframe uses `window.confirm` (close with unsaved changes since 3a, "Herstel
  standaardversie" since 8b); move both to the app's own dialog (Step 10).
- **n1:** vragen checks: string punten count as missing, an image-only answer as empty, "buiten
  een opgave" only before the first opgave.
- ~~**n4:** the bundled `main.typ` still has the cursor-marker code~~ Done in `maatwerk-main 2`
  (0.3.1): no marker in `main.typ`, no `cursor` in `OpdrachtInputs` or `render_assignment_svg`.
  The command itself has no caller in the editor any more; remove it in phase 2.
- **n6:** while two abandoned compiles still run, the editor waits silently; say so.
- **n8:** the line diff is quadratic in memory; cap it or use a linear diff for very large copies.
- **Jumps after an error:** while the last compile failed, preview clicks and the cursor sync do
  nothing (by design, review 8a n7); consider mapping through the last good source.

- **CSP report on native editing:** typing over a multi-line selection makes Chrome insert a
  styled span in the editor's contenteditable, which the CSP blocks and reports (seen in e2e;
  CodeMirror rewrites that DOM, nothing visible). Check whether real typing triggers it.

## From Step 9 (review `docs/reviews/step-09.md`)

- **m3 No time limit in headless `assignment check`/`render`.** A runaway loop in an opdracht
  hangs the CLI until Ctrl+C. Reuse the editor's watchdog (`LiveEditor`) or run the compile on a
  thread with a deadline before the in-app assistant uses it (ADR-0009 constraint 4, option D).
- **m7 `ui/e2e/editor.spec.ts:66-75` depends on wall-clock timing** (the 500 ms error delay of
  commit 294161a). Use Playwright's `page.clock` or a test hook for `ERROR_DELAY_MS`.
- **n6 `export_lib`:** an unreadable existing file counts as no clash, writes are not atomic, a
  junction inside `<dir>` is followed. Low risk (the user picks the folder).
- **n9** `el()` helper duplicated in `ui/src/screens/migration.ts` and `gegevens.ts`; share one in
  the Step 10 UI refactor.

## Other

- **`rapporten/` retention** (Step 1 decision, ADR-0002 section 9): printed copies accumulate in the
  shared folder; decide a cleanup or archive policy with the user (after cutover).
- **Upgrade to Tauri 3 once 3.0 is stable** (decided 2026-10-25, Step 0). On 2026-10-25 Tauri was
  at `3.0.0-alpha.5` (needs Rust 1.95), plugins at alpha, `tauri-specta` without Tauri 3 support.
  Revisit around Step 10; the thin `src-tauri` layer keeps the upgrade small.

## From Step 10

- **Perf at 4x (review 10 M1):** investigated: `step-07c` and `step-10` exes are equally slow
  on battery (`docs/perf.md`); likely the power state, not a regression. Confirm on mains power.
- **m3 (rest):** an app closed during the 45 s snapshot settle leaves its claim for 30 min
  (`CLAIM_STALE`), so that day's snapshot may be skipped. Remove our claim on `shutdown` when no
  zip has started.
- **m6:** exam delete is a blind delete after a stale scores check (reference behaviour): CAS on
  `delete_file` and re-check scores after the confirm.
- **n1:** `CoreSlot`: a `closing` flag so the snapshot thread does not start after `Exit`; a
  panic inside `Core::failed` would leave the slot empty.
- **n2:** an error before `legacy/globals` loads makes the handler import `app.js` early.
- **n7:** the sandbox test passes on any failure; assert the diagnostic is "not found/denied".
- Other nits in `docs/reviews/step-10.md`.

## From Step 13 (review `docs/reviews/step-13.md`)

- **m3/m4 (step 14, form rules):** scope the input base to form contexts or give every inline
  input an explicit size; CustomSelect trigger, `.toolbar select`, `.voorzitter-row select` and
  `.questions-table input` on the spec 3.2 look.
- **m7 (R-05):** JS files touched only for class renames stay JS until their area step.
- **n5:** raw colours left in component CSS (`#3a404b` pressed segment in dark); `.grade-pill`
  to the spec 2.3 sizes (min-width 44, radius 6, 1.5 px) with the overview redesign (step 25).
- **n6:** `setBusy` drops icons; use it in `pin.ts`, `instellingen.ts`, `gegevens.ts`,
  `migration.ts` (step 14 dialog component).
- **n8:** dev theme menu: Escape also reaches open modals; AltGr+T on some layouts (dev only).
- **n9:** theme test: cover the dark zwart override and the neutrals table.
- RTTI chart colours still the old `#5cb85c/#5bc0de/#f0ad4e/#d9534f`; spec 2.6 tokens exist
  (`--rtti-*`), apply with the overview redesign (step 25).
- **Possibly flaky Rust test:** on 2026-11-05 one local `cargo test --workspace` run (step 13
  gate, PowerShell, other runs idle) exited 101; the failing test was not captured. Three later
  runs (local and CI) passed. Next time: rerun `cargo test --workspace` a few times with output
  kept (`> log 2>&1`) and look for `FAILED`; suspects are the timing-based watcher and snapshot
  tests (`watcher::tests`, `snapshots::tests`).
- **Flaky e2e on CI:** `ui/e2e/editor.spec.ts` "a compile over the time limit reports the admin
  setting" failed on PR #8 (2026-11-05) at its first step: the mock preview still showed the
  initial page instead of "Goed" after 5 s; a rerun passed. Probably a slow runner; give that
  first wait a longer timeout or wait for the compile event instead of the text.
  Again locally on 2026-11-05 (step 14, full suite with 8 workers), this time at its **last**
  step: after the time-limit error the preview showed page " 1" instead of keeping "Goed".
  Passed 6x in a row alone. Look at what the mock renders for `#traag` when it times out.

## From Step 14 (review `docs/reviews/step-14.md`)

- **m2:** async work after an `await` still targets "the current modal": `modalRefresher` can
  re-open a modal that was closed during the reopen's await, and `pushModalChart` after an await
  attaches to whatever is on top. Fix with the area steps: pass the `Dialog` to the helpers
  (`d.onCleanup`) instead of the module-level current modal.
- **m3:** skeleton helpers (`components/skeleton.ts`) and the `.dlg-sticky` table rules are not
  used yet; each area step (V-09 "14 + areas") uses them for its lazy parts. The "lazy modal"
  e2e test checks the fixed size, not the loading state itself.
- **m4:** no regression test for U12 (CustomSelect destroyed) and U15 (onClose on replace), the
  footer's left group, or Vitest for `dialog.ts` (Vitest has no DOM environment; adding jsdom
  is a dependency decision).
- **n6 (step 13) rest:** `setBusy` in `instellingen.ts`, `gegevens.ts`, `migration.ts` (PIN
  buttons done in step 14). **n8 rest:** AltGr+T on some layouts (dev menu only).
- **u-\* utilities:** 103 left, almost all in the big modal files; removed with each area step
  (20-25), as R-05/m7.
- **n2:** the profile shows the active tab's pane before its charts are built (two frames).
- **n4:** skeleton colours are raw hex in `styles/skeleton.css` (spec 3.4 values); move to
  `tokens.css` with the next token pass.
- **n5 (step 16):** `:has()` in `styles/dialog.css` (header padding): check WebKitGTK and
  WKWebView versions on the macOS/Linux checklist.
- **n6:** account modal: "Uitloggen" (primary) is in the body, not the footer; with the user menu
  (F-17, step 15).
- **n3:** JS files over 500 lines (`toets-overzicht.js`, `profiel.js`, `toets-edit.js`,
  `scores.js`, `groep-edit.js`, `opdrachten-genereren.js`, `rapport.js`): split in their area
  steps (R-05).

## From Step 15

- **R-05 (shell):** `app.js` (709 lines after the step 15 split) and the new `shell/filter-bar.js`
  stay JS: the filter bar was moved out verbatim (lower risk), not converted. Converting them,
  and splitting the rest of `app.js` (modal helpers, sync notices, navigation), is easier once
  `Store` has types (step 19); do it then or with step 22 (login), which touches the same code.
