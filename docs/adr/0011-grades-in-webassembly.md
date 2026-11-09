# ADR-0011: Grade logic in one Rust crate, WebAssembly for the UI

Status: accepted by the user, 2026-11-08 (step 19, question 20).

## Context

Decision 1 of `PLAN-2.md` wants one implementation of grades and statistics for the screens, the
rapport and the CLI. `PLAN-2.md` step 19 and the layering in `CLAUDE.md` assumed Tauri commands.
But the UI computes grades synchronously in about 30 places, the score grid on every edit, and the
e2e tests run on a mock backend without Rust. With commands, those calls become async and the mock
needs its own copy of the rules, so there would be two implementations.

## Decision

- New crate `maatwerk-grades`: pure Rust, no `tauri`, no I/O, no Typst.
- `maatwerk-core` re-exports it; the CLI and Rust callers use it natively.
- A thin wrapper compiles it to WebAssembly for the UI. UI and mock call the same code,
  synchronously. The TypeScript and JavaScript implementations are deleted in 19b.
- The domain logic is an exception to `ui -> bridge -> Tauri -> commands -> core`: it has no I/O, so
  it does not need the bridge. File access still goes through the bridge.

## Consequences

- The CSP gets `'wasm-unsafe-eval'` in `script-src`.
- Builds and CI need the `wasm32-unknown-unknown` target.
- The rules are tested once, in Rust. A UI test checks that the WebAssembly build gives the same
  answers.

## Rejected

- **Tauri commands, as planned:** async grid and two implementations (see Context).
- **Commands, with the grid keeping TypeScript:** the grade formula in two places, against decision 1.
