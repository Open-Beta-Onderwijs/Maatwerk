# State

Last updated: 2026-10-26 (Step 3a in progress) Branch: `step/03-ui-foundation` Last tag: `step-02`

## Current step

Step 3a (UI foundation). Started 2026-10-26 on `step/03-ui-foundation`.

## Done since last tag

- 3a.1 verbatim import of `_reference/renderer` (8c27793; WIP commit, not green by design).
- 3a.2 codemod `window.rtti` -> `window.maatwerk`, editor postMessage types `rtti-*` ->
  `maatwerk-*`.
- 3a.3 Prettier on the imported code (mechanical).
- 3a.4 Vite multi-page build, vendored npm deps at reference versions, `src/legacy/globals.ts`,
  SPDX, ESLint legacy config, `ui/tests/offline.test.ts`. Handsontable is a documented temporary
  licence exception (removed in 3b; CI exe artifacts must not be distributed until then).

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

- 3a.5 bridge.

## Next action (concrete, resumable)

1. 3a.5 bridge: `ui/src/bridge/api.ts` (interface of the 28 ported methods with their compat
   result shapes), `MockApi` (in-memory FS seeded from `tools/fixtures`, CAS conflicts,
   `data:changed`), `TauriApi` stub, `npm run dev:mock`.
2. Then: domain extraction + quirk fixes (failing test first), inline styles -> classes + strict
   CSP, Playwright smoke, `docs/parity.md`, 3a review, tag `step-03a`.

## Open questions for the user

- Decided 2026-10-26: T26 and T27 are fixed in the port (3a/5a, failing test first). S37/S38: the
  user will probably rule that Step 4 fixes them; **ask again in Step 4** with a concrete proposal.
- Remote: still to create (repo `maatwerk`, public). `gh` CLI is not installed.
- Open decisions still pending (PLAN section 9): emoji font (Step 5), score grid choice (Step 3b),
  domain logic location (Step 10), versioning/update policy, macOS items.

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`. Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and the
Typst packages cetz/unify/oxifmt in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is
installed.
