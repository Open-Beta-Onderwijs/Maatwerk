# State

Last updated: 2026-10-26 (Step 2a reviewed; 2b in progress) Branch: `step/02-safety-net` Last tag: `step-01`

## Current step

Step 2 (safety net on the old app), sub-step 2a. User said to proceed on 2026-10-25.

## Done since last tag

- 2a.1 Harness `tests/reference-harness/` (real main.js handlers + preload + Store in Node, acorn
  function/snippet extraction, frozen clock, TZ Europe/Amsterdam, nl-NL default collation).
- 2a.2 `tools/fixtures/generate.mjs` (`tiny`, `school`), hashes in `tools/fixtures/manifest.json`.
- 2a.3 Logic goldens `tests/golden/logic/*.json` (11 suites, 143 cases) from
  `npm run golden:regen`; `npm run golden:check` and `tests/golden/logic.test.mjs` re-run them.
- 2a.4 Storage spec: `tools/reference-shims/` (verbatim sync.js, main.js lock/CAS handlers,
  Store.update/saveEntity), `storage.test.mjs` rows S01-S36, `docs/specs/storage-spec.md`.
- 2a.5 `docs/testing.md` (commands, golden format, harness assumptions, coverage matrix).
  Quirks: new D35 (watcher first touch), correction to B22 (BOM is stripped).

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

Step 2a plan (sub-tasks, each one commit on `step/02-safety-net`):

1. Harness skeleton `tests/reference-harness/`: locate `_reference/` (check commit), load the real
   `main.js` IPC handlers with a fake `electron`, load `store.js` in a `vm` context with a fake
   `window.rtti` that calls those handlers, extract inner functions from UI modules by name
   (acorn), fixed clock + `TZ=Europe/Amsterdam`.
2. `tools/fixtures`: seeded generator (`tiny`, `school`) + tree-hash manifest checked in CI.
3. Logic goldens `tests/golden/logic/*.json` for business-rules.md section 11 (48 cases) via
   `npm run golden:regen` / `golden:check` (check needs `_reference/`; CI validates structure).
4. Storage/sync spec: `sync.js` + lock/CAS handlers copied verbatim to `tools/reference-shims/`,
   node:test spec, `docs/specs/storage-spec.md`.
5. `docs/testing.md` coverage matrix, CI, mid-step review, tag `step-02a`.

Then 2b: Typst goldens (reference CLI 0.14.2, pdf-lib + pdfjs-dist dev deps).

Decisions taken: test runner is `node:test` (built in) instead of Vitest for the harness; dev
deps `acorn`, `acorn-walk` (MIT).

- 2a review (`docs/reviews/step-02a.md`): 0 blockers, 3 majors, 7 minors, 6 nits; all fixed except
  n4 (backlog). Storage spec now S01-S40; quirk B31 (readdir order) and harness pin.
- 2b (WIP commit `c0a8c94`): `npm run golden:typst [-- --check]`, 21 cases in
  `tests/golden/typst/`, wrapper shims `tools/reference-shims/typst-wrappers.cjs`,
  `tests/golden/typst.test.mjs`. New quirks T26 (invalid score breaks rapport), T27 (`$` guard
  breaks rapport).

## Next action (concrete, resumable)

1. Commit the 2a review fixes, tag `step-02a`.
2. Finish 2b: docs/testing.md Typst section, final review (`docs/reviews/step-02.md`), gate incl.
   cargo, merge to main, tag `step-02`, report.

## Open questions for the user

- Remote: still to create (repo `maatwerk`, public). `gh` CLI is not installed.
- Open decisions still pending (PLAN section 9): emoji font (Step 5), score grid choice (Step 3b),
  domain logic location (Step 10), versioning/update policy, macOS items.

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`. `cargo-deny` 0.20.2 is installed. The schema validator (ajv) lives
outside the repo; reinstall per `docs/schemas/README.md` if needed.
