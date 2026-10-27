# State

Last updated: 2026-10-27 (Step 3 done) Branch: `main` Last tag: `step-03`

## Current step

Step 3 is done and merged (`step-03`). Waiting for the user before Step 4 (Rust core: paths,
storage, watcher).

## Step 3b summary (on `step/03-ui-foundation`, tag `step-03b`, merged as `step-03`)

- Own score grid `ui/src/components/score-grid/` (ADR-0004 outcome) driven by
  `ui/src/screens/scores.js`; pure logic in `ui/src/domain/scoregrid.ts` (scoregrid.json golden).
  Handsontable removed and banned by `npm run licenses`; CI uploads the exe again after that check.
- Fixed: U1 (Ctrl+Z/Y drive the app history; buttons disabled when empty), U2 (save queue),
  U4 (paste into observaties), U19, D34 (confirmation with old-vs-new overview,
  `ui/src/domain/groups.ts`). New rules G53, G59-G63 in `docs/specs/score-grid.md`.
- Performance: ~14 ms per keystroke at 6 grids / 11,410 cells (incremental redraw).
- Review `docs/reviews/step-03b.md`: M1 (queued saves could land in another subject) fixed test
  first; minors fixed or in `docs/backlog.md` (triage table in the review).
- Visual: score modal within ~1 px of Handsontable; ↶/↷ now disabled when empty. Local visual
  baseline updated after the grid change.
- Follow-up (user feedback): question numbers and observation icons in the header now sit on the
  same line as Totaal/Cijfer; checkboxes centred in their cells.

## Step 3a summary (tag `step-03a`)

- Reference renderer in Vite, bridge `ui/src/bridge/api.ts` + `MockApi`, domain modules, strict CSP,
  quirk fixes B22, T26, T27, B9, U3, U6, U7, U9, D25. Review `docs/reviews/step-03a.md`.

## In progress

- Nothing.

## Next action (concrete, resumable)

1. When the user says go: Step 4 (PLAN.md section 6, Step 4). Ask S37/S38 again there.

## Open questions for the user

- S37/S38 (Step 4); remote repo still to create (`gh` not installed), so CI has not run on 3b;
  PLAN section 9 items (emoji font Step 5, domain logic location Step 10, versioning, macOS).

## How to resume

PowerShell for npm/cargo (Git Bash's `link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). `npm ci; npm run build:ui`, then
the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright install chromium`
in `ui/`). `npm run test:visual -w ui` needs a local baseline (`-- --update-snapshots` before a
change). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and the Typst packages
cetz/unify/oxifmt in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is installed.
