# Review: step 18 (Data format v3)

Scope: `e84579a..HEAD` (branch `step/18-data-v3`, on top of the unmerged step 17), 2 commits,
97 files (+2950/-217; most of them are the new `tests/fixtures/migrate/v3` golden tree).
Reviewer: fresh-context subagent, checklist PLAN.md Appendix C. I read the diff and the code, not
the commit messages or STATE as evidence. I ran `cargo test -p maatwerk-core` and
`-p maatwerk-cli` (green), `cargo fmt --all --check` (clean) and `npm test` (vitest green; the
node suite is red for the step-17 reason, see review step-17 M1). A separate security review
covers section 4.

**STOP gates still open (PLAN-2 step 18):** the "before the step" `validate-data` list from a copy
of the real data, running the migration on that copy, and deleting leftovers. None of these is
done, and STATE says so. They are not findings, but step 18 cannot be released until they are.

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 1     |
| Minor    | 8     |
| Nit      | 6     |

Checked and found correct:

- **Ordering (decision 5, runbook 8):** `v3::build` plans `school_v3` first, then moves,
  deletes, gebruikers, exams, and `config.json` last (`Planner::finish`). The dry-run test pins
  `changes[0] == "school.json"` and `last == "config.json"`. An open 0.6-0.8 app turns read-only
  from the first write on. `schema_version: 3` makes it stop at its next start.
- **Idempotency / crash half-way:** every v3 step reads the current disk state.
  `update_entity` writes nothing when the body is unchanged, so `rev` does not climb on a second
  run. A Move is copy, then delete, so a crash leaves both copies, and the next run sees
  identical bytes and only deletes the source. `an_interrupted_v3_run_continues_to_the_same_result`
  stops after 1/3/5/8 ops and compares the result with the golden. On a v3 folder, `migrate` is a
  no-op (`from_version >= target`).
- **v1 -> v3 chain:** one backup, the v1 plan, `remove_empty_dirs`, then a fresh `v3::build` on
  the result. A crash between the two halves leaves a valid v2 folder (its `config.json` was
  written last), which the next run takes as v2. The v1 fixture through v3 and the v2 fixture to
  v3 give the same golden tree.
- **Resits (decision 13):** `obs_ids` = the original's, then the resit's own (kept, with a
  warning), plus `obs_from_parent: true`. Notes are emitted only when something changes, so a
  second run is silent. `openResitModal` always uses the original's id and year, so a parent in
  another year cannot occur through the app. The migration warns if it occurs anyway.
- **Presence (D20):** `prune_stale` skips read-only folders and keeps unreadable (half-synced)
  files. The timestamps compare as strings, and this is safe: `heartbeatAt` comes from
  `toISOString()` in `presence.js:50` and `iso_utc` in core, the same 24-character shape. A live
  colleague's file is never older than 30 days, and if a skewed clock removes one, it is rewritten
  within 15 s. The test uses a fixed `now`, not wall time.
- **Mixed case:** `Fotos/` and `Users/` from a Windows-made folder migrate (test). The rapport
  mount `/data/afbeeldingen` is looked up ignoring case.
- **Layering:** `migrate_data_folder(dry_run)` only routes the call. The backup folder is
  resolved only for a real run. The work runs in `blocking`. No `tauri` in core.
- **Other places that refer to `fotos/`:** `school.json` `logo`/`watermerk`, `gebruikers` `foto`,
  the rapport template, `app.js` watermark, `school.js`, `gebruikers.js`, `check_photo_path`,
  seed, watcher `IGNORED_DIRS`, snapshot `SKIPPED_DIRS`, and `problems.ts` redaction are all
  moved or extended. I found no other data field that refers to `fotos/` (the v1 spec has only
  these three).

## Major

### M1. A v2 folder whose `config.json` has not synced yet opens as v3, and the app stamps it `schema_version: 3` without migrating

- `storage/mod.rs:223-232` (`check_schema`): when `config.json` is missing, the folder counts as
  current whenever `gebruikers/` exists ("`gebruikers/` is v2: its `config.json` has not synced
  yet"). That rule was right while the current format was v2. Since step 18, `gebruikers/` exists
  in v2 **and** v3, so a v2 folder without `config.json` passes as current. `Core::open`
  (`src-tauri/src/state.rs:150-171`) then runs `seed_initial_data`, and that writes
  `{"schema_version": 3}` with `Expect::Missing` (`storage/mod.rs:568-574`). It also creates
  `afbeeldingen/`, and `prune_stale` runs.
- Scenario: a colleague on a PC where OneDrive is still downloading the folder starts 0.9 before
  the admin has migrated (the runbook places the 0.9 exe in the shared folder first). That PC
  uploads a v3 `config.json` into a v2 folder. Every other 0.9 app, including the admin's, now
  opens the folder without offering the migration. Photos, logo and watermark seem gone (they are
  in `fotos/`), the resits never get their observaties (decision 13), `minAppVersion` is never
  set, and the real `config.json` (schema 2) comes back as an OneDrive conflict copy. Undoing
  this means a manual migration on a live folder.
- Fix: when `config.json` is missing, look for v2 markers. A top-level `fotos/` or `users/`
  folder in any case, or an exam without `kind`, should give `NeedsMigration { found: 2 }`. More
  generally, a folder that holds data but no `config.json` should never get a seeded
  `config.json`: seed it only into a truly empty folder, and otherwise open read-only with "nog
  niet gesynchroniseerd". Add a storage test: a v2 fixture minus `config.json` must not open as
  current and must not gain a `config.json`.

## Minor

### m1. The before/after list (decision 13) is not guaranteed to come before the confirm, and it leaves out the warnings

- `ui/src/screens/migration.ts:113-125`: the dry run is fire-and-forget. "Omzetten" becomes
  available as soon as the box is ticked (`:141`), even when the preview has not arrived (a large
  folder on OneDrive) or has failed (the error is swallowed, `() => {}`). The preview shows only
  `notes`, not `warnings`, so these two cases appear only in the report afterwards: "had eigen
  observaties … die blijven erbij" and "de oorspronkelijke toets … bestaat niet; observaties niet
  overgenomen". For a v1 folder the notes are empty, and the v3 step is announced only in a
  warning, which the preview does not show either. The real run can also start while the dry run
  is still reading the folder (harmless reads, but the timing becomes confusing).
- Fix: disable the box until the dry run has answered, show a "Lijst laden…" state and a
  visible error on failure, and render the resit-related warnings in the preview. For a v1
  folder, say that the list follows after the first step.

### m2. A non-version or padded `minAppVersion` is lowered to 0.9.0

- `migrate/v3.rs:99-106`: `current` is taken with `as_str` and compared untrimmed.
  `app_version::required_version` trims the value and treats a non-version value as "newer"
  (refuse to write; runbook 8 says `"next"` or a number makes the app read-only). The migration
  treats every one of these as "lower" and overwrites it: a number (`as_str` is `None`),
  `"next"`, or `" 1.0.0 "` (the compare fails because of the spaces). So a guard that an admin
  set on purpose gets weakened. Fix: trim; overwrite only when the field is absent, empty, or a
  version that parses and is lower; keep anything else and add a warning.

### m3. A missing `school.json` is skipped without a word

- `migrate/v3.rs:92-94`: if `school.json` is absent (still syncing, which runbook 8 names as a
  case), the migration sets no `minAppVersion` and does not rewrite `logo`/`watermerk`. The
  `school.json` that syncs in later keeps `fotos/…` paths and no guard. Fix: add a warning, or
  block when other v2 data is present but `school.json` is not.

### m4. Paths are rewritten to `afbeeldingen/` even when the file was not moved

- `rename_image_ref` (`v3.rs:212-224`) rewrites `school.json`/`gebruikers` paths without
  checking. `move_file` (`plan.rs:206-215`) skips a source whose target already exists with
  different bytes and only warns. Result: `logo: "afbeeldingen/school-logo.png"` points to the
  _other_ file, and the real logo stays in the leftover `fotos/`, which validate-data then calls
  "mag weg na controle". Fix: rewrite a reference only when its file was moved, or when the
  target is identical. Otherwise keep the old path and name the field in the warning.

### m5. On a case-sensitive file system, `Fotos/x` and `fotos/x` overwrite each other

- `images_v3` (`v3.rs:44-52`) plans one Move per source. `move_file` checks `to.exists()` at plan
  time (`plan.rs:206`), which cannot see a target planned earlier in the same run. `Op::apply`
  then calls `write_atomic(to, …)` (`mod.rs:220`), which replaces the first file with the
  second. One photo is lost (the backup still has it). This can happen only on Linux or macOS
  with a case-sensitive volume, which step 16 supports. Fix: record planned Move targets in
  `planned` and treat a second Move to the same target as a conflict (warning, leave the source).

### m6. validate-data calls a Windows-made `Afbeeldingen/` "Bestand dat Maatwerk niet gebruikt"

- `validate.rs:116` matches `["afbeeldingen", ..]` exactly. Under `Afbeeldingen/`, every file
  falls through to Stray with the generic message. The rapport World _does_ use that folder
  (case-insensitive lookup, and the test `t4_the_watermark_is_found_in_other_case` relies on
  it). An admin who follows the leftover list could delete the school's photos and watermark.
  `fotos/` had the same exact match before this step, but the leftover list now invites
  deletion. Fix: match the top-level folder ignoring ASCII case (as `v2_leftover` already does),
  or report a case mismatch as its own warning.

### m7. Missing tests for the paths above

- These cases have no test: a resit whose parent is missing (warning, `obs_from_parent` not
  set); a conflicting file already in `afbeeldingen/`; `school.json` absent; a higher
  `minAppVersion` (`"1.0.0"`) that must be kept; `check_schema` on a v2 folder without
  `config.json` (M1); an interruption just before the `config.json` op (the loop stops at 1/3/5/8,
  not at `ops.len() - 1`). The UI has no unit test for the preview failing or arriving late.

### m8. `opdrachtenVraag` lives on the exam, but ROADMAP F-14 says "New link type in `opdracht.json`"

- `data-files-v3.md` (Exams table) and `validate.rs` `check_exam_v3` put the F-14 link on the
  exam, next to the existing `opdrachtenCijfer`. That is consistent and probably the better
  choice, but it departs from the roadmap text and is a data-format decision (CLAUDE.md: stop and
  ask on data-format changes). Fix: confirm with the user and record it in ADR-0010 item 7 or in
  the spec.

## Nits

- n1. Stale docs after the rename: `src-tauri/src/commands.rs:303` and `ui/src/bridge/bindings.ts:71`
  ("Only `fotos/<name>`"), `bindings.ts:64` ("Writes `users/<userId>.json`", from the Rust doc
  comment). Also `quirks.md` T4's "Fixed" note still says `fotos/school-watermerk.svg`.
- n2. Doc comments over 100 characters: `storage/mod.rs:216-218`, `migrate/v3.rs` `update_entity`
  doc, `typst_svc/rapport.rs:6`.
- n3. An exam with `kind: null` keeps the null (`contains_key`), and validate then reports
  `Soort toets null`. Treat null as absent in the migration.
- n4. `prune_stale` deletes a file that has no `heartbeatAt` at all. That is right for the
  reference's files, but a future presence format without that field would be wiped at every
  start. Consider `online == false` plus file mtime as a second signal.
- n5. `tools/fixtures/to-current.mjs` duplicates the v3 rules in JS (mock only). The test
  `to-current.test.mjs` checks it against expectations, not against the Rust golden tree. A
  cross-check like `export-opdrachten.mjs` would catch drift.
- n6. `MigrationReport.to_version = target.max(from_version)` reports 3 for a dry run of a v1
  folder that only lists the v2 half. The summary line "omgezet van versie 1 naar 3" is fine
  after applying, but for the preview it overstates what the list contains.

## Triage (implementer, 2026-11-07)

- **M1 fixed:** `check_schema` sees `fotos/` or `users/` next to `gebruikers/` (no `config.json`)
  as v2 (`needs_migration`, found 2); `seed_initial_data` writes `config.json` only into a folder
  without users or years; `folder_version` without `config.json` but with `gebruikers/` is 2,
  so the migration runs the v3 step and writes the version. Tests in storage and migrate.
- **m1 fixed:** "Omzetten" waits for the dry run, which now shows the counts (bijwerken,
  verplaatsen, verwijderen), the warnings and the resit list.
- **m2 fixed:** a `minAppVersion` this app does not satisfy (newer or not a version) refuses the
  migration (`migration_blocked`); only an absent, empty or older one is raised to 0.9.0.
- **m3 fixed:** a missing `school.json` is a migration warning.
- **m4, m5 fixed:** files that stay in `fotos/` (different file at the new place, or a second
  case variant on Linux) keep their path in the data, with a warning; planned targets are
  tracked.
- **m6 fixed:** `afbeeldingen/` in any case is in use for `validate-data`.
- **m7:** tests added for the above (the case-variant test runs on Linux only).
- **m8 resolved (user 2026-11-07):** `opdrachtenVraag` stays on the exam (the link names a
  question of that exam, like `opdrachten` and `opdrachtenCijfer`); recorded in ADR-0010 item 7,
  ROADMAP F-14 and data-files-v3. The user also set the matching: `N` matches, empty does not.
- **n1, n2, n3 fixed.** n4 kept (a file without `heartbeatAt` is not a presence file Maatwerk
  writes). n5 kept (mock only, tested). n6 kept: a v1 dry run says 1 -> 3 and adds the warning
  that the v3 step is not listed yet.
