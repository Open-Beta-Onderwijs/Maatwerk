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

- Gate: `cargo clippy`, `cargo test`, `npm run build:exe` and running the exe. All fail at link
  time because the machine has no MSVC `link.exe` and no Windows SDK.

## Next action (concrete, resumable)

1. User repairs Visual Studio (see `docs/dev-setup.md`, "Fixing the MSVC/SDK problem").
2. In PowerShell: `npm ci; npm run build:ui; cargo clippy --workspace --all-targets -- -D warnings; cargo test --workspace`.
3. `npm run build:exe`, start `target\release\maatwerk.exe`, type a name, click "Begroet": it
   should show `Hallo, <naam>! (maatwerk-core 0.1.0)`.
4. Fix anything that fails, commit. Run the review (PLAN 2.3) -> `docs/reviews/step-00.md`,
   triage.
5. Merge `step/00-bootstrap` into `main` (merge commit), tag `step-00`, mark Step 0 done in
   PLAN.md section 3, report.

## Open questions for the user

- **Toolchain:** VS 2022 has `cl.exe` but no `link.exe`, and no Windows SDK is installed. Please
  repair/modify the VS install (admin rights needed).
- **Reference licence:** the reference repo has no LICENSE. Porting its code, Typst templates and
  icon into a public AGPL repo needs the copyright holder's permission (or the holder is you).
  Please confirm. The app icon in `src-tauri/icons/` is generated from the reference PNG.
- **OneDrive:** the repo is inside OneDrive. `target/` and `node_modules/` (GBs) will be synced and
  may be locked mid-build. Move the repo, exclude those folders, or set `CARGO_TARGET_DIR` outside
  OneDrive?
- Remote: still to create (repo `maatwerk`, public). `gh` CLI is not installed.

## How to resume

PowerShell (not Git Bash, whose `link` shadows MSVC's): `npm ci; npm run build:ui`, then the gate
commands in `CLAUDE.md`. `cargo-deny` is not installed on the machine (the install failed at
link time); a prebuilt binary was used from the session scratchpad. Re-download it or
`cargo install cargo-deny --locked` once linking works.
