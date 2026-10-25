# State

Last updated: 2026-10-25 (end of Step 1) Branch: `step/01-reference-study` Last tag: `step-00`

## Current step

Step 1: reference study and architecture review. **STOPPED at the approval gate**, waiting for the
user's answers. The branch is not merged yet: ADR statuses change with the answers.

## Done since last tag

- `docs/reference/`: `ipc-api.md`, `data-files.md`, `business-rules.md` (48 golden candidates),
  `typst-contract.md` (11 parity candidates), `ui-map.md`, `naming-map.md` (full), `quirks.md`
  (106 items, IDs D/B/T/U), `metrics.md`.
- `docs/schemas/`: 12 draft JSON Schemas, 13 synthetic samples, all valid (ajv, strict).
- `docs/architecture-review.md`, `docs/adr/0002-target-architecture.md` (proposed),
  `docs/adr/0003-data-format-v2-candidates.md` (open, 13 candidates).
- Review `docs/reviews/step-01.md`: 0 blockers, 4 majors fixed/resolved, minors fixed.

## In progress

- (nothing)

## Next action (concrete, resumable)

1. Get the user's answers to the questions in `docs/architecture-review.md` section 7.
2. Update ADR-0002 status (accepted, with changes) and ADR-0003 (chosen candidates); record
   answers in ADR-0001 style.
3. Merge `step/01-reference-study` into `main` (merge commit), tag `step-01`, PLAN.md section 3.
4. Step 2 only when the user says so.

## Open questions for the user

- The 8 questions in `docs/architecture-review.md` section 7.
- Manual check of the Step 0 hello world ("Begroet" click).
- Remote: still to create (repo `maatwerk`, public). `gh` CLI is not installed.

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`. `cargo-deny` 0.20.2 is installed. The schema validator (ajv) was
installed in the session scratchpad; reinstall per `docs/schemas/README.md` if needed.
