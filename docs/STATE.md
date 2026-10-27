# State

Last updated: 2026-10-27 (Step 3b, waiting for the user's grid choice) Branch:
`step/03-ui-foundation` Last tag: `step-03a` (on the branch; Step 3 merges into `main` after 3b)

## Current step

Step 3b (score grid replacement), stopped at the decision point: the user chooses the grid.

## Done since last tag (`step-03a`)

- `ui/e2e/score-grid.spec.ts` + `ui/e2e/grid-driver.ts`: the spec `docs/specs/score-grid.md`
  (G01-G57) runs against Handsontable, 30 tests, stable. Pinned known failures (`test.fail`) that
  the new grid must fix: G33 (U4), G52 (U2, with `MockApi.slowWrites`), G31 letters (new quirk
  U19). G46 (Ctrl+Z, U1) is `fixme` until the user decides.
- ADR-0004 (proposed): own `<table>` grid recommended; Tabulator as fallback.

## Step 3a summary (tag `step-03a`)

- Reference renderer in Vite (verbatim import, codemod `window.maatwerk`, Prettier), npm deps at
  reference versions, offline test. Bridge `ui/src/bridge/api.ts` (28 methods + `pdfUrl`),
  `MockApi` on the fixtures, `TauriApi` stub, `npm run dev:mock`.
- Domain modules `ui/src/domain/*` (+ `services/rapport.ts`), Store delegates; Vitest against the
  logic goldens (grades, attempts, ids, opdrachten, csv, rapport, score-writes); ESLint keeps
  domain code pure. `migrate()` dropped.
- Fixed with failing tests first: B22, T26, T27, B9 (data side), U3, U6, U7, U9 (+ close after a
  failed save), D25 (+ image calls).
- Strict CSP from `ui/vite/csp.ts`; all inline styles gone, pixel-identical (`npm run
test:visual`); CSP walkthrough of 37 views in CI; smoke test; `docs/parity.md`.
- Review `docs/reviews/step-03a.md`: 3 majors and all minors fixed or recorded (triage table).

## Step 2 summary

- Harness `tests/reference-harness/`, fixtures `tools/fixtures/`, logic and Typst goldens,
  storage spec S01-S40, `docs/testing.md`. Details: `docs/reviews/step-02.md`.

## In progress

- Nothing; waiting for the user.

## Next action (concrete, resumable)

1. When the user says go: implement the own grid behind a `ScoreGrid` interface
   (`ui/src/components/score-grid/`), make `ui/e2e/grid-driver.ts` point at it, flip the
   `test.fail` pins (U2, U4, U19) to normal tests, remove `handsontable` (package, licence
   exception in `tools/check-npm-licenses.mjs`, `THIRD_PARTY_LICENSES.md`), restore the CI exe
   upload, run the visual test (the grid views will differ: review with the user), 3b review,
   gate, merge `step/03-ui-foundation` into `main`, tag `step-03`.
2. D34: confirmation dialog with old-vs-new overview before overwriting groups (failing test
   first; csv.json `group-csv` pins today's behaviour). G46: un-`fixme` with the new grid.

## Decisions (user, 2026-10-27)

- **Score grid:** own grid on a `<table>` (ADR-0004 accepted).
- **D34:** keep overwriting, but ask for confirmation first; ideally the dialog shows old vs new per
  group with removed students as red rows and added students as green rows (quirks.md D34).
- **U1:** Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z drive the app's undo history in the new grid (spec G46).
- **ADR-0002 deviations confirmed:** CSP `frame-ancestors 'self'`; styling cleanup in Step 10.
- The user asked to only record these; start 3b implementation when the user says so.

## Open questions for the user

- Earlier: S37/S38 to ask again in Step 4; remote repo still to create (`gh` not installed);
  PLAN section 9 items (emoji font Step 5, domain logic location Step 10, versioning, macOS).

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright install chromium` in
`ui/`). `npm run test:visual -w ui` needs a local baseline (`-- --update-snapshots` before a
change). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and the Typst packages
cetz/unify/oxifmt in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is installed.
