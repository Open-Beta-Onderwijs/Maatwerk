# State

Last updated: 2026-10-27 (Step 4b in progress) Branch: `step/04-core-storage` Last tag: `step-04a`

## Current step

Step 4b in progress on `step/04-core-storage` (4a tagged `step-04a`; `main` is merged after 4b).

User decisions (2026-10-27), recorded in `docs/specs/storage-spec.md`:

- S37: commit lock = process-wide mutex per data folder + OS file lock (`std::fs::File::lock`) on
  a file in `%LOCALAPPDATA%\maatwerk\locks`, held only for check + rename.
- S38: every JSON write uses CAS; school/config via `update()` (C6); RTTI templates hash-CAS;
  unused `saveStudents`/`saveStudentScores` removed.

## Step 4a summary

- `maatwerk-core`: `error` (typed `Error`, stable `code()`), `paths` (`RelPath`, `DataDir`,
  junction/symlink escape check, proptest), `jsonfmt` (`JSON.stringify(x, null, 2)` incl. JS
  number formatting; `serde_json` with `preserve_order` + `float_roundtrip`), `storage` (atomic
  write, CAS under the commit lock, `update`, `save_entity`, `_meta` stamping, years, read-all,
  text, photos, seed, `schema_version` check C1, `LocalSession`). Spec rows S01-S27, S37, S38 as
  Rust tests; cross-process test (`crates/maatwerk-core/tests/cross_process.rs`).
- Bug found by the cross-process test, fixed test first: `resolve` canonicalised the file itself;
  a file being replaced resolves under `\$Extend\$Deleted` on NTFS -> spurious `invalid_path`.
- UI: `Store.updateSchool(patch | fn)`, `setActiveYear` via `update()`, RTTI modal saves changed
  tabs over the loaded version (`Store.loadVersioned/saveVersioned`).
- Review `docs/reviews/step-04a.md`: M1 (float round trip) fixed test first; m1-m5 fixed; m6 and
  most nits in `docs/backlog.md` (triage table in the review).
- Deferred on purpose: C7 (per-teacher active year) to 6a; `lib.typ` seeding to Step 5;
  `removeEmptyImageDirs` to Step 6; watcher, presence and Tauri commands to 4b.

## In progress

- 4b implemented: core `watcher` (S28-S40) + `presence`; Tauri commands for storage, presence
  and session with `CommandError`; `tauri-specta` bindings (ADR-0005, stale check in
  `cargo test`); `TauriApi` compat layer + contract tests; `npm run data:dev`. Smoke run: the
  real app starts on synthetic data and shows the subject picker.
- Now: end-of-step review (`docs/reviews/step-04b.md`), `/security-review`, then merge + tag.

## Next action (concrete, resumable)

1. If the review is not written yet: spawn the reviewer subagent (diff `step-04a..HEAD`,
   Appendix C), triage, fix blockers/majors, gate, merge `step/04-core-storage` into `main`
   with a merge commit, tag `step-04b` and `step-04`, update PLAN section 3. Then stop and report.

## Open questions for the user

- Remote repo still to create (`gh` not installed), so CI has not run on 3b/4a; PLAN section 9
  items (emoji font Step 5, domain logic location Step 10, versioning, macOS).

## How to resume

PowerShell for npm/cargo (Git Bash's `link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). `npm ci; npm run build:ui`, then
the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright install chromium`
in `ui/`). `npm run test:visual -w ui` needs a local baseline (`-- --update-snapshots` before a
change). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and the Typst packages
cetz/unify/oxifmt in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is installed.
