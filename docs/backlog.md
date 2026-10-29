# Backlog

Minor review findings and deferred work (PLAN.md 2.3). Newest first.

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
- **Review 5b n1:** a panic inside one compile is not caught; the other workers run all remaining
  jobs before it surfaces. Catch per job (`catch_unwind`) and report it as that job's error.
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
- **Watcher thread panic (n6):** a panic ends change reporting silently; shutdown also waits for
  a slow OneDrive read in progress. Catch, log and restart the thread.
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
- **Step 6 CSP checklist (review 3a m8):** ~~add the PDF output scheme to `connect-src`~~ and
  ~~`isEvalSupported: false`~~ done in 6a. Still open (6b): run `ui/e2e/csp.spec.ts` on a real
  compiled rapport (the mock PDF uses only Helvetica).
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

- **m6 (Step 6):** full third-party notices for the ~300 bundled crates (e.g. `cargo about`) and an
  "Over Maatwerk" screen with licence text and a source link, before the exe is distributed (AGPL
  section 13 / GPL section 6).
- ~~**n1 (Step 3):** CSP~~: done in Step 3a (classes + CSSOM style data, `ui/vite/csp.ts`,
  `ui/e2e/csp.spec.ts`).
- **n3:** `LICENSE` is the SPDX reflowed AGPL-3.0 text; replace with the verbatim gnu.org text when
  gnu.org is reachable.
- **n5:** `src-tauri/tauri.conf.json` `version` duplicates the Cargo workspace version; drop it
  (Tauri falls back to the Cargo version) or check it in CI.
- **n6:** SPDX check skips toml/yml; decide whether config files need headers and whether to add a
  copyright line convention.
- **n9:** CI hygiene: pin actions by SHA (Dependabot), avoid double runs on push + PR, avoid
  installing the Windows target on Linux runners.
- **n2:** keep the two licence allowlists (`deny.toml`, `tools/check-npm-licenses.mjs`) in sync;
  consider generating one from the other.

## Other

- **`rapporten/` retention** (Step 1 decision, ADR-0002 section 9): printed copies accumulate in the
  shared folder; decide a cleanup or archive policy with the user (after cutover).
- **Upgrade to Tauri 3 once 3.0 is stable** (decided 2026-10-25, Step 0). On 2026-10-25 Tauri was
  at `3.0.0-alpha.5` (needs Rust 1.95), plugins at alpha, `tauri-specta` without Tauri 3 support.
  Revisit around Step 10; the thin `src-tauri` layer keeps the upgrade small.
