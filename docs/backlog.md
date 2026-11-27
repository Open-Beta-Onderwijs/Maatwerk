# Backlog

Minor review findings and deferred work (PLAN.md 2.3). Newest first.

## From Step 39 (review `docs/reviews/step-39.md`)

- **n1:** the batch's poisoned-lock recovery around the merge cursor cannot help (a panic in
  `PdfMerger::push` ends the scope anyway); simplify or document.
- **n2:** `PdfMerger::push` changes its state (index, last key, a blank page) before it can fail;
  harmless today (the batch stops merging on an error), but not a clean API.
- **n3:** the "eerdere compilatie loopt nog" count is the one of the last update; it can stay
  shown after the abandoned compile ended, until the next update.
- **8b "Jumps after an error":** considered in 39b, not done (needs the last good source kept and
  its offsets mapped onto the edited text).

## From Step 38 (review `docs/reviews/step-38.md`)

- **m2 rest (step 41, robustness):** Rust and the MockApi mirror differ on input the fixtures
  lack: `decimalen: 2.0` (Rust: afronden 1, UI card: 2), the settings guard (missing vs `null`,
  key order, a write without a login in the mock), the vak limit (64 bytes vs 64 characters).
  Align and add each as a case to the numbers golden (`tools/numbers-golden.mjs`).
- **m4 (step 43, measure first):** a Profiel makes one `vak_numbers` call per school year, and
  each upper-school year loads every year again. Measure `modal:profiel` at 4x; if over budget,
  one core call for several years from a single load.
- **m5 (step 43):** the Groepsoverzicht takes its cells from the active vak and its r/SE from
  `group.subject`; use one subject for both.
- n1 (41): `numbers/load.rs` module doc claims one bad file never fails the call. n2 (44):
  `Store.studentYearAverage` and `getAllExamsSync` have no callers. n3 (43): the `vak-numbers.ts`
  cache resets on an older generation. n4 (43): the Toetsen cards compute stats and histogram
  again although Rust sends them. n5 (43): `vak_numbers` serialises twice (typed result would
  also give specta the shape). n7 (42): the numbers golden could add r at a2/k2 and SE at a0/k1
  (the crate test covers all six already).
- **WebKit on Windows (step 42):** three projectgroepen drag-and-drop tests fail locally under
  `--project webkit` on Windows, on `main` (`66c6909`) too (`po-grading.spec.ts:431`,
  `po.spec.ts:261`, `po.spec.ts:318`); CI runs WebKit on macOS/Linux, where they pass.
  `po-grading.spec.ts:188` (footer "opgeslagen") failed once under load, then 3/3 alone.

## From Step 37 (review `docs/reviews/step-37.md`)

- **m2 (step 41, robustness):** `loadObsUsage` (`ui/src/store.js`) throws on a read error in any
  year, so the Observaties screen fails and Bewerken does nothing. Catch per year, mark the usage
  incomplete; the delete guard and the Toets/PO lock then fail closed with a message. Test.
- **m4 (step 41):** the rubric guard reads every year's exams under the commit lock, so other
  writes from this PC wait on a slow shared folder. Scan outside the lock, re-check changed files
  under it.
- **m5 (user, real exe):** closing right after a grading edit saves it and the window closes; a
  failed save asks first. Also a `tauri-api` unit test of the `listenCloseRequested` wiring.
- n1 (43): bare block in `po-beoordelen.ts` `save()`. n3 (41): empty path and English OS text in
  the Dutch refusal (`storage/mod.rs`, `Error::io("", e)`). n4 (39): `_keep` hard-codes margins
  in `rapport-po.typ`. n5 (41): `IssueKind::Shape` for reference warnings in `validate.rs`. n6
  (44): `loadObsUsage` reads `rubrics` four times; untyped logic in `store.js`. n7 (42): no test
  for `2c970d2` (a throwing close handler still closes).

## From Steps 35-36 (review `docs/reviews/step-35-36.md`)

- **m4 (step 37, PO completion):** the core compares raw member files with what the UI
  normalises (`gradingOf`/`linesOf`), so a regroup can be refused; po-beoordelen writes members
  one by one, so a refusal on member k leaves the ones before it written. Normalise both sides
  as `gradingKey` does, and check every member with `teacherMayWrite` before the first write.
- **m5 (step 38, measured with the grade numbers):** every score write reads the user file,
  `school.json`, every group of the year and the exam. Measure with the 33b spans; cache
  `YearGroups` per (year, vak, user) if it shows.
- **m6 (step 41, robustness):** the rights check and the write are two steps; with `Expect::Any`
  a colleague's change in between is written unchecked, and deleting an unreadable foreign score
  file passes. Return the hash read and write with `Expect::Hash`; fail closed on a read error.
- n1 (42): e2e paste/cut on a locked row. n2 (41): limit the gast presence exemption to its own
  file. n4 (42): share Rust/TS rule cases (number vs string ids, `1` vs `1.0`, case). n6: the
  0.26/0.27 version text, settled at the release.

## Road to 1.0: which step takes what (2026-11-21, `PLAN-2.md` steps 35-45)

Every open item below belongs to one step; the step's "Items" line names them. A step strikes an
item through with its commit when done, or moves it to "After 1.0" with a reason.

| Section                                        | Step                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| 29c PO verzameloverzicht, profile observaties  | 37                                                                      |
| 29c review 29: m1, m6, nits                    | 43 (m1 needs the user's answer)                                         |
| 29c review 29: m4, m5 / m7                     | 38 / 42                                                                 |
| Manual tests 6 and 10 (re-checks, M-SYNC-1..4) | 45b (M-START-3: closed with v1 in 39a)                                  |
| 6b, 6a                                         | compat layer 44b; typst warnings 39b; tests 42; images, messages 41     |
| 5b, 5a                                         | 39 (Typst, v1); 5a m4 and 5b n6 in 41                                   |
| 4b, 4a                                         | 41 (4b overflow: After 1.0)                                             |
| 3b                                             | n4 41; m8 42; "queued saves" 35                                         |
| 3a                                             | styling, m7, U18 43; n5 42; dependency updates 45a (X-02)               |
| Step 2, 2a, 17 m2                              | 39a (most concern v1 goldens) and 39b                                   |
| Step 0 review: n2, n3, n6, n9                  | 42                                                                      |
| 7a                                             | m6, n1 39a; m2 drop or use in 41; n3-n6, n8 41                          |
| 7b                                             | n4 35; reload after Herstellen 41; n5 closed (dev only)                 |
| 7c                                             | perf items 38; read vs. colleague change 41; tests 42                   |
| 8a, 8b                                         | 39b (`LiveEditor`); 8b m6 and "CSP report" 43 (check)                   |
| 9                                              | m3 39b (if left); m7 42; n6 41; n9 43                                   |
| Other (`rapporten/`, Tauri 3)                  | X-06 41; Tauri 3 After 1.0                                              |
| 10                                             | m3, m6, n1, n2 41; n7 42; "Perf at 4x" closed in 38                     |
| 13, 14, 15                                     | 43 (helpers, styling, dialogs); test items 42; R-05 44; 15 m5 35, n6 36 |
| 18, 19                                         | security items 41; 19 m6 38, m8 43, m9 42                               |
| 20                                             | m5 43; m6 42; attempt numbering and `_meta` copy: quirks, 43            |
| 21, 22, 23, 24                                 | 37 (tests of 23 m1/m9 in 37; "Local WebKit" note 42)                    |
| 25                                             | m3/m6 42; n2 43                                                         |
| 26-28                                          | m2 35; m6 41; m7 After 1.0; m8 42; R-05 44                              |
| 32                                             | 40                                                                      |
| 33                                             | m3 43; m4 42                                                            |
| 34                                             | m2, m4 (focus into the panel), nits 43; m6 42                           |
| 35-36                                          | m4 37; m5 38; m6, n2 41; n1, n4 42; n6 at the release                   |
| 33b "Grade cache"                              | part 1 and smaller wins 38; disk cache After 1.0 (user, after 38.7)     |

## After 1.0

- **Tauri 3** (X-03) once 3.0 and its plugins are stable.
- **Disk grade cache** (33b "Grade cache" parts 2-4): not needed after step 38's measurement
  (`docs/perf.md`, user 2026-11-24); reopen if M-PERF-1 on a real copy is slow.
- **Installer and updater**, and the signing itself once the user has the certificates (X-11).
- **4b `ReadDirectoryChangesW` overflow:** revisit if colleagues report missed changes.
- **26-28 m7:** "Vergelijken" (OneDrive conflict copy) and "Toets openen" behind board 12.

## From step 29c (overviews, 2026-11-15)

- ~~**PO verzameloverzicht**~~: done in step 37 (`0475956`).
- **Review 29 (deferred minors):** m1 exam overview Observaties counts students without a score
  but takes the percentage of those with one (asked the user which population to use); ~~m4~~
  and ~~m5~~ done in step 38.6 (`bae4004`: refresh loads first; preload, `examStats` from the Rust
  numbers); m6
  duplication (histogram card, heat tint, info icon, `signed`, obs sort); m7 test gaps; nits
  n1-n7 (`docs/reviews/step-29.md`), among them ~45 unused utility classes in `style.css`.
- ~~**Profile observaties**~~: done in step 37 (`7045331`, the user's OK on the numbers).

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
- ~~**M-START-3** could not be run: a v1 folder has no `schema_version` (the checklist now says to
  add it). Re-run after Step 7a writes `schema_version`.~~ Closed (39a): the v1 path is gone; M-START-3 runs on a converted copy, M-MIG-6 covers a v1 folder.
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
- ~~**Review 6 n10:**~~ Done in step 41: `opdracht_images::import_file` reads the picked file,
  refused above 25 MB before reading. Was: read in the shell with no size cap.
- **Review 6 m3 (rest):** the real-PDF test runs under the mock CSP (`blob:`), not through the
  `maatwerk-out` scheme, and does not fail on pdf.js warnings (manual `M-TOE-5` covers the scheme).
- ~~**Review 6 n9 (rest):**~~ Done in step 41: the message names each field's types (SVG for the
  watermark); uploads over 5 MB are refused.

- **Compat layer stays (PLAN Step 6b):** `TauriApi` is the only backend in the app bundle (CI
  checks the bundle has no MockApi), but no legacy screen uses the typed results yet, so the
  compat shapes in `ui/src/bridge/tauri-api.ts` stay. Per ADR-0002 they are removed screen by
  screen in Step 10, as each screen moves to TypeScript and the typed `{ code, message }` errors.
- **Command-level tests (from 6a):** covered by `docs/manual-test.md` for now (M-OPD-4/5,
  M-TOE-6/7, M-START-3/4); a `tauri::test` mock-runtime test remains a Step 10 option.

## From Step 6a

- ~~**Typst warnings are only logged:** the render commands return compile warnings (tofu etc.,
  deduplicated); `TauriApi` writes them to the console. Show them in the editor preview and the
  generate/rapport modals (6b or Step 8).~~ Done: the modals since F-04 (`render-warnings.ts`);
  the editor marks warnings in the open file, and since 39b the others (no place, or in
  `lib.typ`/`main.typ`) show in the status pill ("Opgeslagen · 1 waarschuwing", details).
- ~~**`rapporten/` retention:**~~ Done in step 41 (X-06, decision 85): size and "Opruimen" in
  Beheer › Instellingen.
- **Command-level tests:** the Tauri commands are thin and their core functions are tested, but
  no test invokes a command through Tauri (`tauri::test` mock runtime). Add a few for the
  render/print/image commands, or cover them in the 6b manual checklist.
- ~~**Startup error screen (4b m5)**~~ Done (6b): `data_folder_status` + `restart_app`,
  `ui/src/screens/startup-error.ts`, quirks.spec "4b m5".
- ~~**Review 6a m4:**~~ Done in step 41: thumbnails cached by content hash, decoded with
  `image::Limits` (16 384 px, 512 MB). Was: every image decoded on each call, no limits.
- ~~**Review 6a n7:**~~ Done in step 41: "De bestandsnaam bevat tekens die Maatwerk niet kan
  lezen…". Was: "Bestandstype . wordt niet ondersteund."
- ~~**`save_photo` takes image types only (review 6a M1)**~~ Done (6b): the logo input accepts
  the six image types and other types get a Dutch toast (quirks.spec "6a M1").

## From Step 5b

- **Review 5b m2 (Step 6):** `TypstProject::folder` accepts any root and does not bound links on
  it; today only the CLI uses it (a path the user typed). Before the app opens v2 opdracht folders
  (Step 7/8), add an app constructor from `DataDir` + `RelPath` with `.within(data root)` and keep
  `folder` for the CLI.
- ~~**Review 5b n1:** a panic inside one compile is not caught; the other workers run all remaining
  jobs before it surfaces. Catch per job (`catch_unwind`) and report it as that job's error.~~ Done (Step 10): `BatchError::Panic`.
- ~~**Review 5b n2:** the batch holds every job's PDF until the merge (fine at ~35 KiB per job,
  `docs/perf.md`); opdrachten with large photos could change that. Merge in job order as results
  arrive if a real class batch gets heavy.~~ Done (39b): `PdfMerger` merges in job order as jobs
  finish and drops each PDF (same bytes as `pdf_merge`, test).
- ~~**Review 5b n3:** tofu warnings repeat once per job in a batch~~ Done (6a): the batch
  command deduplicates the warning texts across jobs.
- ~~**Review 5b n4:** decide before the first release whether the lib.typ/main.typ hash
  normalisation also ignores trailing whitespace/final newline.~~ Done (39b, user 2026-11-25: yes): release hashes recomputed, a test per released text.
- ~~**Review 5b n5:** the mount boundary is the data dir, so a junction from `images/<id>` to another
  opdracht's images is followed. Tighten to `opdrachten/images/<id>` if Step 7 keeps v1 folders.~~ Done (39a, `b9fab11`): only opdracht folders are mounted; a junction to another opdracht is denied (test).
- ~~**Review 5b n6:**~~ Done in step 41: arguments via `args_os` (a non-UTF-8 one is a usage
  error), PDFs written to `.partial` and renamed.
- ~~**Review 5b n7:** the old app removed stale `opdrachten/_preview_*.typ` at start; nobody does now.
  Step 7 migration deletes them.~~ Closed (39a): `_preview_*.typ` only existed in v1 folders, which the 0.29 conversion cleans.

## From Step 5a

- ~~**Review 5a m3:** an error in eval'd teacher text (leeradvies, uitleg) points at the `eval`
  call in `rapport.typ`; pre-parse each field and name it (student, category) in the diagnostic.~~
  Done (39b): after a failed rapport each distinct text is compiled on its own; the first error
  gets the hint "de fout zit in het leeradvies bij T1 voor <naam>" (toets and PO rapport).
- ~~**Review 5a m4 (watcher, Step 4b code):**~~ Done in step 41: a file not hashed yet whose
  mtime is under 3 s old counts as changed when an event arrives with an unchanged stat (hashing
  every file at start would download OneDrive on-demand files, D36). Was: a colleague's write
  with the same size inside one mtime tick of the previous state is not seen as a change.
- **Review 5a nit n8 (done 2026-10-28):** the pixel tests and golden PNGs no longer use system
  fonts (`support::fonts`, `--ignore-system-fonts`). The app still uses them; an installed
  "Libertinus Serif" could still shadow Typst's own copy there. Nits n1-n6 and n9 were done in 5b.
  The app part done in 39b: Typst's fonts come before the system fonts in `FontStore`.

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
- ~~**Lock folder errors carry an absolute local path (n4, remaining part):**~~ Done in step 41:
  errors name the data file (or "(lokale vergrendeling)"); the log keeps the lock path. Was:
  `CommitLock` errors name the lock folder under `%LOCALAPPDATA%` (with the Windows user name).
- **Overflow of `ReadDirectoryChangesW` (review 4b M1 note):** `notify` drops it silently; the
  periodic re-start of OS notifications plus the poll limit the damage. Revisit if colleagues
  report missed changes in non-active years.
- ~~**`set_scope_year` not wired (n3)**~~ Done (6a): `set_watch_year`, called by the UI at
  `initSubject` and on the year selectors.

## From Step 4a

- ~~**`update()` does not retry a read that fails with `io` (review 4a m6):**~~ Done in step 41:
  every read retries a sharing error with the rename backoff (`atomic::read_retrying`, tested
  with an injected read). Was: on Windows a read can hit a file that is being replaced.
- ~~**RTTI modal and an unreadable template file (review 4a m4):**~~ Done in step 41: saving asks
  "Overschrijven"; the write is checked against the hash of the unreadable bytes (`corrupt_json`
  `details.found`), so only that file is replaced (e2e "4a m4"). Was: every save conflicted.
- ~~**`Locked.path` names the local lock file, not the data file (n4).**~~ Done in step 41.
- ~~**`update_locks` map never shrinks (n6):**~~ Done in step 41: an idle file's entry is
  removed after its update.
- ~~**`read_all_json` skips non-UTF-8 files, `read_json` decodes lossily (n7):**~~ Done in step
  41: aligned (lossy), quirk D37.
- **`save_photo` is stricter than Node's base64 (n8):** invalid characters are an error, not
  skipped. Record in quirks if a real caller ever sends such data.
- ~~**`schema_version` checked only at open (n9):**~~ Closed in step 41: a migration writes
  `minAppVersion` first, and every write checks it (`Storage::read_only`), so an app running
  on a folder another PC migrates turns read-only at its next write.
- ~~**Blind `Expect::Any` writes still possible in the core API (n10):**~~ Done in step 41 for
  the UI: the `write_json` command refuses `cas: false` (every UI write reads first). The core
  keeps `Expect::Any` for text files, presence and migrations; the mock allows it for seeding.
- ~~**JSON edge cases (n11):**~~ Accepted in step 41: the files are written by the JS UI, which
  never produces integers above 2^53; a lone surrogate escape is reported as a corrupt file in
  Gegevenscontrole, which is the right place to fix it. Was: integers above 2^53 are printed
  exactly (JS would round); a lone surrogate escape is rejected as corrupt.
- ~~**No on-disk test for non-ASCII names or paths over 260 characters (n12).**~~ Done in step 41
  (`non_ascii_names_and_long_paths_round_trip_on_disk`).
- **Junction created between `resolve` and the write (n13):** needs local write access to the data
  folder; accepted.

## From Step 3b

- ~~**Cut (Ctrl+X) in the score grid (review 3b m5):**~~ Done in step 25 (F-03).
- **Licence ban covers production deps only (review 3b m8):** `tools/check-npm-licenses.mjs` walks
  `--omit=dev`; Vite would bundle a dev dependency if UI code imported it. Add a check on the
  built bundle (or an ESLint import rule) when the dependency list grows.
- ~~**Colleague change on an unsaved cell (review 3b n4):**~~ Done in step 41: the mark goes when
  a colleague's value replaces the cell (e2e "3b n4"). Was: the cell kept its "not saved" mark.
- ~~**Queued saves stamp the user at run time:**~~ Closed in step 35: score files carry no
  `updatedBy`; the core now checks every score write against the session, so the backend logout
  waits for the queued saves and a new PIN check waits for that logout. Was: `updateStudentScores` stamps `_meta.updatedBy` when
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

- ~~**m3/m4 (Step 5):** Typst error goldens: normalise canonical and 8.3 temp paths too, and compare
  diagnostics separator-neutrally (`\` vs `/`).~~ Closed (39a): the harness that captured the goldens went at 1.0; 39b rewrites them from the port.
- ~~**m6 (Step 5/6):** store an explicit merged-page map for batch goldens (job, page, blank) and
  PNGs for multi-job batches if pixel parity of the merge matters.~~ Closed (39a): no reference capture any more; the batch tests check pages and text.
- ~~**m7 (Step 6):** record `assignment:progress` events in the batch goldens. (6a: the event is
  wired; the goldens still only check "0, then one per job".)~~ Closed (39a): no reference capture any more; the Rust batch tests check the progress events.

## From the Step 2a review (`docs/reviews/step-02a.md`)

- ~~**n4:** `attempts` golden: store the grade `resolveBestAttempts` compared
  (`Store.calcResults(...).grade`) next to each history entry, so the case explains itself.~~ Closed (39a): the harness that wrote the goldens went at 1.0.

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
- ~~**m6:** CI check that `tools/fixtures/to-v2.mjs` and `maatwerk-cli migrate` give the same tree
  for the tiny fixture (ignoring `_meta.hash` and migration-added `_meta`).~~ Closed (39a): moot, the core v1 migration went at 1.0 (decision 88).
- ~~**n1:** `TypstProject::opdracht_v1`/`v1_opdracht_id` are only used by tests and an example now;
  remove after the cutover.~~ Done (39a, `b9fab11`).
- ~~**n3:**~~ Closed in step 41: the v1-to-v2 merge went with 39a; `data-files-v2.md` now says
  it is history. Was: the data-files-v2 text on merging duplicate students vs. the Rust merge.
- ~~**n4:**~~ Done in step 41: a conflict copy must hold the original's id; another id is a
  placement error (test first).
- **n5:** validate at admin login reads every year (Files-On-Demand downloads) and stamping clones
  each file. Step 41: moved to 45b (manual tests on a real copy): only measurable there, and
  checking fewer years could hide errors.
- ~~**n6:**~~ Done in step 41: the toggle saves a copy; a failure leaves the cache and screen
  as they were (e2e first).
- ~~**n8:**~~ Done in step 41: `encode` keeps the file's other top-level keys (Vitest).

## From Step 7b (review `docs/reviews/step-07b.md`)

- ~~m1: two PCs that start in the same minute can both write a snapshot (the claim in
  `snapshots/state.json` is per OneDrive replica). Option: after claiming, wait 20-60 s on the
  background thread, re-read the state and give up if another PC claimed later.~~ Done (Step 10): 45 s settle wait.
- ~~m6: test for losing the snapshot claim to a concurrent writer (needs a hook between read and
  CAS in `Storage`).~~ Done (Step 10): injected settle hook.
- ~~n4~~ (closed in step 35: the core re-checks the role at every guarded write, the UI's
  `isSectiebestuurActive` reads `school.json` each time). Was: the sectievoorzitter role is checked against `school.json` only at login; a removal by the
  admin takes effect at the next login.
- n5: the Rust login session survives a webview reload (dev only; release builds have no reload).
- ~~After "Herstellen uit snapshot" of year data (groups, exams, scores) the Store reloads it only
  at the next login.~~ Done in step 41: the restored file goes through `Sync.refresh`, the path
  of a colleague's change (e2e "a restored group shows at once").

## From Step 7c (perceived speed)

- ~~**Read vs. colleague change, file not cached yet**~~ Done in step 41: the store counts
  external changes per path; a single read that saw one reads again, a folder read does not
  cache that file (`ui/src/store.test.ts`). Was (older than 7c, also with single reads):
  a score file read in flight when the watcher reports a colleague's change to that file is not
  refreshed (the event is skipped because nothing is cached yet), so the read's older content
  stays until the next login. Window: one read. Option: count external changes per path while
  a read is in flight and read again.
- **First tab visit after login at 4x CPU** is above 100 ms (Toetsen 113, admin Leerlingen 217,
  admin Groepen 154 p90; `docs/perf.md`): the first folder reads and statistics. If the real
  copy (M-PERF-1) shows it at 1x too: start `preloadScores` for the active year in idle time
  right after login.
- ~~**Review 7c m4 (rest):**~~ Done in step 38.6 (`bae4004`): `loadInstellingen` keeps the cached object when nothing changed. Was: `loadInstellingen` and `invalidateSchool` (School screen) drop a cached
  entry on every visit, which counts as a change, so the kept screens render once more for nothing.
  Load Instellingen without invalidating (the versioned read gives the rev).
- **Review 7c m5 (rest):** e2e for a colleague's change to a group still waiting for idle time
  (stub `requestIdleCallback`), closing the score modal while groups are pending, and the 15 s
  prebuild TTL.
- ~~**Review 7c n2:**~~ Done in step 38.6 (`bae4004`, list render hook). Was: closing the score modal after a save redraws the exam list without updating
  the kept-screen key, so the next Toetsen visit renders once more.
- ~~**Review 7c n5:**~~ Closed (step 38.6 check): the card has a fixed `height: 66px` since step 27 and the intrinsic size is the same 66 px. Was: `contain-intrinsic-size: auto 40px` on student cards is an estimate; measure a
  real card (cards not shown yet count as 40 px for the scrollbar).
- **e2e `examMenuItem` retries** because Playwright's scroll-into-view delivers a `scroll` event a
  frame after the click, which closes the menu. Replace the retry with the scroll-first click of
  `openExamMenu` in `ui/e2e/perceived-speed.spec.ts`.

## From Step 8a (review `docs/reviews/step-08a.md`)

- ~~**m2 comemo shared by batch and editor:** `evict(10)` is process-wide; a batch ages the
  editor's cache out.~~ Done (39b): batch workers defer eviction and the batch evicts every 4
  jobs and at the end (a 30-job batch ages the editor's entries 8 steps, not 30; the cache holds
  about 40 jobs' entries, review 39 m1). Option: evict by the editor's own compile count only, or evict less
  often while a session is open. Step 8b measured 1-2 ms per edit without a batch (`docs/perf.md`);
  a batch costs the editor one full compile afterwards. Revisit with a large opdracht.
- ~~**m6 rest:** tests for a compiler panic (hard to provoke) and `close()` during a compile.~~
  Done (39b): a clock that panics once stands in for the compiler.
- ~~**n2:** after a panic in the SVG render, `failed()` reports a `preview_generation` the client
  never got (set `document` only after the render succeeded).~~ Done (39b).
- **n3:** `close()` called from the sink would join its own thread. The app's sink only emits an
  event (never blocks, never closes); keep it that way (documented on `LiveEditor`).
- ~~**n5:** one moved mount drops the disk files of every mount (performance only).~~ Done (39b).
- ~~**n6:** check staleness between pages of the SVG render too.~~ Done (39b).

## From Step 8b (review `docs/reviews/step-08b.md`)

- ~~**m5:** help queries whose caller gave up (2 s) still run later on the compile thread and count
  against the next compile's time limit; pass a cancel flag.~~ Done (39b): skipped when reached.
- **m6:** the editor iframe uses `window.confirm` (close with unsaved changes since 3a, "Herstel
  standaardversie" since 8b); move both to the app's own dialog (Step 10).
- ~~**n1:** vragen checks: string punten count as missing, an image-only answer as empty, "buiten
  een opgave" only before the first opgave.~~ Done (39b): string punten parsed (else their own
  check), "(zonder tekst)", and `maatwerk-lib 3` marks a vraag after an opgave as outside it.
- ~~**n4:** the bundled `main.typ` still has the cursor-marker code~~ Done in `maatwerk-main 2`
  (0.3.1): no marker in `main.typ`, no `cursor` in `OpdrachtInputs` or `render_assignment_svg`.
  The command itself has no caller in the editor any more; remove it in phase 2.
- ~~**n6:** while two abandoned compiles still run, the editor waits silently; say so.~~ Done
  (39b): updates carry `abandoned`; the pill says "Compileren… (1 eerdere compilatie loopt nog)".
- ~~**n8:** the line diff is quadratic in memory; cap it or use a linear diff for very large copies.~~
  Done (39b): shared start and end lines first, LCS on the middle, removed/added above 2M cells.
- **Jumps after an error:** while the last compile failed, preview clicks and the cursor sync do
  nothing (by design, review 8a n7); consider mapping through the last good source.

- **CSP report on native editing:** typing over a multi-line selection makes Chrome insert a
  styled span in the editor's contenteditable, which the CSP blocks and reports (seen in e2e;
  CodeMirror rewrites that DOM, nothing visible). Check whether real typing triggers it.

## From Step 9 (review `docs/reviews/step-09.md`)

- ~~**m3 No time limit in headless `assignment check`/`render`.** A runaway loop in an opdracht
  hangs the CLI until Ctrl+C. Reuse the editor's watchdog (`LiveEditor`) or run the compile on a
  thread with a deadline before the in-app assistant uses it (ADR-0009 constraint 4, option D).~~
  Done in step 32 (`assignment::with_time_limit`, CLI `--timeout`, AI check); struck in 39b.
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
- ~~**m3 (rest):**~~ Done in step 41: quitting during the settle wait releases the claim
  (`Outcome::Stopped`); once the zip has started the claim stays and goes stale. Was: an app
  closed during the 45 s snapshot settle left its claim for 30 min.
- **m6:** exam delete is a blind delete after a stale scores check (reference behaviour): CAS on
  `delete_file` and re-check scores after the confirm. Step 41: part of the edit locks
  (sub-task 5): the core refuses deleting an exam with data, under the commit lock.
- ~~**n1:**~~ Done in step 41: `CoreSlot::set_closing` at `Exit` (a core opened later starts
  nothing); a panic in `Core::failed` too fills the slot with `Core::broken`.
- ~~**n2:**~~ Done in step 41: the error message waits for the startup's own import of
  `app.js`. Was: an error before `legacy/globals` loads made the handler import `app.js` early.
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

- **R-05 (shell):** `app.js` (789 lines after the step 15 split, from 1209) and the new `shell/filter-bar.js`
  stay JS: the filter bar was moved out verbatim (lower risk), not converted. Converting them,
  and splitting the rest of `app.js` (modal helpers, sync notices, navigation), is easier once
  `Store` has types (step 19); do it then or with step 22 (login), which touches the same code.
- **Review 15 m5** (step 35: not made worse; the secretaris dropdown writes `school.json`, not
  user files; stays for 43): a teacher's look or year change bumps their user file's rev, so an admin's
  open Gebruikers edit of that teacher ends in a save conflict (the message tells them to reopen).
  Rare; if it bites, give the Gebruikers form a field-level merge.
- **Review 15 m2 / step 18:** the migration must write `school.json` (with the higher
  `minAppVersion`) first; the guard sets no limit while `school.json` is unreadable. Also decide
  whether a newer `schema_version` with a `minAppVersion` opens read-only (runbook section 8).
- **Review 15 m6:** e2e gaps left: another user logging in after logout on the same PC (look,
  year, filters reset); the U11 test waits 300 ms to see extra writes (a fixed wait).
- **Review 15 n4-n6:** the version compare exists in Rust and in TS (the TS copy is used by the
  mock only); three HTML-escape helpers (`app.js`, `avatar.ts`, `user-menu.ts`) could share one
  `utils/html.ts`; presence reads `school.json` twice per heartbeat when read-only.

## From Step 17 (review `docs/reviews/step-17.md`)

- ~~**Review 17 m2:** a blessed Typst golden keeps the reference's `call`/`result` but its `pdf`
  text and PNGs are the port's; split into `reference.pdf` / `port.pdf` so both stay readable.~~
  Closed (39b): every Typst golden is now the port's output on Typst 0.15.1 (`port.blessed`); the
  reference's renders are history (decision 9).

## From Step 18 (reviews `docs/reviews/step-18.md`, `step-17-18-security.md`)

- ~~**Security m4:**~~ Done in step 41: `read_photo_data_url` does not read a file over 5 MB
  (watermark, logo, photos). Was: `applyWatermerk` read the watermark whole at every start. The
  v2-to-v3 migration still reads each moved image whole once (a one-off, kept).
- ~~**Security n1:**~~ Done in step 41: the CLI's text output escapes control characters
  (`plain`). ~~**n4:**~~ Done: messages name a value briefly (an object by its id, else cut at
  60 characters). ~~**n5:**~~ Done: `prune_stale` reads only files not changed in 30 days.

## From Step 19

- ~~m6~~ Closed in step 38: the list screens compute in Rust (`vak_numbers`); the WASM entry parses its arguments once (`24e10ad`). Was: send only the fields the rules read in each WebAssembly call.
- m8: a message when WebAssembly cannot start; today an empty window. Check the oldest supported macOS WebKit for `'wasm-unsafe-eval'`.
- m9: tests of how the screens call the rules (the rules are tested; which arguments a screen passes is not).
- n3, n6, n7 in `docs/reviews/step-19.md`.

## From Step 20

- `attempt` of a new resit is `resits.length + 2`: after a resit is deleted the next one can repeat
  a number. The order on the tree is then decided by `volgnummer` and insertion order. Harmless so
  far; a number one above the highest would be cleaner. Reference behaviour, unchanged.
- Two attempts with the same first letter (two inhaals, or "Anders" starting with an I) get the same
  code, `501-I`. Reference behaviour, unchanged.
- A new resit copies every field of the original with `...parent`, `_meta` too. Works today; a
  cleaner copy would leave `_meta` out.
- `toets-overzicht.js` (1200+ lines) stays JS until step 29, its area step (R-05 rule, step 13).
- Review 20 m5: `aria-pressed` on Schoolsoort, Jaarlaag, Periode, Subcategorie and the question row buttons (state is only a class).
- Review 20 m6, tests still missing: confirm when only an attempt has scores; locked top fields unchanged on saving; Verzamelkaart `obs_ids` and resit title; wiskunde interlock in Nieuwe toets; keyboard focus on Soort poging.

## From Step 21

- Done in step 37: m2, m3 (`cbe8a84`: the guard fails closed and checks under the commit lock),
  m6 (`59e6b68`: every year and vak), n7 (`b5676d0`: error code), n8 (`2bf0f12`: one
  SCHOOLSOORTEN list, RubricUse with From), n9 (`1c4ce5c`).
- m1 closed (step 37): since step 35 every login raises `minAppVersion` to 0.26.0, so the 0.12.0
  raise of a PO observatie or the first rubric can no longer happen; no notice needed.
- n8 rest, by design: the mock's rubric guard repeats the core's Dutch messages (the mock has no
  core).
- `observaties.js` stays JS (R-05, area step 30); the toetstype parts are in TS beside it.

## From Step 22

- Done in step 37 (`validate-data`): 22 n5 (a `rubric` field, a herkansing with another rubric) and
  PO scores of a student in no projectgroep.
- The Toetsen list re-renders after its statistics load and closes an open ⋮ menu (seen again in
  `po.spec.ts`; the helpers retry).

## From Step 23

- Done in step 37 (`340fc97`, `2c970d2`): m1/m9 tests, m4 (save before the app closes, quit
  guard), n1 (one save at a time), n3 (live table status).
- Review 23 n4: done in step 37 (`validate-data`).
- Local WebKit on Windows: Playwright's `dragTo` does not work (the step 22 and 23 drag tests fail
  there, also on `main`); CI runs WebKit on Linux and macOS, where they pass.

## From Step 24

- Done in step 37 (`236e1b2`, `0f98efd`, `27d2f08`, `d74fdb6`): m3 (partly graded warning), m4
  (no rapport for a member graded in another group), m5 (averages add up, user's rule B), m6
  (unplaced on a resit), m7 (a block taller than a page breaks), m8 (tests), n1, n3, n5.

## From Step 25

- **Review 25 m3/m6:** e2e for the score modal's help popover and footer save status, and for
  Ctrl+X over observatie and Cijfer cells (behaves as Delete).
- **Review 25 n2:** `screens/scores/group-grid.ts` is ~525 lines; move the keyboard handler into
  its own module when it next changes.

## From Steps 26-28

- **Review 26-28 m2:** ~~Gebruiker bewerken writes the photo before the user record (rev check); a
  refused save leaves the new photo in place.~~ Fixed in step 35 (the old photo is put back, a new
  one removed; no e2e: the crop needs a real file). Removing a photo (both dialogs) leaves the file.
- ~~**Review 26-28 m6:**~~ Done in step 41: `list_snapshots` returns each kind from
  `maatwerk_core::snapshots::kinds`; the TS copy of the rule lives only in the mock. Was: the snapshot kinds in Instellingen repeat `maatwerk-core::snapshots::keep`
  in TypeScript; let `listSnapshots` return the kind instead.
- **Review 26-28 m7:** board 12 "Vergelijken" (OneDrive conflict copy) and "Toets openen" (a broken
  reference) need features behind them; those findings get "Map openen" for now. The rapport
  reads only the SVG watermark (D29 is closed for the app only).
- **Review 26-28 m8:** e2e for the grade fill on upper-school cards (the fixture has no years
  4-6), the CSV examples through the importers' own checks, Escape during the avatar flight.
- **Review 26-28 nits:** see `docs/reviews/step-26-28.md` (n1-n6).
- **R-05:** `screens/school.js` was touched in step 28 and is still JS.
- **X-06** (`rapporten/` retention): waits for a decision.

## From Step 32

See `docs/reviews/step-32.md` for the evidence of each item.

- ~~**Review 32 m3-m12** and the nits~~ done in step 40 (2026-11-26; `docs/STATE.md` step 40).
  Left: `panel.ts` is 816 lines after the Applier moved out (the panel's state machine);
  `editor-ai.css` (1645) and `composer.ts` (655) not split.
- **Real CLIs:** Codex, Gemini CLI, Antigravity and Copilot CLI are untested against the real
  programs (ADR-0009 _verify_ rows); they carry the "bèta" tag (decision 89). Claude Code and
  Mistral Vibe passed in step 40. Vibe image input in `-p` unverified.
- ~~**Logos**~~ no vendor logos (user, 2026-11-26): letter buttons CC, GPT, G, AG, V, CP.
- ~~**Resizable AI panel (user 2026-11-19)**~~ done 2026-11-20 (`aiPanelWidth`, 380 px minimum).

## From Step 40

See `docs/reviews/step-40.md`. Open: m7 (Unix: processes the CLI leaves without holding the
pipes survive a normal exit; Windows ends them with the job), m9 rest (e2e with two providers'
pending images, a detached grandchild test, the run folder in the privacy test), n1 (a
rolled-back save flips the history's "applied" until the next save), n4 (`Guard::wait` and
`with_time_limit` are two helpers; given-up work runs to its limit), n5 (the job end may cut
off a CLI's background self-updater; consider `DISABLE_AUTOUPDATER=1` for Claude Code), n6
(`workspace.rs` 568 lines: move `write_context` into `workspace/`).

## From Step 34

Review `docs/reviews/step-34.md`: m2 (every re-render of the Opdrachten list rebuilds the preview
panel: its scroll position and focus are lost; keep the panel outside `#opdracht-list`), m4 in
part (focus does not move into the panel on open; the rest is fixed), m6 (e2e: Opdrachten filters
and their empty state, reduced motion, switching during the close animation, escaping of names),
and the nits. Also: the preview does not notice a colleague changing only `opdracht.typ` (no
`_meta.rev` change) until the editor is opened here or the app restarts.

## From Step 33

Review `docs/reviews/step-33.md`: m3 (tab order reaches the attempts only after the rest of the
row), m4 (test gaps: `gridHtml` unit test; e2e for a Verzamelkaart click, a PO Verzamelkaart, one
open stack per row, more than three attempts; a stronger reduced-motion check; the Verzamelkaart's
observatie rule shared with `exam-overview/data.ts`), and the nits.

## From the perf hotfix 0.24.1 (step 33b)

### Grade cache: compute once, keep on disk (user 2026-11-20)

**Idea (user):** most grades rarely change, older school years almost never. Keep the computed
numbers in a cache that is built in the background and saved to disk, in a data structure that
is fast to read, with averages and other slow-changing numbers precomputed, so Maatwerk does not
compute everything live on every login.

**Where the time goes (measured 2026-11-20, `docs/perf.md` "Perf hotfix 0.24.1"):**

- Reading is cheap: `read_json_dir` of one year's `scores/<vak>/` (600 files) ~300 ms at 4x CPU,
  decode ~50 ms. Step 7c's decision "no disk cache, the disk was never the cost" still holds for
  the _raw files_; the cost is _computing_.
- Computing happens in the webview, in the grade rules compiled to WebAssembly (ADR-0011), one
  student at a time. A large part of each call is marshalling: JSON text out, `TextEncoder`,
  serde `Value`, then `from_value` (parsed twice), and the answer back the same way. Before
  0.24.1 the exam with all its questions crossed the boundary once per student per attempt.
- After 0.24.1, at 4x CPU on the `school` fixture (600 students, nat): the Leerlingen card
  numbers take ~4-7 s in the background (year average per student, and for years 4-6 the SE over
  _all_ years via `getStudentHistory`), Groepen ~1.5-4 s, Toetsen ~0.8-0.9 s. All of it is redone
  after every login, and after every data change for the screens it touches (`Store.generation`).
- The only cache today is in memory: `Store.examResults` memoised per (record, exam) object
  (`store.js` `examResultsMemo`), card HTML per data generation (`cards/student-grades.ts`). Both
  are gone at the next login, and the `*Many` batch calls of 0.24.1 bypass the memo.

**Suggested approach, in order (each step useful without the next):**

1. **Compute natively, not in the webview.** `maatwerk-core` already depends on
   `maatwerk-grades`. A Tauri command "numbers of a year and vak" (all students: results per
   exam, year average, SE; per exam: mean, SD, % onvoldoende, histogram bins, observatie counts;
   per group: the card numbers) run under `spawn_blocking` is native speed, off the UI thread, and
   reads the files where they are (no IPC per record). The UI only renders. This alone probably
   removes most of the wait; the WASM rules stay for the live score grid. It also means numbers
   come from one place.
2. **Keep the results on disk, keyed by their inputs.** Every data file already carries
   `_meta.hash` (and exams/groups `_meta.rev`). A cache entry is valid while the hashes of its
   inputs match: score file hash, exam hash, rubric hash (PO), and a **rules version** (the
   `maatwerk-grades` version or a hash of its source, set at build time). A mismatch recomputes
   that entry only. Older years then cost nothing after the first run.
3. **Precompute aggregates** per (year, vak): per exam the Toetsen card numbers (incl. the
   Verzamelkaart), per group the Groepen card numbers, per student the year average and SE. These
   are exactly what the list screens show.
4. **Stale-while-revalidate:** show the cached numbers at once, check the input hashes in the
   background, update the cards that changed.

**Invalidation (the hard part; write it down before coding):**

- Score file of a student -> that student's results, year average, SE (all later years for
  years 4-6), and every aggregate the student is in (exam, group).
- Exam file (n_term, questions, weights, kind, parent/attempt) -> every result of that exam and
  of its resits, all averages of the year, the SE of upper-school students (a resit takes its
  weight from its original, decision 10, possibly in another year file).
- Rubric -> every PO graded with it. School/config settings that feed the rules (check which).
- Group membership -> group aggregates only. Observaties do not change grades but do change the
  Toetsen card counts.
- Colleagues' changes arrive through the watcher per path (`Store.generation`), so a
  path-to-entries dependency map gives targeted invalidation. Own writes are not echoed by the
  watcher: the write path must invalidate too.
- A new app version with changed rules invalidates everything (rules version in the key).

**Decisions for the user before starting:**

- **Where the cache lives.** (a) Per PC in `%LOCALAPPDATA%/Maatwerk` (Mac/Linux equivalents):
  no sync conflicts, but a copy of grades outside the shared data folder on every laptop
  (privacy/AVG: it must be removable, e.g. on logout or "Gegevens"), and every PC builds its own.
  (b) In the shared data folder (e.g. `.cache/`): built once for all colleagues, but written by
  several PCs and app versions at once, synced by OneDrive/network shares; needs per-writer
  files or a lock, and old app versions must ignore it (minimum-version guard).
- **Format.** One file per (year, vak) in a compact binary format (`postcard`/`bincode`, MIT/
  Apache) or SQLite (`rusqlite`, MIT; SQLite is public domain). A single file per (year, vak) reads
  in one go; SQLite gives partial updates and indexes but is more to maintain. Either way the
  cache is disposable: deleting it only costs time, never data.
- Whether step 1 (native numbers) alone is enough, measured, before building the disk cache.

**Rules that apply (`PLAN-2.md` section 2):** any change to a grade, average, SD or percentage
needs a before/after table on the fixtures and the user's OK. Test: cached == live for every
number on `tiny` and `school` (and a property test over random edits). The cache holds derived
student data: never in the repo, never in fixtures, covered by the "Gegevens" reset.

**Smaller wins found on the way (independent of the cache):** all done in step 38.6
(`24e10ad` WASM parse once; `bae4004` history map, `yieldSlice`, `topbar-fit` next frame). The
fills after login no longer compete: the list numbers come from one native call per year and vak.

- `maatwerk-grades-wasm` `parse` decodes JSON text to a `Value` and then to the type: use
  `serde_json::from_str` per argument (or one typed tuple) to parse once.
- `getStudentHistory` looks each exam up with `exams.find` per score entry (`store.js`): a map per
  year, built once per fill.
- `cards/student-grades.ts` fills in fixed batches of 40 per frame; `utils/idle.ts` `yieldSlice`
  (0.24.1) keeps tasks under ~8 ms instead.
- `shell/topbar-fit.ts`: its MutationObserver forces a synchronous layout of the whole new screen
  right after a tab switch (~250-370 ms at 4x on a cold Toetsen); measure in a `ResizeObserver`
  or the next frame instead.
- After login the Leerlingen fill and the other tabs' first visits compete; with a cache (or
  native numbers) this goes away, otherwise start the fills in idle time.

**How to measure (keep using it):** `node tools/fixtures/generate.mjs school <dir>/shared/data`,
`maatwerk-cli migrate --apply --backup-dir <dir>/backups <dir>/shared/data`, then
`node tools/perf/measure.mjs --data <dir>/shared/data --cpu 4 --runs 3 --exams 2`: the `first`
column is the first visit after login. For function-level profiles the release bundle is
minified: profile `npm run dev:mock` with `MAATWERK_FIXTURE=school` in Chromium (CDP
`Profiler`) instead. The synthetic fixture gives every student scores in every exam of the vak;
real data (an exam per jaarlaag) has far fewer graded records per exam, so check on the user's
real copy too (M-PERF-1).
