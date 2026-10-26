# State

Last updated: 2026-10-26 (end of Step 2) Branch: `main` Last tag: `step-02`

## Current step

Step 2 done. Next: Step 3, UI foundation (only when the user says so).

## Done since last tag

- (nothing yet)

## Step 2 summary

- Harness `tests/reference-harness/`: the real reference `main.js`, `preload.js` and `store.js` run
  in Node (fake Electron); UI helpers are extracted by name or checked line range. Pinned: clock,
  TZ Europe/Amsterdam, nl-NL collation, NTFS directory order (quirk B31).
- Fixtures `tools/fixtures/` (`tiny`, `school`), hashes in `manifest.json`.
- Logic goldens `tests/golden/logic/` (11 suites), Typst goldens `tests/golden/typst/` (21 cases,
  paths A-D, PNG 30 ppi, PDF text). `npm run golden:regen`, `golden:typst`, `golden:check`.
- Storage spec `docs/specs/storage-spec.md` rows S01-S40 on verbatim shims in
  `tools/reference-shims/` (CI-executable).
- `docs/testing.md`: commands, format, assumptions, coverage matrix.
- Reviews `docs/reviews/step-02a.md`, `step-02.md`: all blockers/majors fixed; rest in backlog.
- New quirks: B31, D35, T26, T27; B22 corrected.

## In progress

- (nothing)

## Next action (concrete, resumable)

1. When the user says so: `git checkout -b step/03-ui-foundation`, read PLAN.md Step 3 and its notes.

## Open questions for the user

- Quirks T26 (one invalid typed score breaks the whole class rapport) and T27 (the unclosed-`$`
  guard itself breaks the rapport): fix during the port or keep for parity? Both change output.
- Storage S37/S38: CAS is not atomic across instances and several files are written blind. C3 (no
  `.lock` files) relies on CAS; Step 4 must decide how to close the window (stop and ask then).
- Remote: still to create (repo `maatwerk`, public). `gh` CLI is not installed.
- Open decisions still pending (PLAN section 9): emoji font (Step 5), score grid choice (Step 3b),
  domain logic location (Step 10), versioning/update policy, macOS items.

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`. Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and the
Typst packages cetz/unify/oxifmt in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is
installed.
