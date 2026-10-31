# Review Step 7a: data format v2 and migration

Reviewer: fresh-context subagent, 2026-10-30. Scope: `git diff step-06..HEAD` on `step/07-data-v2`
(the 7a commits `f4c6d4f..bf6a49e`), against PLAN.md "Step 7" (7a), ADR-0003 (C1-C19, "Decisions
on the shape of C9 and C10") and `docs/reference/data-files-v2.md`.

## Summary

The step is in good shape. The migration is well built: it plans first, reads only, blocks on
unmigrated legacy data and corrupt files before it writes anything (no backup either), zips and
verifies the whole folder outside the data and shared folder, writes `config.json` last, and is
idempotent and resumable (tested at several interruption points). The Store codec keeps the
in-memory shapes, so grades, rapport content and B10 do not change. The Typst sandbox for the new
per-opdracht folder is sound.

I found no blockers. Three majors: the Store's students decoder turns an unexpected file shape
into an empty list, so the next write erases every student of that year (M1); the C19 stamp is
computed on the value before JS number formatting, so "Accepteren" (and the migration) produce a
stamp that is wrong as soon as the file is read again when it holds numbers like `2.0` or `1e2`
(M2, reproduced); and the production Typst path for v2 opdracht folders has no Rust tests, all
opdracht goldens still go through the v1 virtual project (M3).

### Verified and found fine

- **Tests:** `cargo test --workspace` all pass (161 core unit tests and the integration suites);
  `npm test` (vitest 273/273 and node 122/122), `npm run typecheck`, `npm run lint` all pass.
  Playwright e2e was not run.
- **CLI on a synthetic folder:** `node tools/fixtures/generate.mjs tiny <tmp>/shared/data`, then
  `maatwerk-cli migrate --dry-run` (57 written, 3 moved, 16 deleted, nothing changed), then
  `--apply --backup-dir <tmp>/backups`. Validation reported 0 errors and 1 warning (a fixture
  coupling to a non-existent opdracht, a known fixture property). A second `--apply` printed
  "al versie 2; niets te doen". `maatwerk-cli typst compile` of a migrated
  `opdrachten/opdracht_1756713600200/main.typ` (PNG, JPG and SVG figures under `images/`)
  compiles.
- **Migration order and safety** (`migrate/plan.rs`): blocked reasons are collected before any op.
  `config()` is planned after the block check, as the last op. Each step's writes come before its
  delete (gebruikers, templates, opdrachten). The legacy deletes that come first only remove
  leftovers the reference had already copied (checked against `_reference/renderer/store.js:828-1000`:
  phase 1 writes `*.bak` and nulls `students.json`; root `groups.json`/`exams.json`/`scores/` are
  left behind by the reference itself). A move is copy then delete, so a crash leaves two copies,
  never none. Tests cover dry run, second run, interrupted run (1/7/20/40 ops), backup content and
  location, legacy blocking, corrupt file and newer version.
- **Backup** (`migrate/backup.rs`): written to `.zip.partial`, read back (entry count, CRC, size),
  then renamed. The location check refuses the data folder, its parent and the OneDrive env
  folders, compared canonically, and nothing is created before the check.
- **C9 / B10:** `decode` maps `"N"` to `null` for every score read through the Store (`load`,
  `update`, `applyExternalChange`). No score file is read around the codec: the only raw
  `readJson` outside the Store is the rapport service's template read (`services/rapport.ts:38`);
  score records come from `Store.getStudentScores` (`:57`). So `hasEntry` in
  `domain/rapport.ts:344` still sees `null` and B10 stays as it was. The reference already treated
  a `"N"` string as N (`_reference/renderer/store.js:680`), so no v1 file changes meaning.
- **Golden adaptations** (`ui/tests/golden.ts` `v2File`, `store-session.ts`, csv, opdrachten,
  score-writes, rapport tests): only id type (`String(id)`), `"N"`, the students wrapper and the
  file path change. Expected values, lists of students and grades are untouched.
- **C10:** `makeExamId`/`makeGroupId` are opaque; existing ids are not rewritten; the CSV group
  import keeps a group's id by (trimmed, case-insensitive) name.
- **C16:** `upsertUser` and `updateSchool` use `saveEntity`-style rev checks; school conflicts
  name the colleague and reload.
- **C17:** the editor writes with the loaded hash; a conflict stops autosave, keeps the text, and
  offers both buttons; a close while in conflict asks before discarding (`closeAfterSave`).
- **C18:** printed copies go to `<parent of data>/rapporten/<jaar>/`; `openable_path` only opens
  existing PDFs there (test includes the old `data/rapporten` location being refused).
- **Typst sandbox:** `TypstProject::opdracht` checks the id (`^[A-Za-z0-9_-]+$`) and mounts only
  `opdrachten/<id>/`. `load_mounted` (`typst_svc/world.rs:184-200`) canonicalises every file and
  requires it to stay under the mount root, so links out of the folder are refused.
- **Paths from the UI:** `write_text_file` is limited to `opdrachten/<id>/<name>.typ`
  (`check_opdracht_typ_path`); `accept_stamp` requires `.json` and goes through `rel()`
  (no `..`, absolute paths or escapes); opdracht folder commands check the id; the migration
  backup dir is not UI input (the app uses `%LOCALAPPDATA%\…\backups`).
- **New screens:** `gegevens.ts` and `migration.ts` build the DOM with `textContent` only; no
  `innerHTML` with file names or messages.
- **Architecture:** `maatwerk-core` has no `tauri` dependency; the new command handlers in
  `src-tauri/src/data.rs` only parse, call core and map results. `migrate_data_folder` and
  `validate_data_folder` run in `spawn_blocking` (`blocking`).
- **Watcher:** own writes from `write_json` and `write_text` are reported to the observer under the
  commit lock (`storage/mod.rs:403-441`), so a stamped write is not echoed back.

## Findings

### Blockers

None.

### Majors

#### M1. An unexpected students file shape decodes to `[]`; the next write erases the year's students

- **Where:** `ui/src/domain/v2.ts:47-49`, used by `Store.update` (`ui/src/store.js:95-97`) and
  `updateStudents` (`store.js:400-406`).
- **Evidence:** `decode` returns
  `isObj(data) && Array.isArray(data.students) ? data.students : []`. A `students-<year>.json`
  that is a bare array (the v1 shape: a file restored from OneDrive version history or from the
  v1 backup zip, written by an old exe someone forgot to move away, or hand-edited), or an object
  without a `students` array, decodes to an empty list. The first `upsertStudent`,
  `upsertStudents` or `deleteStudent` then runs the mutator on `[]`, and `encode` writes
  `{ "students": [<one student>] }` with a valid CAS hash. The whole year's student list is
  overwritten without a warning. Before 7a, `update` passed the array through.
  `ui/tests/domain/v2.test.ts` has no case for these shapes.
- **Fix:** accept a bare array as the list (it is the v1 shape and harmless to read). For any
  other non-null value without a `students` array, throw (as `update` already does for an
  unreadable file: "Bestand … is onleesbaar"), so nothing gets written. Add tests for both cases
  in `v2.test.ts` and a Store test showing that a write keeps the existing students.

#### M2. The C19 stamp does not survive a write/read round trip for numbers like `2.0` or `1e2`; "Accepteren" cannot clear them

- **Where:** `crates/maatwerk-core/src/integrity.rs:57` (canonical numbers via `serde_json`
  `to_string`), `storage/mod.rs:374-382` (`write_json` stamps the value, then writes
  `to_js_json`), `storage/mod.rs:226-234` (`accept_stamp`), `migrate/plan.rs:165-170`.
- **Evidence:** the hash is computed on the value as given. `to_js_json` then prints numbers the JS
  way (`2.0` becomes `2`, `1e2` becomes `100`). On the next read `2` parses as an integer, and the
  canonical form changes from `2.0` to `2`. Reproduced with a scratch binary against
  `maatwerk-core`: write `school.json` as `{"naam":"x","n":2.0,"m":1e2}`, `read_json` gives
  `Missing`, `accept_stamp` succeeds, and the next `read_json` gives
  `[("school.json", Mismatch)]`. The file on disk then has `"n": 2, "m": 100` with a stamp that
  does not match. JS never sends `2.0`, so normal app writes are fine. But this hits exactly the
  files C19 is about: hand-edited files (including hand-edited v1 files the migration stamps), and
  "Accepteren", the admin's only remedy, never makes the warning go away. The existing test
  `floats_survive_the_write_read_round_trip` uses no integral floats or exponent forms.
- **Fix:** compute the stamp on the canonical form of what is actually written. Either make
  `canonical_json` print numbers with `jsonfmt::js_number`, so it is independent of how a number
  was parsed (this changes the spec text in `data-files-v2.md` "numbers as `serde_json` prints
  the parsed value", and the golden v2 fixture hashes need regenerating), or in `stamp()` hash
  `serde_json::from_str(&to_js_json(value))`. Add `2.0`, `1e2`, `-0.0` and `1.5e300` to the
  round-trip test, and a test that `accept_stamp` followed by `read_json` leaves no stamp issue.

#### M3. The production Typst path for v2 opdracht folders is untested in Rust; all opdracht goldens still use the v1 project

- **Where:** `crates/maatwerk-core/src/typst_svc/project.rs:105-116` (`TypstProject::opdracht`,
  used by `src-tauri/src/render.rs:113-119`); `crates/maatwerk-core/tests/typst_opdracht.rs`
  (every test, including the goldens and
  `the_opdracht_world_sees_its_own_images_and_nothing_else`, calls `opdracht_v1`).
- **Evidence:** `grep -rn "TypstProject::opdracht(" crates src-tauri` finds only `render.rs`. The
  PDF goldens, error positions (`svg_preview_error_names_the_opdracht_file_with_line_and_column`)
  and the "own images only" sandbox test cover the v1 virtual project with bundled
  `main.typ`/`lib.typ` and `images/<id>/` paths. They do not cover what the app now compiles: a
  real folder with its own `main.typ`/`lib.typ` copies and `images/` paths rewritten by the
  migration. I checked by hand that one migrated folder compiles with `maatwerk-cli typst
compile`, but nothing checks that its PDF equals the v1 golden, or that a v2 project cannot
  read a sibling opdracht or `../../2025-2026/...`.
- **Fix:** run the opdracht goldens through a v2 folder: migrate the fixture opdrachten (or build
  the folder as `create_opdracht_folder` plus the fixture text with `images/<id>/` rewritten) and
  compile with `TypstProject::opdracht`; expect byte-equal PDFs (or the same comparison the
  goldens use). Port the sandbox test to `opdracht()` (sibling folder, data files, `..`). After
  that, decide whether `opdracht_v1` and `v1_opdracht_id` stay public (see n1).

### Minors

#### m1. C17: a missing `opdracht.typ` makes the editor write blind

- **Where:** `ui/src/editor-init.js:831` and `:721` (`baseHash = read?.hash ?? null`),
  `ui/src/bridge/tauri-api.ts:184-185` (`expectedHash ?? null`), `src-tauri/src/commands.rs`
  `write_text_file` (`None` becomes `Expect::Any`).
- **Evidence:** when the file is missing at open time (opdracht.json has synced but the `.typ`
  has not yet, or a colleague deleted it), or when "Hun versie laden" finds it gone, `baseHash`
  is `null` and every following autosave is a blind write. A version that arrives through OneDrive
  in between is overwritten without a conflict.
- **Fix:** let the bridge distinguish "no CAS" from "must not exist": pass a CAS mode
  (e.g. `expectedHash: null` maps to `Expect::Missing`, and keep a separate blind path only for
  the copy flow in `modals/editor.js`). Test: open an editor on a missing file, create the file
  behind it, type: expect the conflict bar.

#### m2. `stamp_issues` (the per-read C19 registry) is never shown

- **Where:** `src-tauri/src/data.rs:153-168`, `ui/src/bridge/tauri-api.ts:295`; no caller in
  `ui/src` outside the bridge (grep `stampIssues`).
- **Evidence:** PLAN 7a says a mismatch is "checked on every read … logged and the admin sees
  'Buiten Maatwerk gewijzigd'". The admin only sees what `validate-data` finds at admin login and
  on the Gegevenscontrole tab. The per-read registry only reaches the log. The result is the same
  for files that exist at login, but the command, the bridge method and the parity row are unused
  surface.
- **Fix:** either merge `stampIssues()` into the Gegevenscontrole screen and the login banner
  (cheap, no walk), or drop the command and say in the docs that the per-read check only logs.

#### m3. `print_copy` is no longer atomic

- **Where:** `crates/maatwerk-core/src/outputs.rs:274-287`.
- **Evidence:** before 7a the copy went through `write_bytes(..., Expect::Missing)` (temp file plus
  rename). Now `create_new` plus `write_all` writes the PDF in place. A failure or crash halfway
  (full disk, OneDrive lock) leaves a truncated PDF under the final, descriptive name, and the
  error path does not remove it. That folder is synced, so colleagues get a broken report.
- **Fix:** write to a temp file in the same folder, then `fs::hard_link` (fails if the target
  exists, so the exclusive check stays) or a rename after `create_new` has claimed the name;
  remove the partial file on error.

#### m4. `setActiveYear` can write a `config.json` without `schema_version`

- **Where:** `ui/src/store.js:380-385` (fallback `() => ({})`).
- **Evidence:** if `config.json` is missing when the year is switched (deleted, or not yet synced
  on that PC), the Store writes `{ activeYear }`. On the next start every PC sees a folder without
  `schema_version` and shows the migration screen (`check_schema`: `None` means v1). The
  migration is harmless on v2 data, but it is a confusing failure mode on a shared folder. The
  same holds for any other JSON writer of `config.json` that starts from `{}`.
- **Fix:** have the fallback include `schema_version: 2`, or have the core `write_json` for
  `config.json` keep or insert `schema_version`.

#### m5. Migration screen and backup check edge cases

- **Where:** `ui/src/screens/migration.ts:99`, `src-tauri/src/data.rs:106`,
  `crates/maatwerk-core/src/migrate/backup.rs:27-37`.
- **Evidence:**
  1. The catch comment and message suggest nothing changed, but an IO error during apply (locked
     file) leaves a half-migrated folder. That is safe, since re-running continues, but the text
     should say "probeer opnieuw" rather than imply a refusal.
  2. `migrate_data_folder` runs whenever the storage failed to open, for any reason, not only
     `needs_migration`. The UI only offers it for that code, but the command does not enforce it:
     with an unreachable network folder it would "migrate" a non-existent folder and create
     `config.json`.
  3. With the data folder directly in a drive root (`C:\data`) the parent check forbids the whole
     drive, so the in-app migration always refuses `%LOCALAPPDATA%`.
  4. SharePoint libraries synced by OneDrive live under `%USERPROFILE%\<organisation>\`, which no
     `OneDrive*` env var covers. A CLI `--backup-dir` there passes the check and syncs.
- **Fix:** (1) adjust the text; (2) check `matches!(err, Error::NeedsMigration { .. })`;
  (3) skip the parent rule when the parent is a drive or share root, or document it;
  (4) also refuse folders that contain a `desktop.ini` or attribute marking a cloud-sync root, or
  mention it in the runbook.

#### m6. No check that `tools/fixtures/to-v2.mjs` and the Rust migration agree

- **Where:** `tools/fixtures/to-v2.mjs`, `ui/tests/golden.ts`, `ui/tests/store-session.ts`.
- **Evidence:** every Store golden runs on folders converted by the JS converter, not by
  `maatwerk-core::migrate`. They already differ: a missing `.typ` becomes `''` in JS but the base
  template in Rust; JS does not merge duplicate students, add `_meta` (rev 1) or stamp. So the
  goldens prove "the Store on a JS-converted folder behaves like the reference", not "the Store
  on a migrated folder does". The `_meta` the migration adds to exams, groups and observaties
  without one (rev 1) is never run through the Store tests.
- **Fix:** add one test that runs both converters on the generated `tiny` fixture and compares
  the results with `_meta` removed, or have the golden harness seed from the Rust migration
  output (via the CLI in a setup step).

#### m7. Group CSV import matches names more strictly than the v1 slug did

- **Where:** `ui/src/domain/groups.ts:74-97`.
- **Evidence:** v1 matched through the id `slug(name)-year`, so `3A nat`, `3a-nat` and
  `3a  nat` (two spaces) were the same group. `nameKey` only trims and lower-cases, so a
  re-import whose spacing or punctuation differs now creates a second group with the same
  students instead of replacing (D34). Not recorded in `quirks.md` (the C10 entry only says
  "matches existing groups by name").
- **Fix:** normalise like the old slug (collapse runs of non-alphanumerics), or record the
  difference in `quirks.md`.

### Nits

- **n1.** `TypstProject::opdracht_v1` and `v1_opdracht_id`
  (`typst_svc/project.rs:41-72`, `:138-154`, re-exported in `typst_svc/mod.rs:29`) are now only
  used by tests and `examples/batch_memory.rs`. Make them `#[cfg(test)]`/`pub(crate)` or remove
  them once M3 moves the tests.
- **n2.** Stale comment `ui/src/editor-init.js:1317`: "Images live in
  data/opdrachten/images/<opdracht id>/ (see main.js)". The next line says the opposite.
- **n3.** `data-files-v2.md` and `plan.rs:561-562` say duplicate students merge "as
  `mergeStudent`". `mergeStudent` overwrites with normalised fields (missing becomes `''`), while
  `first.extend(s)` (`plan.rs:600`) keeps the earlier value for fields the later entry lacks. The
  Rust behaviour is better; fix the wording.
- **n4.** `validate.rs` `conflict_copy_of` strips at every `-`: a genuinely misplaced
  `groups/3a-nat-2025-2026.json` is reported as a "conflict copy" of `groups/3a-nat-2025.json` or
  `groups/3a.json` if either exists, instead of as a placement error. Limit the `-PCNAAM` rule to
  one trailing segment without digits-only content, or check the content id first.
- **n5.** The validation at admin login reads and hashes every JSON file of every year. On a
  OneDrive folder with Files-On-Demand, that downloads all old years on every admin login, and it
  competes with the first screen's reads. Consider limiting the login check to the active year
  plus top-level files, and leaving the full walk to the Gegevenscontrole tab.
  `content_hash` also clones the whole value on every read when a hash is present
  (`integrity.rs:64-69`); hashing with the `hash` key skipped while writing would avoid the clone.
- **n6.** `ui/src/screens/gebruikers.js:103` toggles `actief` on the cached user before saving. On
  a conflict the cache shows the toggled state that was not saved.
- **n7.** Runbook 3.3 says "start `maatwerk.exe` from the shared folder", while step 4.1 puts the
  new exe there only afterwards. Say "start the new `maatwerk.exe` from a local folder with the
  shared `data\` folder selected", or reorder.
- **n8.** `encode` of the students file rebuilds `{ students }` and drops any other top-level key a
  future version or the migration adds (only `_meta`, re-stamped, today). Spread the on-disk
  object when it is available.

## Not checked

- Playwright e2e (`ui/e2e/*`), `cargo deny`, `npm run licenses`, `bash tools/check-spdx.sh`.
- Behaviour on a real OneDrive folder (sync timing, placeholders) and Windows file locks during
  the migration. These are covered by the runbook and manual tests only.

## Triage (implementer, 2026-10-30)

| Id                     | Decision                                                                                                                                                                                                                                                                                                              | Where                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| M1                     | Fixed: a bare v1 array is read as the list; any other shape throws, so no save can replace the year with one student. Test in `ui/tests/domain/v2.test.ts`.                                                                                                                                                           | `ui/src/domain/v2.ts`                           |
| M2                     | Fixed: `integrity::stamped_text` stamps the value as written (re-stamps after the JS number format normalised it); used by `storage::write_json` and the migration. Test `m2_the_stamp_describes_numbers_as_written`.                                                                                                 | `crates/maatwerk-core/src/integrity.rs`         |
| M3                     | Fixed: every opdracht PDF/SVG golden also compiles through `TypstProject::opdracht` on a folder laid out as the migration does, and must match; new sandbox test for the v2 folder.                                                                                                                                   | `crates/maatwerk-core/tests/typst_opdracht.rs`  |
| m1                     | Fixed: the editor sends `expectedHash: ""` when no file was loaded; Rust maps it to `Expect::Missing`.                                                                                                                                                                                                                | `editor-init.js`, `commands.rs`, mock           |
| m2                     | Kept: `stamp_issues` stays for 7b ("Herstellen uit snapshot" works on what was read); backlog.                                                                                                                                                                                                                        | backlog                                         |
| m3                     | Fixed: a failed write removes the partial PDF.                                                                                                                                                                                                                                                                        | `outputs.rs`                                    |
| m4                     | Fixed: `setActiveYear` keeps or sets `schema_version: 2`.                                                                                                                                                                                                                                                             | `store.js`                                      |
| m5                     | Fixed: the migrate command requires `needs_migration`; the screen tells a refusal ("er is niets veranderd") from a later failure ("gaat verder waar het stopte"); a data folder in a drive root no longer forbids the whole drive for the backup. SharePoint libraries cannot be detected: documented in the runbook. | `data.rs`, `migration.ts`, `backup.rs`, runbook |
| m6                     | Backlog: a CI check that `to-v2.mjs` and the Rust migration agree on the tiny fixture (modulo stamps).                                                                                                                                                                                                                | backlog                                         |
| m7                     | Fixed: imported group names compare like the v1 slug id (case, spaces, punctuation ignored).                                                                                                                                                                                                                          | `ui/src/domain/groups.ts`                       |
| n2, n7                 | Fixed (comment; runbook order).                                                                                                                                                                                                                                                                                       |                                                 |
| n1, n3, n4, n5, n6, n8 | Backlog.                                                                                                                                                                                                                                                                                                              | backlog                                         |
