# State

Last updated: 2026-10-25 (end of Step 1) Branch: `main` Last tag: `step-01`

## Current step

Step 1 done and approved. Next: Step 2, safety net on the old app (only when the user says so).

## Done since last tag

- (nothing yet)

## Step 1 summary

- Reference study in `docs/reference/` (IPC API, data files, business rules, Typst contract, UI map,
  naming map, 106 quirks, metrics), draft JSON Schemas in `docs/schemas/`.
- `docs/architecture-review.md` with the user's decisions (section 8).
- ADR-0002 accepted with the user's amendment: opdracht folders are self-contained Typst projects
  (section 5a). ADR-0003 decided: all candidates, timing table per step.
- Fix during the port: ADR-0002 section 10. CSP without inline styles (Step 3). Printed PDFs go to
  `rapporten/` (Step 6). PLAN.md step sections carry "Step 1 decisions" notes.
- Step 0 hello world confirmed working by the user.

## In progress

- (nothing)

## Next action (concrete, resumable)

1. When the user says so: `git checkout -b step/02-safety-net`, read PLAN.md Step 2 and its notes.

## Open questions for the user

- Remote: still to create (repo `maatwerk`, public). `gh` CLI is not installed.
- Open decisions still pending (PLAN section 9): emoji font (Step 5), score grid choice (Step 3b),
  domain logic location (Step 10), versioning/update policy, macOS items.

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`. `cargo-deny` 0.20.2 is installed. The schema validator (ajv) lives
outside the repo; reinstall per `docs/schemas/README.md` if needed.
