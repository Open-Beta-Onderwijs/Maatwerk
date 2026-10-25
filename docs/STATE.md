# State

Last updated: 2026-10-25 (Step 1 started) Branch: `step/01-reference-study` Last tag: `step-00`

## Current step

Step 1: reference study and architecture review. Ends at a **STOP for approval**.

## Done since last tag

- (nothing yet)

## Step 0 summary

- Decisions in ADR-0001: AGPL-3.0-or-later, repo `maatwerk`, identifier
  `nl.openbetaonderwijs.maatwerk`, no remote yet, stay on Tauri 2 (Tauri 3 in the backlog).
- Reference `_reference/` at `0e30a70` (v0.1.6); see `docs/reference/VERSION.md`.
- Workspace, hello world with a `greet` round trip, CI workflow, licence policy (cargo deny, npm
  check with a tested SPDX parser), SPDX headers.
- Review `docs/reviews/step-00.md`: 0 blockers, 2 majors fixed, minors fixed or backlogged.
- `main` was created at the first commit `9bf56da`, and `step/00-bootstrap` was merged into it
  with `--no-ff`.

## In progress

- Four parallel reader subagents: (a) `ipc-api.md`, `data-files.md`, `docs/schemas/`; (b)
  `business-rules.md`; (c) `typst-contract.md`; (d) `ui-map.md`, `naming-map.md`, code metrics.
  Quirks and metrics land in the session scratchpad first and are merged into
  `docs/reference/quirks.md` and `docs/architecture-review.md`.

## Next action (concrete, resumable)

1. If the session ended mid-step: re-run any missing `docs/reference/*.md` study from PLAN Step 1.
2. Merge quirks into `docs/reference/quirks.md`; write `docs/architecture-review.md`,
   `docs/adr/0002-target-architecture.md`, `docs/adr/0003-data-format-v2-candidates.md`.
3. Review, commit, STOP for the user's approval (do not merge before approval decisions).

## Open questions for the user

- Manual check: start `target\release\maatwerk.exe`, type a name, click "Begroet", expect
  `Hallo, <naam>! (maatwerk-core 0.1.0)`. The contract is covered by a Rust test; the click is not.
- Remote: still to create (repo `maatwerk`, public). `gh` CLI is not installed.

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`. `cargo-deny` is not installed on the machine; a prebuilt 0.20.2 binary
was used from the session scratchpad. Install it with `cargo install cargo-deny --locked` (now
possible since the VS repair).
