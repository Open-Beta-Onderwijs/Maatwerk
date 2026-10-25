# ADR-0001: Decisions made before the port

Status: accepted (2026-10-25)

Decisions taken by the user before work started (PLAN.md section 1), plus the answers given in
Step 0.

| Topic          | Decision                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework      | Tauri 2: Rust backend, existing web UI in the OS webview                                                                                                  |
| Typst          | `typst` crates as a library, pinned to the 0.14.x line (reference binary is 0.14.2). No bundled Typst binary                                              |
| Platforms      | Windows first (single portable exe, `tauri build --no-bundle`). macOS later (Step 11)                                                                     |
| Rollout        | One-time cutover, planned after Step 8. Old and new app never share a data folder at the same time. Data format may change, with a migration and a backup |
| Repo & licence | Public repo, **AGPL-3.0-or-later** (answered in Step 0). Every dependency shipped in the exe must be AGPL-compatible                                      |
| UI code        | Keep the JS UI, add tests, migrate to TypeScript gradually. No framework rewrite                                                                          |
| AI assistance  | Not decided. Keep the door open (headless API, documented assignment format, sandboxed Typst world). Build no AI features now                             |
| Tests          | Start before porting (Step 2), against the old app                                                                                                        |
| Order          | Port to parity first with clean seams; refactor/optimise after parity. Exception: the Typst editor pipeline (Step 8)                                      |

## Step 0 answers (2026-10-25)

| Question                     | Answer                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Licence variant              | `AGPL-3.0-or-later`                                                            |
| Repo name                    | `maatwerk`                                                                     |
| App identifier               | `nl.openbetaonderwijs.maatwerk` (instead of the proposed `nl.school.maatwerk`) |
| Create the public remote now | No, later                                                                      |

## Tauri 2, not 3 (2026-10-25)

The user asked whether to start on Tauri 3. Decided: stay on Tauri 2.x. Tauri 3 is alpha
(`3.0.0-alpha.5`, plugins alpha, needs Rust 1.95) and `tauri-specta` has no Tauri 3 support. The
thin `src-tauri` layer keeps a later upgrade small; tracked in `docs/backlog.md`.

## Bootstrap choices (implementer, revisit in Step 1 if needed)

- Tauri `2.12.x` (crates.io also has 3.0 alphas; the plan says Tauri 2). Rust pinned in
  `rust-toolchain.toml` (1.93.1), edition 2024.
- npm workspaces: root `package.json` holds the Tauri CLI and Prettier; `ui/` holds the frontend.
- TypeScript 5.9 rather than 7.x: typescript-eslint support for the native compiler is not assumed.
- The `src-tauri` package is `maatwerk-app` with binary `maatwerk`, so the exe is `maatwerk.exe`.
