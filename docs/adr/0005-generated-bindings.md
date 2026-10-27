# ADR-0005: Generated TypeScript bindings with tauri-specta

Status: **accepted** (Step 4b, 2026-10-27). Implements ADR-0002 section 2 ("Generated bindings").

## Context

The UI calls Rust commands by name with JSON arguments. Without generated types, a renamed
command or argument, or a changed result type, only fails at runtime. ADR-0002 chose
`tauri-specta` (MIT), with `ts-rs` plus a hand-written `invoke` table as the fallback.

## Decision

- **`tauri-specta` `=2.0.0-rc.26`, `specta` `=2.0.0-rc.26`, `specta-typescript` `=0.0.13`**,
  pinned exactly (pre-release; the upstream docs require `=` pins). All MIT.
- Commands carry `#[tauri::command] #[specta::specta]`. `maatwerk_app::specta_builder()` is the
  single list of commands and events, used for both the invoke handler and the export.
- Output: `ui/src/bridge/bindings.ts` (committed; excluded from Prettier and ESLint). It contains
  `commands.*` wrappers returning `{ status: 'ok', data } | { status: 'error', error }` and
  `events.dataChanged` (event name `data:changed`, as in the reference).
- **Staleness check:** the Rust test `tests::bindings_are_up_to_date` (in `cargo test`, so in
  CI) regenerates into a temp file and compares. `npm run bindings` rewrites the file.
- Errors: every command returns `CommandError { code, message, details }`. `code` is a string
  union (`ErrorCode`), one per core `Error` variant plus `internal`. `ui/src/bridge/tauri-api.ts`
  maps it to each method's reference shape; contract tests in `tauri-api.test.ts`.
- `serde_json::Value` is exported as a recursive JSON type; its 64-bit integers are typed as
  `number` (`dangerously_cast_bigints_to_number`), which is what they are on the wire. Serde
  phases are disabled: every exported type only travels Rust -> UI.
- Core stays free of `specta`: the app crate mirrors the few core types it exports
  (`DataChange`, `CommandError`).

## Consequences

- A renamed command or argument fails `npm run typecheck`; a changed command without
  regenerated bindings fails `cargo test`.
- Windows: test binaries that link Tauri need the Common Controls v6 manifest, so
  `src-tauri/build.rs` links `windows-app-manifest.xml` into every target on MSVC instead of
  letting `tauri-build` embed it into the exe only.
- Upgrading `tauri-specta` is a deliberate change: bump all three pins together and regenerate.

## Alternatives considered

- `ts-rs` + hand-written invoke table: more code to keep in sync; kept as the fallback.
- Hand-written types only: no compile-time link between Rust and TS.
