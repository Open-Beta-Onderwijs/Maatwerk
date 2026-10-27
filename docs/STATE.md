# State

Last updated: 2026-10-27 (Step 4a in progress) Branch: `step/04-core-storage` Last tag: `step-03`

## Current step

Step 4a: paths and storage in `maatwerk-core`.

User decisions (2026-10-27), recorded in `docs/specs/storage-spec.md`:

- S37: commit lock = process-wide mutex per data folder + OS file lock (`std::fs::File::lock`) on
  a file in a local folder (`%TEMP%/maatwerk-locks`), held only for check + rename.
- S38: every JSON write uses CAS; school/config/RTTI templates via `update()` (C6); unused
  `saveStudents`/`saveStudentScores` removed.

## Done since last tag

- `maatwerk-core`: `error` (typed `Error` with stable `code()`), `paths` (`RelPath`, `DataDir`,
  junction/symlink escape check, proptest), `jsonfmt` (`JSON.stringify(x, null, 2)` incl. JS
  number formatting), `storage` (atomic write, CAS, commit lock, `update`, `save_entity`,
  `_meta` stamping, years, read-all, text, photos, seed, schema_version check C1,
  `LocalSession`). Spec rows S01-S27, S37, S38 as Rust tests; cross-process test
  (`crates/maatwerk-core/tests/cross_process.rs`).
- Bug found by the cross-process test and fixed test-first: `resolve` canonicalised the file
  itself; a file being replaced resolves under `\$Extend\$Deleted` on NTFS -> spurious
  `invalid_path`.

## In progress

- Nothing uncommitted.

## Next action (concrete, resumable)

1. UI side of S38/C6: `saveSchool`, `setActiveYear`, RTTI templates (`modals/rapport.js:447`)
   through `update()`; delete `saveStudents`/`saveStudentScores`; tests.
2. Docs: parity rows, quirks (ensure_year validates the year; lib.typ not seeded; C7 in 6a).
3. Gate, review subagent (`docs/reviews/step-04a.md`), tag `step-04a`, stop and report.

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
