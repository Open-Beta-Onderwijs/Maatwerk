# State

Last updated: 2026-10-25 Branch: `step/00-bootstrap` Last tag: none

## Current step

Step 0: Bootstrap. **Blocked at the gate** on the local MSVC toolchain (see open questions).

## Done since last tag

- Asked the Step 0 questions: AGPL-3.0-or-later; repo `maatwerk`; identifier
  `nl.openbetaonderwijs.maatwerk`; no remote yet (ADR-0001).
- `git init`, reference cloned into `_reference/` at `0e30a70` (v0.1.6, newer than the plan's
  v0.1.4); recorded in `docs/reference/VERSION.md`.
- Toolchain checked: `docs/dev-setup.md`.
- Cargo workspace (`maatwerk-core`, `maatwerk-cli`, `src-tauri` = `maatwerk-app`), Tauri 2.12 +
  Vite 8 + TS hello world with one `greet` command round trip (UI -> command -> core).
- CLAUDE.md, ADR-0001, LICENSE (AGPL-3.0 text), THIRD_PARTY_LICENSES.md, SPDX convention and
  check, `deny.toml`, npm licence check, rustfmt/Prettier/ESLint/editorconfig.
- CI workflow (`.github/workflows/ci.yml`): policy job on Ubuntu (SPDX, cargo deny, npm licences,
  core-has-no-tauri); Windows job (UI checks, fmt, clippy, test, `tauri build --no-bundle`, exe
  uploaded as an artifact). Not run yet: there is no remote.
- Passing locally: `npm run lint`, `npm run typecheck`, `npm test`, `npm run licenses`,
  `cargo fmt --check`, `cargo deny check` (all four), `tools/check-spdx.sh`.

## In progress

- Gate after the VS repair (2026-10-25): clippy clean, `cargo test` green, `npm run build:exe`
  builds `target\release\maatwerk.exe` (7.7 MB), which starts and opens the "Maatwerk" window.
  Still open: manual click on "Begroet", the review, merge and tag.

## Next action (concrete, resumable)

1. Wait for the user's decision on Tauri 2 vs 3 (open questions).
2. Run the review (PLAN 2.3) -> `docs/reviews/step-00.md`, triage.
3. Merge `step/00-bootstrap` into `main` (merge commit), tag `step-00`, mark Step 0 done in
   PLAN.md section 3, report.

## Open questions for the user

- **Tauri 3:** the user asked whether to move to Tauri 3 (alpha) now. Recommendation given: stay
  on 2.x until 3.0 is stable. Awaiting the decision.
- Remote: still to create (repo `maatwerk`, public). `gh` CLI is not installed.

## Resolved

- Toolchain: VS repaired by the user; `link.exe` and Windows SDK 10.0.26100 present.
- Reference licence: the user is the original author of the reference repo and its assets, so
  relicensing as AGPL-3.0-or-later is theirs to do.
- OneDrive: the user excludes `target/` and `node_modules/` from sync themselves.

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`. `cargo-deny` is not installed on the machine (the install failed at
link time); a prebuilt binary was used from the session scratchpad. Re-download it or
`cargo install cargo-deny --locked` once linking works.
