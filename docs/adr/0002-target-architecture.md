# ADR-0002: Target architecture

Status: **proposed** (Step 1, 2026-10-25). Awaiting the user's approval.

Context: PLAN.md section 4 proposed the layout; Step 1 studied the reference
(`docs/architecture-review.md`, `docs/reference/*`). This ADR confirms section 4 and makes it
precise where the study found gaps. Deviating from it later needs the user's OK (PLAN 2.6).

## Decision

### 1. Layout (unchanged from PLAN section 4)

```
crates/maatwerk-core/   pure Rust, never depends on tauri
  paths      DataDir, RelPath (validated), year/entity path builders
  storage    read (missing vs corrupt), atomic write + retry, CAS by content hash, locks?, JSON I/O
  watcher    notify + 20 s poll of the active year, debounce, own-write suppression
  model      serde types only where Rust needs fields (_meta, config, ...)
  migrate    v1 -> v2, backup, validate-data (Step 7)
  typst_svc  World, compile (pdf/svg), batch, diagnostics, live sessions (Step 8)
  pdf_merge  merge + duplex padding
  assets     embedded templates, lib.typ, Typst packages, fonts
crates/maatwerk-cli/    validate-data, migrate, assignment check/render
src-tauri/              commands -> core, events, window; no business logic
ui/                     Vite; src/{bridge,domain,screens,modals,components,utils}
tests/ tools/ docs/
```

Layering rule `ui -> bridge -> Tauri -> commands -> maatwerk-core` holds. CI already checks that
core has no `tauri` dependency.

### 2. Bridge and errors

- **Commands mirror the reference bridge** for parity: of the 32 handlers, 29 have a call site and
  one of those (`renderAssignmentPdf`) is only reachable through a dead proxy branch, so 28 are
  ported; `listScoreFiles`, `typstVersion`, `compileTypst` and `renderAssignmentPdf` are dropped
  (`ipc-api.md`). Path-based JSON storage stays (PLAN section 4) but every path goes through
  `paths::RelPath`, confined to the data folder.
- **One error type in Rust:** `thiserror` enums in core, serialised as
  `{ code, message, details }` (`code` is a stable string such as `conflict`, `locked`,
  `not_found`, `corrupt_json`, `invalid_path`, `io`, `typst`). The UI maps `code` to Dutch text.
- **Compat layer in `ui/src/bridge`:** reproduces the 4 old result shapes (`{ok,reason}`,
  `{ok,error}`, `{success,error}`, `null`/throw) per method, so screens run unchanged until they
  are migrated. Each method's old shape is pinned by a contract test.
- **Generated bindings: `tauri-specta`** (MIT), pinned to an exact version. It generates both the
  argument/result types and the command wrappers, so a renamed command fails `npm run typecheck`.
  CI fails on stale bindings. Fallback if it blocks us: `ts-rs` for types plus a hand-written
  `invoke` table checked by a test. (`tauri-specta` is still `2.0.0-rc.*`; acceptable because it
  is build-time only and pinned.)
- **Events:** `data:changed` (path, kind, `_meta`, own-write flag) and `assignment:progress`, as in
  the reference; typed by the same generator.

### 3. Storage

- Same semantics as the reference (`data-files.md`): atomic write via temp file + rename, retry on
  `EPERM`/`EBUSY`/`EACCES` with backoff (30-150 ms, 5 attempts), then the reference's direct-write
  fallback; CAS on SHA-1 of the file bytes; `_meta.rev` check where the reference does it; JSON
  written as `JSON.stringify(x, null, 2)` equivalent (2-space indent, no trailing newline) so files
  stay byte-identical for unchanged content.
- The temp file for the atomic write lives next to the target (needed for an atomic rename on the
  same volume). This is the only file the app writes besides real data. "No temp files" (PLAN 4)
  applies to Typst wrappers, outputs and previews.
- Reads distinguish **missing** from **corrupt** (the reference returns `null` for both, D2); the
  compat layer maps both back to `null` for old callers.
- `.lock` files: implemented exactly as the reference during the port, but with exclusive create;
  whether they stay in v2 is ADR-0003 candidate C3.
- All filesystem work runs in `spawn_blocking`; the reference blocks its main process with
  `Atomics.wait` during retries.
- `config.json`, `school.json`, RTTI templates stay blind writes during the port (parity); ADR-0003
  C6 proposes CAS for them.

### 4. Watcher

`notify` (MIT/Apache) plus a 20 s poll of the active year (OneDrive swallows events), 500 ms
debounce, 100 ms batching, `.json`/`.typ` only, same ignore list as the reference (`fotos`, `bak`,
`templates`, `temp`, `_preview_*`). Own writes are suppressed by remembering the hash written. An
unparsable JSON file is retried once after ~1 s (still syncing). Emits `data:changed`.

### 5. Typst service

- **`typst` crates 0.14.x** behind a `World` implementation in `typst_svc`. Compiles run in
  `spawn_blocking`; batch jobs in parallel (the reference runs 2-4), output order = job order.
- **Virtual file system** (nothing written to disk):
  - `/temp/rtti_export.typ` -> embedded `rapport.typ` (renamed per the naming map; path kept
    virtual for parity of relative imports).
  - `/data/opdrachten/lib.typ` -> embedded `lib.typ`, regardless of what is on disk (ADR-0003 C4
    decides whether the disk copy is still written for the old app; not needed after cutover).
  - `/data/...` -> files in the data folder via the path guard (teacher opdracht files, images,
    `fotos/school-watermerk.svg`).
  - Wrappers (`_rapport_run.typ`, opdracht wrappers, `_preview_*`) are generated in memory.
- **Data in:** the reference generates Typst source (`toTypst`). The port passes data as a virtual
  JSON file (`/__maatwerk/data.json`, read with `json(...)`) and keeps a thin Typst wrapper that
  binds the same variable names. This removes the escaping holes (T5, T6). Where the two encodings
  differ (`{}` vs `()`, int vs float), Step 5 goldens decide; any visible diff goes to the user.
- **Packages:** embedded `@preview/zero:0.7.1`, `@preview/cetz:0.3.4`, `@preview/oxifmt:0.2.1`,
  `@preview/unify:0.8.0` (licences: MIT, LGPL-3.0-or-later, MIT-0, MIT). No downloads; an unknown
  package is a compile error with a clear message.
- **Fonts:** embedded Source Serif 4, STIX Two Math, Typst's default assets (Libertinus etc.).
  Emoji: open decision 2 (system Segoe UI Emoji on Windows vs a bundled OFL/CC-BY colour emoji
  font). The service warns when a glyph falls back to tofu, since the reference silently does not.
- **Diagnostics:** structured (`severity`, message, file, span, hints) instead of raw stderr; the
  compat layer can still produce the old text for unmigrated screens. Warnings are kept, not
  dropped.
- **Limits:** a compile timeout and cancellation for live preview (Step 8).
- **PDF merge:** `lopdf` (MIT) in `pdf_merge`: job order, grouping by `key`, odd-page padding per
  key with a blank page the size of the previous page; answer keys without padding (as the
  reference).

### 6. UI

- Vite build, ES modules instead of classic scripts; all third-party code vendored via npm and
  pinned (Chart.js, annotation plugin, CodeMirror, Lezer, pdf.js). No remote origins.
- `window.rtti` -> `window.maatwerk` in one mechanical codemod commit (Step 3a); naming map kept.
- Pure domain functions are lifted out of the `Store` IIFE into `ui/src/domain` with Vitest
  tests (Step 3a). Duplicated copies are **not** merged during the port; each screen keeps the copy
  it uses until goldens exist for all of them (Step 10 decides consolidation).
- Score grid: Handsontable is replaced in Step 3b (licence blocker). Preferred: own grid on a
  plain `<table>`; MIT grids as fallback (`architecture-review.md` 4.1).
- Editor iframe kept for parity until Step 8, with a method allowlist in the parent proxy and
  origin checks in both directions.
- TypeScript introduced per module as files are touched; `checkJs` off for untouched legacy files.

### 7. Security

- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost; object-src 'none';
base-uri 'self'; frame-ancestors 'none'` (plus `worker-src` for pdf.js). `style-src-attr` is
  pending the user's answer (architecture review, question 4).
- Tauri capabilities: only `core:default` plus the plugins actually used (dialog, opener). No `fs`
  plugin: the UI never touches the filesystem except through Maatwerk commands.
- Opening files/folders (`shell:openPath`) takes a data-relative path or a known output ID.

### 8. Logging and local state

- `tracing` with a rolling file appender in the OS app-data dir
  (`%APPDATA%\nl.openbetaonderwijs.maatwerk\logs`), never in the shared data folder. No student
  names in logs.
- Machine-local session state (the reference's `%APPDATA%\rtti-app\session.json`) moves to the
  app-config dir of the new identifier; not migrated (cutover starts fresh).

## Consequences

- Step 2 characterises the reference against these seams (bridge contract per method, storage
  semantics, Typst outputs).
- New crates/licences to add later: `notify`, `lopdf`, `typst*`, `tracing*`, `thiserror`,
  `tauri-specta`/`specta`, `sha1`/`sha2`; all MIT/Apache. Each goes through `cargo deny`.
- The compat layer is temporary code; it is deleted screen by screen after parity (Step 10).

## Alternatives considered

- **Typed per-entity commands from day one** instead of the path-based JSON API: safer and
  clearer, but rewrites every Store call during the port and loses 1:1 parity. Rejected for now;
  "change later".
- **Keep generating Typst source** (`toTypst` port): exact parity for free, but keeps the escaping
  holes. Rejected in favour of a JSON data file checked by goldens.
- **Keep the Typst CLI as a sidecar binary:** contradicts ADR-0001 (crate as library) and needs
  temp files. Rejected.
- **Move domain logic to Rust now:** single source of truth, but changes two things at once.
  Rejected; Step 10 decides with measurements (open decision 4).
