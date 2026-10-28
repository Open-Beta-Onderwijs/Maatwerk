# Backlog

Minor review findings and deferred work (PLAN.md 2.3). Newest first.

## From Step 5a

- **quick-xml advisories ignored (RUSTSEC-2026-0194/0195, `deny.toml`):** pulled in by typst 0.14.2
  through hayagriva/citationberg; the fix needs quick-xml 0.41. Re-check when moving off the
  typst 0.14 line.
- **Golden pixel tests depend on the system emoji font:** `rapport-valid` is pixel-identical with
  this machine's Segoe UI Emoji. CI (windows-latest) has never run these tests (no remote yet); if
  its emoji font differs, compare emoji regions with a tolerance or bundle an emoji font (PLAN
  section 9, open decision 2).

## From Step 4b

- **Startup error screen (review 4b m5):** an unusable data folder (unsupported
  `schema_version`, I/O error at open) now makes reads throw, but the UI has no dedicated
  message or retry. Step 6.
- **Watcher thread panic (n6):** a panic ends change reporting silently; shutdown also waits for
  a slow OneDrive read in progress. Catch, log and restart the thread.
- **`save_photo` / `write_text_file` accept any data path (n8):** restrict to `fotos/` and
  opdracht `.typ` files (ADR-0002 section 7 hardening, Step 6), so they cannot overwrite JSON
  without CAS.
- **Lock folder errors carry an absolute local path (n4, remaining part):** `CommitLock` errors
  name the lock folder under `%LOCALAPPDATA%` (with the Windows user name) in `details.path`.
- **Overflow of `ReadDirectoryChangesW` (review 4b M1 note):** `notify` drops it silently; the
  periodic re-start of OS notifications plus the poll limit the damage. Revisit if colleagues
  report missed changes in non-active years.
- **`set_scope_year` not wired (n3):** C7, Step 6a.

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
- **Step 6 CSP checklist (review 3a m8):** add the PDF output scheme of ADR-0002 section 9 to
  `connect-src` in `ui/vite/csp.ts`; pass `isEvalSupported: false` to pdf.js `getDocument`; run
  `ui/e2e/csp.spec.ts` on a real compiled rapport (the mock PDF uses only Helvetica).
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
- **m7 (Step 6):** record `assignment:progress` events in the batch goldens.

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
