# State

Last updated: 2026-10-28 (Step 5a done) Branch: `step/05-typst` Last tag: `step-05a`

## Current step

Step 5a (Typst World and rapport PDF) is done: reviewed (`docs/reviews/step-05a.md`), majors
fixed, tag `step-05a` on `step/05-typst` (merged into `main` after 5b, as in Step 4).
Waiting for the user before 5b.

## Step 5a summary

- `maatwerk-core::assets`: embedded `rapport.typ` (= `rtti_export.typ`, SPDX header, input
  guards), `rapport-main.typ` (entry, reads `data.json`), `lib.typ` (markers `__maatwerk_*`,
  counters `maatwerk-vraag*`), `base_assignment.typ` (unchanged); fonts Source Serif 4 (12) +
  STIX Two Math; packages zero/cetz/oxifmt/unify embedded by `build.rs` (`PACKAGE_FILES`).
- `maatwerk-core::typst_svc`: `MaatwerkWorld` (virtual files + `Mount`s behind
  canonicalise/prefix check, embedded packages only, injectable clock for `today()` and the PDF
  date), `FontStore` (template fonts, system fonts searched once via `FontStore::shared()`, then
  Typst's), `Diagnostic`/`Location`/`TraceFrame` + `to_text` (CLI-like, virtual paths only),
  `compile_document`, `compile_pdf`, `render_rapport_pdf(fonts, &RapportData, &DataDir, now)`.
- Parity: `tests/typst_rapport.rs` (12 tests) matches `rapport-one-student` and `rapport-valid`
  **pixel for pixel** (30 ppi) plus page count/sizes/text; no-watermark gives the same error.
- Quirks fixed template side: T26 (non-colour colours, non-number scores), T11/T27 (`$` guard on
  `uitleg_rtti` and leeradvies; only unescaped `$` count, review M2, also in the UI's
  `sanitizeTypstMarkup`). `rapport-markup` and `rapport-tiny` data now compile.
- Review M1: `normaliseForTypst` (UI) restores the `toTypst` values (`undefined` -> `null`,
  non-finite -> `0`) for the JSON payload. **Step 6 must call it** in `TauriApi.renderRapportPdf`.
- `deny.toml`: RUSTSEC-2026-0194/0195 (quick-xml via typst 0.14.2) ignored with reason; backlog.
- Watcher test `m1_a_failed_own_write_releases_the_file` was flaky (same-size content); test fixed,
  product edge case in the backlog.

## Deferred to 5b

- Opdracht World (one project folder, `main.typ` with `sys.inputs` header: covers "same for the
  assignment header"), cursor marker rename (`__maatwerk_cursor`, `maatwerk-cursor:`) with the
  editor label filter, SVG pages, batch + progress, `pdf_merge` (lopdf), CLI `typst compile`,
  emoji/tofu check, lib.typ version line, memory measurement (`docs/perf.md`), review 5a nits
  (backlog).
- No Tauri command yet: Step 6 (rapport command via `spawn_blocking` + `FontStore::shared()`).

## In progress

- Nothing.

## Next action (concrete, resumable)

1. When the user says go: Step 5b (PLAN.md section 6, Step 5, "5b"), branch `step/05-typst`
   continues from `step-05a`.

## Open questions for the user

- quick-xml advisory ignore (local DoS only, needs typst > 0.14): accept?
- Remote repo still to create, so CI has never run (also not the new pixel tests, which depend on
  the emoji font); PLAN section 9 items (emoji font 5b, domain logic location Step 10,
  versioning, macOS).

## How to resume

PowerShell for npm/cargo (Git Bash's `link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). In PowerShell 5.1, commit with
`git commit -F <file>` (inline messages with quotes get split into pathspecs). `npm ci; npm run
build:ui`, then the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright
install chromium` in `ui/`). Rapport parity: `cargo test -p maatwerk-core --test typst_rapport`
(needs system fonts incl. Segoe UI Emoji; failing pages are written to
`target/tmp/golden/<case>/`). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and
the Typst packages in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is installed.
