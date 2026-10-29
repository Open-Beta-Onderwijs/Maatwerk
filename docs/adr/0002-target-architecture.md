# ADR-0002: Target architecture

Status: **accepted with amendments** (user, 2026-10-25). Proposed in Step 1; the user approved
it with one change (section 5: opdracht folders become self-contained Typst projects) and answered
the open points (sections 7, 9, 10). The answers are listed in `docs/architecture-review.md`
section 8.

Context: PLAN.md section 4 proposed the layout; Step 1 studied the reference
(`docs/architecture-review.md`, `docs/reference/*`). This ADR confirms section 4 and makes it
precise where the study found gaps. Deviating from it later needs the user's OK (PLAN 2.6).

## Decision

### 1. Layout (unchanged from PLAN section 4)

```
crates/maatwerk-core/   pure Rust, never depends on tauri
  paths      DataDir, RelPath (validated), year/entity path builders
  storage    read (missing vs corrupt), atomic write + retry, CAS by content hash, JSON I/O
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
  is pinned; the generated wrappers and `tauri-specta`'s invoke handler ship in the app, so
  upgrades are deliberate, see ADR-0005.)
- **Events:** `data:changed` (path, kind, `_meta`; own writes are suppressed, not flagged, section 4) and `assignment:progress`, as in
  the reference; typed by the same generator.

### 3. Storage

- Same semantics as the reference (`data-files.md`): atomic write via temp file + rename, retry on
  `EPERM`/`EBUSY`/`EACCES` with backoff (30-150 ms, 5 retries), then the reference's direct-write
  fallback; CAS on SHA-1 of the file bytes; `_meta.rev` check where the reference does it; JSON
  written like `JSON.stringify(x, null, 2)` (2-space indent, no trailing newline, insertion order).
  The JSON values come from the UI, so formatting matches for normal data; number formatting can
  differ between JS and `serde_json` for edge cases (exponents, `-0`, long fractions). Step 4
  tests pin the cases that occur in real data.
- The temp file for the atomic write lives next to the target (needed for an atomic rename on the
  same volume). This is the only file the app writes besides real data. "No temp files" (PLAN 4)
  applies to Typst wrappers, outputs and previews.
- Reads distinguish **missing** from **corrupt** (the reference returns `null` for both, D2); the
  compat layer maps both back to `null` for old callers.
- **No `.lock` files** (ADR-0003 C3, decided): CAS on the content hash plus `_meta.rev` is the
  concurrency mechanism. Step 4 concurrency tests must show that this loses no update the locks
  would have prevented; if they do not, stop and ask. The Step 7 migration deletes leftover
  `.lock` files.
- All filesystem work runs in `spawn_blocking`; the reference blocks its main process with
  `Atomics.wait` during retries.
- `config.json`, `school.json` and the RTTI template files use CAS like every other file
  (ADR-0003 C6, done during the port). The active year is per teacher (C7): `config.json` keeps
  only the folder default.

### 4. Watcher

`notify` (MIT/Apache) plus a 20 s poll of the active year (OneDrive swallows events), 500 ms
debounce, 100 ms batching, `.json`/`.typ` only, same ignore list as the reference (`fotos`, `bak`,
`templates`, `temp`, `_preview_*`) plus the new `rapporten/` folder (section 9). Own writes are suppressed by remembering the hash written. An
unparsable JSON file is retried once after ~1 s (still syncing). Emits `data:changed` only for
external changes, as the reference does (own writes are suppressed, not flagged).

### 5. Typst service

- **`typst` crates 0.14.x** behind a `World` implementation in `typst_svc`. Compiles run in
  `spawn_blocking`; batch jobs in parallel (the reference runs 2-4), output order = job order.
- **Two kinds of compile, each with its own sandboxed World** (nothing written to disk):
  1. **Rapport:** `/__maatwerk/rapport.typ` (embedded report template, `rtti_export.typ` in the
     reference, renamed per the naming map), its data as a virtual JSON file
     (`/__maatwerk/data.json`, read with `json(...)`), and `/data/fotos/**` (logo, watermark)
     through the path guard. Nothing else is readable.
  2. **Opdracht:** the World's root is **one opdracht project folder** (section 5a). Only files
     in that folder are readable, plus the embedded packages and fonts. An opdracht cannot read
     another opdracht, student data or anything else in the data folder.
- **Data in (decided):** JSON instead of generated Typst source (`toTypst`). This removes the
  escaping holes (T5, T6). Where the two encodings differ (`{}` vs `()`, int vs float), Step 5
  goldens decide; any visible diff goes to the user.

### 5a. Opdracht folders are self-contained Typst projects (user's amendment)

The reference keeps all opdrachten in one folder: `opdrachten/<id>.json`, `opdrachten/<id>.typ`,
images in `opdrachten/images/<id>/`, one shared `opdrachten/lib.typ` that the app overwrites, and a
wrapper generated in `main.js` (page setup, header, student/answer mode) that teachers never see.
New opdracht files start as a copy of `base_assignment.typ`.

**v2 layout** (one folder per opdracht, ADR-0003 C14):

```
opdrachten/<id>/
  opdracht.json   metadata (title, vak, jaarlagen, coupling to observaties, _meta)
  main.typ        entry point: the former generated wrapper (page setup, header, modes)
  opdracht.typ    the teacher's content (setup_extra, render_uitleg, render_opgaven)
  lib.typ         the opdracht's own copy of lib.typ
  images/         figures, referenced as image("images/x.png")
```

- **`main.typ` and `lib.typ` are editable** by the teacher in the editor, with a clear warning
  ("Dit bestand bepaalt de opmaak van de opdracht ...") and a **"Herstel standaardversie"** button
  that restores the bundled version (with confirmation; the old file goes to the undo history).
- **Runtime data** (student header, mode student/antwoorden, cursor marker for the editor) is passed
  as JSON through `sys.inputs` (`maatwerk-data`). `main.typ` falls back to a placeholder header and
  student mode when it is missing, so `typst compile main.typ` works inside the folder with the
  plain Typst CLI.
- **lib.typ / main.typ updates:** the bundled files carry a version line
  (`// maatwerk-lib 3`). The app keeps the hashes of every released version. A copy whose hash
  matches an older released version is unmodified and is updated silently when the app updates. A
  modified copy is never overwritten; the editor shows "Er is een nieuwere versie van lib.typ"
  with "Bekijk verschillen" and "Herstel standaardversie".
- **New opdracht:** copy `base_assignment.typ` -> `opdracht.typ`, plus `main.typ` and `lib.typ`.
  **Copying an opdracht** copies the folder; no path rewriting is needed any more (the reference
  rewrites `images/<oldId>/` in the source text).
- **Why:** the editor works on one folder; `maatwerk-cli` and a future AI session can be started
  inside one opdracht folder and see exactly that opdracht and nothing else (Step 9); teachers can
  adapt the layout per opdracht.
- **Order of work:** Step 5 builds the Typst service around a project abstraction
  (`TypstProject` = root folder + entry file + inputs). For parity tests against the v1 goldens, a
  v1 opdracht is presented as a virtual project (bundled `main.typ`/`lib.typ`, `images/<id>/`
  mapped to `images/`). Step 7 migrates the folders on disk (moving files, rewriting
  `images/<id>/` to `images/` in the source). Step 8 builds the editor on the project folder
  (file list, warnings, reset).
- **Risk:** teachers who edit `lib.typ` can break their opdracht; mitigated by the warning, reset,
  the diff view and the compile check before saving. Batch compiles of many opdrachten no longer
  share one `lib.typ`; each folder is compiled on its own anyway (the reference already compiles
  every job separately).
- **Packages:** embedded `@preview/zero:0.7.1`, `@preview/cetz:0.3.4`, `@preview/oxifmt:0.2.1`,
  `@preview/unify:0.8.0` (licences: MIT, LGPL-3.0-or-later, MIT-0, MIT). No downloads; an unknown
  package is a compile error with a clear message.
- **Fonts:** embedded Source Serif 4, STIX Two Math, Typst's default assets (Libertinus etc.).
  Emoji: open decision 2, decided 2026-10-28: a bundled Noto Color Emoji (OFL-1.1), which wins
  over system emoji fonts (quirk T2). The service warns when a glyph falls back to tofu, since the
  reference silently does not.
- **Diagnostics:** structured (`severity`, message, file, span, hints) instead of raw stderr; the
  compat layer can still produce the old text for unmigrated screens. Warnings are kept, not
  dropped.
- **Limits:** a compile timeout and cancellation for live preview (Step 8). Batch memory: a class
  batch (~30 students) holds every compiled document until the merge; Step 5 measures it and caps
  parallelism if needed (`docs/perf.md`).
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

- CSP (decided): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:
blob:; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'self';
frame-ancestors 'none'` (plus `worker-src` for pdf.js). **Amended in Step 3a (confirmed by the user, 2026-10-27):** `frame-ancestors 'self'`, because the app frames its own `editor.html` and `pdf-viewer.html`; also `font-src`, `worker-src`, `frame-src 'self'`; source of truth `ui/vite/csp.ts`. **No inline styles:** the ~262 inline
  `style=` attributes of the reference move into CSS classes during Step 3, and the inconsistent
  styling is cleaned up while doing so. **Deviation (Step 3a, confirmed by the user, 2026-10-27):** the move
  is pixel-identical (`u-*` utilities with `!important`, a few component classes; checked with
  `npm run test:visual`); the cleanup itself, which changes the look, moves to Step 10
  (`docs/backlog.md`). Styles set from JS through the CSSOM (`el.style.x = ...`,
  as Chart.js and the grid do) are not affected by the CSP and stay allowed for dynamic values.
- Tauri capabilities: only `core:default` plus the plugins actually used (dialog, opener, and
  clipboard for the reference's image paste, Step 3/8). No `fs` plugin: the UI never touches the
  filesystem except through Maatwerk commands.
- Opening files/folders (`shell:openPath`) takes a data-relative path or a known output ID.
- **Implemented (Step 6a):** the dialog, clipboard-manager and opener plugins are called from
  Rust only (image picker, clipboard image, opening PDFs), so `capabilities/default.json` still
  grants just `core:default`. A picked image's absolute path stays in Rust behind a token.
  `write_text_file` only writes `opdrachten/<name>.typ` (not `lib.typ`) and `save_photo` only
  `fotos/<name>` with an image extension. `open_path` opens only render outputs and printed copies
  in `rapporten/<schooljaar>/` (review 6a M1). Render outputs live in a per-process folder
  `output/<pid>/`; other runs' folders are removed after a day (review 6a m1).

### 8. Logging and local state

- `tracing` with a rolling file appender in the OS app-data dir
  (Tauri `app_log_dir`, on Windows `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\logs`), never in the shared data folder. No student
  names in logs.
- Machine-local session state (the reference's `%APPDATA%\rtti-app\session.json`) moves to the
  app-config dir of the new identifier; not migrated (cutover starts fresh).
- **Implemented (Step 6a):** daily files `maatwerk.<date>.log` (14 kept) plus stderr, level INFO.

### 9. Output files (PDFs)

- The reference writes every PDF to `temp/` next to the exe, loads it in the viewer by
  `file:///` URL and opens it with the OS for printing (`main.js:909-911`,
  `modals/rapport.js:310-318`).
- Decided (user, 2026-10-25): compiled PDFs are kept in the **OS cache dir**
  (`%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\output`, outside OneDrive) under an output ID,
  cleared at start. The viewer loads them through a custom Tauri URI scheme
  (`maatwerk-out://<id>`), so large batch PDFs never cross IPC as JSON.
- **Printing** ("Afdrukken") first makes a **timestamped copy with a descriptive name** in a new
  shared folder `rapporten/` in the data folder, then opens that copy with the opener plugin:

  ```
  rapporten/<schooljaar>/<YYYY-MM-DD HHmm> <soort> <vak> <groep> <toets>.pdf
  e.g. rapporten/2025-2026/2026-10-25 1432 Rapport nat 3a Voorbeeldtoets 1.pdf
       rapporten/2025-2026/2026-10-25 1440 Opdrachten nat 3a Voorbeeldtoets 1.pdf
  ```

  Name parts go through the same cleaning as image names (no path separators, Windows-reserved
  characters or names; max length), and a name clash gets a ` (2)` suffix. The folder is written
  atomically, never read back by the app and ignored by the watcher. It contains student data, like
  the rest of the data folder. Retention/cleanup: not automatic; backlog item.

- "Opslaan als" writes to a path the teacher picks (dialog plugin).
- **Implemented (Step 6a):** output IDs are `<n>-<name>.pdf` (`outputs::OutputStore`; a new
  output replaces older ones with the same name). On Windows the webview reaches the scheme as
  `http://maatwerk-out.localhost/<id>` (`convertFileSrc`); the handler sends CORS headers for the
  app's own origins only. Printing is a new bridge method `printPdf(pdfPath, name)` (the
  reference's `openPath(pdfPath)` call sites moved to it); the `<groep>` part lists up to three
  group names, more give none (a whole jaarlaag). "Opslaan als" is not built yet (no screen asks
  for it).

### 10. Quirks fixed during the port (user, 2026-10-25)

The user chose to fix these during the port instead of keeping strict parity. Each fix starts with
a failing test (PLAN 2.5), and the golden or spec row records the old behaviour and why it changed.

| Quirk | What                                                           | Step                              |
| ----- | -------------------------------------------------------------- | --------------------------------- |
| U2    | score changes during an in-flight save are dropped             | 3b (new grid)                     |
| U4    | paste/fill into observatie columns not saved                   | 3b                                |
| U3    | save errors other than conflicts are invisible                 | 3a/3b                             |
| U9    | editor loses the last edits on close                           | 3a (port), 8 (new editor)         |
| D25   | editor proxy never answers when a call fails                   | 3a                                |
| D34   | groups CSV re-import empties existing groups                   | 3a (merge or confirm; spec first) |
| U6/U7 | unescaped teacher text corrupts data / markup                  | 3a                                |
| B22   | CSV with BOM imports nothing; no `""` escape                   | 3a (domain `csv`)                 |
| B9    | bovenbouw wiskunde reports miss the study advice (`wis*` keys) | 3a + 5a (ADR-0003 C11)            |
| D6    | blind writes on `school.json`, `config.json`, RTTI templates   | 4a (ADR-0003 C6)                  |

Other quirks stay as they are until after parity, unless the user decides otherwise.

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
- **One shared, hidden `lib.typ` and wrapper** (reference model, served from the binary): simplest
  to update, but teachers cannot adapt the layout and an opdracht is not a standalone Typst
  project. Rejected by the user in favour of section 5a.
- **Keep the Typst CLI as a sidecar binary:** contradicts ADR-0001 (crate as library) and needs
  temp files. Rejected.
- **Move domain logic to Rust now:** single source of truth, but changes two things at once.
  Rejected; Step 10 decides with measurements (open decision 4).
