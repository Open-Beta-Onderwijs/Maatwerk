# Review: Step 0 (Bootstrap)

Reviewer: fresh-context subagent, 2026-10-25. Scope: everything committed on `step/00-bootstrap`
(`9d802a0`, `0293034`, `8f1ffdf`; no tags yet), checked against PLAN.md sections 2, 4, 6 (Step 0)
and Appendix C. The implementer's summary was not trusted; every fact below was re-checked from the
files, the reference clone or by running the command.

Summary: no blockers. The project builds, all local checks pass, the exe starts and opens the
"Maatwerk" window, and the reference facts in `docs/reference/VERSION.md` are correct. Two majors:
the Windows CI job hides lint/typecheck failures, and the npm licence check passes some SPDX
expressions it should reject.

## Blocker

None.

## Major

### M1. Windows CI: multi-line `run` hides failures of `npm run lint` and `npm run typecheck`

- `.github/workflows/ci.yml:50-54`
- Evidence: on `windows-latest` the default shell is `pwsh`. GitHub runs the script as
  `$ErrorActionPreference = 'stop'` + script + `if ((Test-Path -LiteralPath variable:\LASTEXITCODE)) { exit $LASTEXITCODE }`.
  A native command that exits non-zero does not stop a pwsh script
  (`$PSNativeCommandUseErrorActionPreference` defaults to `$false`), so only the exit code of the
  **last** line (`npm test`) decides the step. A lint or type error leaves CI green, which breaks
  the gate in PLAN 2.2 ("all pass ... in CI").
- Fix: one command per step (`- run: npm run lint`, `- run: npm run typecheck`, `- run: npm test`),
  or set `shell: bash` for that step (GitHub's bash runs with `-eo pipefail`), or add
  `if ($LASTEXITCODE) { exit $LASTEXITCODE }` after each line. Separate steps also give clearer logs.

### M2. npm licence check accepts `X AND (Y OR Z)` when X is not allowed

- `tools/check-npm-licenses.mjs:29-32`
- Evidence: `isAllowed` removes all parentheses and then splits on `OR` before `AND`. That changes
  the meaning of any expression where `OR` sits inside parentheses. Run with the same function:
  - `LicenseRef-Proprietary AND (MIT OR Apache-2.0)` gives `true` (should be `false`)
  - `(MIT OR Proprietary) AND Proprietary2` gives `true` (should be `false`)

  The gate fails open, which goes against PLAN 2.5 ("Never add proprietary ... code"). It has no
  effect today: the only shipped package is `@tauri-apps/api` (`Apache-2.0 OR MIT`).

- Fix: parse the expression properly. One option is a small recursive-descent parser (`OR` binds
  looser than `AND`, parentheses group, `WITH` stays part of one term). The other is a dev
  dependency on `spdx-expression-parse` / `spdx-satisfies` (both MIT). Add a unit test (Vitest or
  `node --test`) with the two cases above, a plain id, `A OR B`, `A WITH exc`, lowercase `or`, and
  a missing licence.

## Minor

### m1. Layering check passes silently when `cargo tree` fails, and checks only the host target

- `.github/workflows/ci.yml:31-35`
- Evidence: `if cargo tree ... | grep -E '^tauri'; then` has no `pipefail` (the default Linux
  shell is `bash -e {0}`), and errors inside an `if` condition do not stop the script anyway. If
  `cargo tree` fails (a typo in the package name, a lockfile or network problem), grep reads empty
  input, the condition is false and the step passes. A test run with the wrong name `maatwerk-cor`
  exits 101 with no output on stdout, which would pass. Also, `cargo tree` resolves only the host
  target (Linux), so a `[target.'cfg(windows)'.dependencies] tauri = ...` in core would not be
  seen. The detection itself does work: `cargo tree -p maatwerk-app -e normal,build --prefix none`
  lists `tauri v2.12.5`, and core lists only itself.
- Fix: capture the output first, then grep:
  `deps=$(cargo tree -p maatwerk-core -e normal,build --target all --prefix none)` (fails the step
  under `-e`), then `if grep -E '^tauri' <<<"$deps"; then ...`. Another option, or an addition: in
  `deny.toml` add `[bans] deny = [{ crate = "tauri", wrappers = ["maatwerk-app"] }]`, which runs
  across all `[graph] targets`.

### m2. STATE.md and PLAN.md section 3/9 are stale

- `docs/STATE.md:7` says "**Blocked at the gate** on the local MSVC toolchain", while
  `:28-30` and "Resolved" `:47` say it is fixed.
- `docs/STATE.md:34` ("Wait for the user's decision on Tauri 2 vs 3") and `:41-42` (open question)
  contradict `docs/backlog.md:5` ("decided 2026-10-25"), and the brief says the user decided to stay
  on Tauri 2.
- `docs/STATE.md:55-57`: cargo-deny "install failed at link time ... once linking works". Linking
  works now.
- `docs/STATE.md:23-24` "Passing locally" does not list clippy and test, which do pass.
- `PLAN.md:95` still says "gate blocked: local MSVC toolchain". `PLAN.md:76` and `:435-436` (open
  decisions 7, 8) still list the identifier `nl.school.maatwerk` and the licence variant as open.
- Fix: update STATE (current step "gate passed locally, review in triage", remove the Tauri 3
  question, next action = triage, then merge/tag). Mark open decisions 7 and 8 as decided in PLAN
  with a pointer to ADR-0001. Update the section 3 row.

### m3. There is no `main` branch to merge into

- Evidence: `git branch -a` lists only `step/00-bootstrap`. The root commit `9d802a0` was made on
  the step branch. PLAN 2.4 needs "merge with a merge commit" into `main`, and STATE next action 3
  assumes `main` exists.
- Fix: decide and write down how `main` is created, for example
  `git checkout --orphan main && git rm -rf --cached . && git commit --allow-empty -m "chore: initial empty commit"`
  then `git merge --no-ff --allow-unrelated-histories step/00-bootstrap`. The simpler option is
  `git branch main 9d802a0` and merging the rest with `--no-ff`. Record the choice in STATE.

### m4. The command round trip has no automated test of the bridge contract

- `src-tauri/src/lib.rs:6-19`, `ui/src/greet.ts:4-7`, `ui/src/greet.test.ts`
- Evidence: `cargo test` runs 0 tests in `maatwerk-app`. The UI test checks only the formatter
  against a hand-written object. Nothing checks that Rust actually serialises `coreVersion` in
  camelCase, which is the one fact the UI depends on. STATE `:30` says the manual click on
  "Begroet" has not been done yet. This reviewer confirmed the exe starts with window title
  "Maatwerk", but did not click.
- Fix: add a Rust unit test,
  `serde_json::to_value(greet(" Jan "))` == `{"message":"Hallo, Jan!","coreVersion":"0.1.0"}`
  (this also makes the `serde_json` dependency used, see n4). Do the manual click before tagging
  and note it in STATE.

### m5. CI token permissions not restricted

- `.github/workflows/ci.yml:1-10`
- Evidence: there is no `permissions:` block, so the job gets the repository's default
  `GITHUB_TOKEN` scope. That can be read/write, depending on repo settings, and this will be a
  public repo.
- Fix: add `permissions: { contents: read }` at the top level.

### m6. Distributed exe will need full third-party notices (and source offer)

- `THIRD_PARTY_LICENSES.md:14`
- Evidence: the exe statically links about 300 crates (MIT 214, Apache-2.0 164, BSD-3-Clause 4,
  Zlib 12, Unicode-3.0 19, MPL-2.0 5, per `cargo deny list -l license`). MIT, BSD and Apache require
  the copyright and licence notices to ship with binary distributions. "Run `cargo deny list`" does
  not meet that. As AGPL/GPL software, a distributed exe also needs an offer of corresponding source
  (no public remote exists yet). This is fine for Step 0, because nothing is distributed, but the CI
  artifact is the start of distribution.
- Fix: backlog item for Step 6 (first release candidate): generate the notices file with
  `cargo-about` (licence MIT/Apache) plus the npm equivalent, ship it next to or inside the exe,
  and show a source link (repo URL and commit) in an About screen.

## Nit

- **n1. CSP.** `src-tauri/tauri.conf.json:25`: the production CSP is reasonable. Tauri adds
  nonces and hashes, `connect-src ipc: http://ipc.localhost` is correct, and there is no
  `withGlobalTauri`. Consider adding `object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
  (`base-uri` does not fall back to `default-src`). `devCsp` (`:26`) correctly allows the Vite
  origin, HMR websocket and inline styles. Note for the future: the reference renderer has 262
  inline `style="..."` attributes (`_reference/renderer/**`), and `style-src 'self'` will block
  them once the UI is ported. Decide this in Step 3 or ADR-0002, and do not quietly add
  `'unsafe-inline'`. Capabilities (`src-tauri/capabilities/default.json`): `core:default` on
  `main` only. Fine.
- **n2. Licence allowlists.** `deny.toml:12-33` and `tools/check-npm-licenses.mjs:9-26`: every
  listed licence is compatible with AGPL-3.0-or-later. Apache-2.0 and MPL-2.0 are compatible
  through GPLv3 and MPL section 3.3. LGPL-2.1-or-later and LGPL-3.0-or-later are compatible.
  GPL-3.0-or-later is compatible through AGPL section 13. There are no GPL-2.0-only or
  LGPL-2.1-only entries. Small points:
  - `GPL-3.0-only` and `LGPL-3.0-only` are also compatible but missing. Missing entries fail
    closed, which is fine.
  - OFL-1.1 is acceptable for fonts but not for code (FSF). Add a comment saying OFL is for font
    assets only.
  - MPL-2.0 "Incompatible With Secondary Licenses" is not detectable by the tools. Review MPL
    crates by hand.
  - The two lists differ: npm lacks `LGPL-2.1-or-later`, `BSL-1.0`, `Unicode-3.0`, `MIT-0`;
    Rust lacks `BlueOak-1.0.0`. Align them, or say why they differ.
  - The npm check only scans `ui` production dependencies. Root has none today, so that is fine.
- **n3. LICENSE is not the verbatim gnu.org text.** `LICENSE`: 235 lines and 34,020 bytes, with
  paragraphs unwrapped and `http://` URLs, against 661 lines and about 34.5 kB canonical. The terms
  are the same, but use the verbatim `https://www.gnu.org/licenses/agpl-3.0.txt` so licence
  detection and diffs are clean.
- **n4. Unused dependency.** `src-tauri/Cargo.toml:24`: `serde_json` is declared but not used in
  `src-tauri/src/*.rs`. Use it in the m4 test (as a dev-dependency) or remove it.
- **n5. Version duplicated.** `src-tauri/tauri.conf.json:5` (`"version": "0.1.0"`) duplicates
  `Cargo.toml:6`. If `version` is omitted, Tauri uses the Cargo package version, so they cannot
  drift apart.
- **n6. SPDX convention.** `tools/check-spdx.sh:12` does not cover `*.toml` / `*.yml` (these could
  carry a header) or future `*.tsx` / `*.cjs` / `*.mts`. There is no copyright line convention
  (`SPDX-FileCopyrightText`), and `README.md:14` says only "the Maatwerk contributors". Optional.
- **n7. `.gitattributes`.** `*.icns` (and future `*.woff2`, `*.xcf`) are not marked `binary`. Git
  currently detects `icon.icns` as `-text`, so nothing is broken.
- **n8. ADR-0001 omits the Tauri 3 decision.** `docs/adr/0001-decisions.md:31-32` mentions the
  3.0 alphas but not the user's decision to stay on 2.x and backlog 3.0. It is only in
  `docs/backlog.md`.
- **n9. CI hygiene.**
  - Actions are pinned to major tags; consider SHAs for a public repo. All tags exist upstream
    (checkout/setup-node/upload-artifact v7, cargo-deny-action v2, rust-cache v2, checked with
    `git ls-remote`).
  - `push` on `step/**` plus `pull_request` will run twice for PRs.
  - The policy job relies on rustup auto-installing 1.93.1 from `rust-toolchain.toml` for
    `cargo tree`. Add an explicit `rustup toolchain install` as in the Windows job.
    `rust-toolchain.toml:4` (`targets = ["x86_64-pc-windows-msvc"]`) makes Ubuntu and the
    cargo-deny container download a Windows std they do not need.
  - `cancel-in-progress` also cancels runs on `main`.
- **n10. CLAUDE.md short form misses two rules.** `CLAUDE.md:38-63` leaves out two rules from
  PLAN 2.1: "at session start run `git status` and the test suite for a baseline", and "keep
  context small: subagents for `_reference/`, read file ranges". The file is 72 lines, so there
  is room.
- **n11. ESLint.** `ui/eslint.config.js:8`: `tseslint.config()` is deprecated in recent
  typescript-eslint 8.x in favour of `defineConfig` from `eslint/config`.
- **n12. STATE header.** `docs/STATE.md:3` has a date but no time. The Appendix B template asks
  for date/time.

## Checked and found correct

- `docs/reference/VERSION.md`:
  - commit `0e30a70cbe4e9286bd54efa5722fb7532c1be308` (2026-10-20) equals `_reference` HEAD and
    `origin` HEAD
  - `package.json` version 0.1.6
  - `main.js` 1025 / `sync.js` 270 / `preload.js` 123 lines
  - 32 `ipcMain.handle`
  - `bin/typst/win/x_86_64/typst.exe --version` gives `typst 0.14.2 (b33de9de)`
  - no LICENSE in the reference
  - `97513cb..0e30a70` is 59 files, +5356/-352
  - 0.1.5 / 0.1.6 dates and subjects match
  - `zero` 0.7.1 is MIT; OFL font files are present
- `docs/dev-setup.md` versions match the machine: rustup 1.28.2, rustc 1.93.1, Node 24.14.0,
  npm 11.9.0, git 2.51.0, WebView2 155.0.4283.62, MSVC 14.44.35207, SDK 10.0.26100.0.
- ADR-0001 table matches PLAN section 1, and the Step 0 answers match the brief (AGPL-3.0-or-later,
  `maatwerk`, `nl.openbetaonderwijs.maatwerk`, no remote). `tauri.conf.json:6` uses that identifier.
  `naming-map.md` records the appId change.
- Layering: `maatwerk-core` has no dependencies. `greet` only delegates to core. There is no
  `rtti` in any new identifier (`git grep -i rtti` outside docs only finds prose). Workspace
  layout matches PLAN section 4 for a bootstrap (empty `tests/` and `ui/src/{bridge,...}` come
  later).
- `.gitignore` ignores `_reference/`, `data/` (root), `target/`, `node_modules/`, `ui/dist/`,
  `src-tauri/gen/` (verified with `git check-ignore`). Nothing forbidden is tracked; `git ls-files`
  is 52 source/config/doc files plus icons.
- No `innerHTML`; the UI writes with `textContent` only. No secrets.
- cargo-deny-action v2 config: `command: check licenses bans sources advisories` is passed through
  to `cargo-deny $*`. The action image ships cargo-deny 0.20.2 and installs the pinned toolchain
  from `rust-toolchain.toml`. `deny.toml` keys (`unmaintained = "workspace"`, `[licenses.private]`,
  `allow-wildcard-paths`) are valid for 0.20.
- Upload path `target/release/maatwerk.exe` matches the workspace target dir and `[[bin]] name`.
  The lockfile includes Linux optional native packages (`@rolldown/binding-linux-x64-gnu`,
  `@tauri-apps/cli-linux-x64-gnu`), so `npm ci` on Ubuntu is fine.

## Verified (commands run, PowerShell from repo root unless noted)

| Command                                                                    | Result                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run lint`                                                             | pass (eslint clean, Prettier "All matched files use Prettier code style") |
| `npm run typecheck`                                                        | pass                                                                      |
| `npm test`                                                                 | pass (1 file, 1 test)                                                     |
| `npm run licenses`                                                         | pass (`@tauri-apps/api@2.12.4: Apache-2.0 OR MIT`)                        |
| `npm run build:ui`                                                         | pass                                                                      |
| `cargo fmt --all --check`                                                  | pass                                                                      |
| `cargo clippy --workspace --all-targets -- -D warnings`                    | pass                                                                      |
| `cargo test --workspace`                                                   | pass (3 tests in core, 0 elsewhere)                                       |
| `cargo-deny deny check licenses bans sources advisories` (prebuilt 0.20.2) | `advisories ok, bans ok, licenses ok, sources ok`                         |
| `bash tools/check-spdx.sh` (Git Bash)                                      | pass (14 files checked)                                                   |
| `cargo tree -p maatwerk-core / maatwerk-app -e normal,build --prefix none` | core: only itself; app: lists `tauri v2.12.5` (check detects tauri)       |
| `cargo tree -p maatwerk-cor ...`                                           | exit 101, empty stdout (basis of m1)                                      |
| `target\release\maatwerk.exe` started for 5 s                              | process alive, window title "Maatwerk"; Begroet click not tested          |
| `git ls-remote --tags` on the five actions                                 | all referenced major tags exist                                           |
| node snippet with `isAllowed` from `check-npm-licenses.mjs`                | fails open on `X AND (Y OR Z)` (basis of M2)                              |

## Triage (implementer, 2026-10-25)

| Finding                   | Decision                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| M1                        | Fixed: one command per CI step (`.github/workflows/ci.yml`).                                                               |
| M2                        | Fixed: real SPDX parser `tools/spdx.mjs` with precedence and parens, 6 tests in `tools/spdx.test.mjs` (run by `npm test`). |
| m1                        | Fixed: `cargo tree` output captured under `set -euo pipefail`, `--target all`.                                             |
| m2                        | Fixed: STATE.md, PLAN.md section 3 and open decisions 7/8 updated.                                                         |
| m3                        | Fixed: `main` created at `9d802a0` (first commit; same code passes the gate), step branch merged with `--no-ff`.           |
| m4                        | Fixed: `greet_reply_matches_the_ui_contract` test in `src-tauri/src/lib.rs`. The manual click is left to the user.         |
| m5                        | Fixed: `permissions: contents: read`.                                                                                      |
| m6                        | Backlog (Step 6).                                                                                                          |
| n4, n7, n8, n10, n11, n12 | Fixed.                                                                                                                     |
| n1, n2, n3, n5, n6, n9    | Backlog.                                                                                                                   |
