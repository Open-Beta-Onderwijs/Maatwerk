# Maatwerk: working notes for Claude Code

Desktop app for Dutch secondary-school teachers: exam scores, RTTI analysis, Typst PDF reports and
remedial assignments (opdrachten). Port of the Electron app in `_reference/` to Rust + Tauri 2.

**Every session:** read `PLAN.md` sections 1-3 and `docs/STATE.md`, then only the current step's
section of `PLAN.md`. Do not re-read the whole plan.

## Commands

Run cargo from **PowerShell**, not Git Bash: Git Bash's `/usr/bin/link` shadows MSVC `link.exe`.

```powershell
npm ci                                   # install JS deps (root + ui workspace)
npm run build:ui                         # needed once before cargo: generate_context! wants ui/dist
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run lint; npm run typecheck; npm test
npm run licenses                         # npm licence allowlist (shipped deps only)
npm run notices                          # regenerate THIRD_PARTY_NOTICES.txt (needs cargo-about 0.9)
cargo deny check licenses bans sources advisories
bash tools/check-spdx.sh                 # SPDX headers on tracked sources
npm run dev                              # tauri dev (Vite on :1420)
npm run build:exe                        # target/release/maatwerk.exe (portable, no installer)
```

## Layout

- `crates/maatwerk-core`: pure Rust. **Never** depends on `tauri` (CI checks this).
- `crates/maatwerk-cli`: headless tools on top of core.
- `src-tauri/` (`maatwerk-app`, binary `maatwerk`): thin shell. Command handlers parse args, call
  core, map errors. No business logic.
- `ui/`: Vite + TypeScript (JS UI migrates gradually). Layering:
  `ui -> bridge -> Tauri -> commands -> maatwerk-core`.
- `tools/`: fixture/golden generators, policy scripts. `docs/`: STATE, ADRs, reviews, reference.
- `_reference/`: gitignored, **read-only** clone of the Electron app. Never edit.

## Rules (PLAN.md section 2, short form)

- Session start: `git status`, run the test suite for a baseline. Keep context small: subagents
  for broad reading of `_reference/`, file ranges instead of whole large files.
- Small sub-tasks; each ends in a commit on `step/NN-slug` where build + tests pass. `main` is
  always green; merge with a merge commit, tag `step-NN`.
- Update `docs/STATE.md` after every sub-task and at least every ~45 min. Nothing may live only in
  context. If told to stop: make it compile, commit, update STATE.
- End of step: gate (2.2), fresh-context reviewer subagent (2.3, Appendix C) writing
  `docs/reviews/step-NN.md`, fix blockers/majors, then **stop and report**.
- Conventional commits. Golden/fixture updates state why in the commit message.
- Never commit `_reference/`, `data/`, `target/`, `node_modules/`, real student data, secrets.
- **No real student data** anywhere. Fixtures are synthetic (`tools/fixtures`, fixed seed).
- UI text Dutch, decimal comma (`1,5`). Code, comments, docs, commits in English. Domain words stay
  Dutch where the reference uses them.
- Naming: product/crates/bridge are **Maatwerk** (`maatwerk-core`, `window.maatwerk`). `rtti` only
  in domain code. Track renames in `docs/reference/naming-map.md`.
- Licences: only MIT/Apache/BSD/ISC/Zlib/MPL/OFL/LGPL/GPL/AGPL-compatible deps, fonts, Typst
  packages. Update `THIRD_PARTY_LICENSES.md`. Allowlists: `deny.toml`,
  `tools/check-npm-licenses.mjs`.
- Every source file starts with `SPDX-License-Identifier: AGPL-3.0-or-later` (comment syntax of
  the language).
- Paths from the UI: reject `..`, absolute paths and symlink escapes (`maatwerk-core::paths`).
- Heavy work (Typst, merge, directory walks) via `spawn_blocking`, never on the async runtime.
- Bugs: failing test first. Reference ambiguities: record in `docs/reference/quirks.md`, do not
  silently change behaviour.
- Stop and ask the user: STOP gates, buggy reference that would change output/data, data-format
  changes, non-permissive licences, deviating from ADR-0002, anything hard to undo.

## Glossary

leerling = student; toets = exam; opdracht = remedial assignment (Typst); opgave = exercise in an
opdracht; vraag = question in an opgave; observatie = reusable observation; leeradvies = study
advice; groep = class; vak (`nat`, `bio`, `schk`, `wi`) = subject; jaarlaag = year level;
schoolsoort = school type; herkansing / inhaal = resit / make-up; cijfer = grade; n-term =
normalisation term; rapport = per-student report; sectie = department; gebruiker = teacher account;
school = school settings.
