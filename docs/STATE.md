# State

Last updated: 2026-10-28 (Step 5a, before review) Branch: `step/05-typst` Last tag: `step-04`

## Current step

Step 5a (Typst World and rapport PDF). Code done and committed (`4f14a72`); docs updated. Next:
mid-step review (`docs/reviews/step-05a.md`), fix blockers/majors, tag `step-05a`, then stop and
report to the user.

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
- Parity: `tests/typst_rapport.rs` matches `rapport-one-student` and `rapport-valid` **pixel for
  pixel** (30 ppi) plus page count/sizes/text; no-watermark and markup goldens give the same errors.
- Quirks fixed template side: T26 (non-colour colours, non-number scores), T11/T27 (`$` guard on
  `uitleg_rtti`). Failing tests first (see commit message).
- `deny.toml`: RUSTSEC-2026-0194/0195 (quick-xml via typst 0.14.2) ignored with reason; backlog.
- SPDX check skips vendored packages and `base_assignment.typ`; `.prettierignore` skips vendored
  fonts/packages.

## Deviations / deferred to 5b

- "Same for the assignment header" (PLAN 5a): per ADR-0002 5a the opdracht header comes through
  `sys.inputs` in `main.typ`; done with the opdracht World in 5b (`WorldSpec::inputs` exists).
- Cursor marker rename (`__maatwerk_cursor`, `maatwerk-cursor:`) and the editor label filter: 5b,
  together with the preview wrapper (naming map).
- Opdracht sandbox (one project folder), SVG, batch, merge, CLI, emoji check: 5b.
- No Tauri command yet: Step 6 (rapport command uses `spawn_blocking` + `FontStore::shared()`).

## In progress

- Review of 5a.

## Next action (concrete, resumable)

1. Spawn the reviewer subagent for 5a (diff `step-04..HEAD`, PLAN Step 5 section, Appendix C),
   write `docs/reviews/step-05a.md`, fix blockers/majors, re-run the gate, tag `step-05a`.
2. Stop and report. Then 5b when the user says go.

## Open questions for the user

- quick-xml advisory ignore (local DoS only, needs typst > 0.14): accept?
- Remote repo still to create, so CI has never run (also not the new pixel tests); PLAN section 9
  items (emoji font Step 5b, domain logic location Step 10, versioning, macOS).

## How to resume

PowerShell for npm/cargo (Git Bash's `link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). In PowerShell 5.1, commit with
`git commit -F <file>` (inline messages with quotes get split into pathspecs). `npm ci; npm run
build:ui`, then the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright
install chromium` in `ui/`). Rapport parity: `cargo test -p maatwerk-core --test typst_rapport`
(needs system fonts incl. Segoe UI Emoji; failing pages are written to
`target/tmp/golden/<case>/`). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and
the Typst packages in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is installed.
