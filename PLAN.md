# Maatwerk: port from Electron to Rust + Tauri

> Instruction file for Claude Code. At the start of **every session** read sections 1-3 and `docs/STATE.md`, then only the section of the current step. Do not read the whole file again.

---

## 1. Context and decisions

**What this is.** Maatwerk is a desktop app for teachers at a Dutch secondary school (Dutch UI) to enter exam scores and analyse them with the RTTI framework (Reproductie / Toepassen 1 / Toepassen 2 / Inzicht). It produces per-student PDF reports and remedial assignments (opdrachten) written in Typst. Multiple teachers share one `data/` folder (JSON files) through OneDrive.

**Reference implementation (read-only):** https://github.com/Liveshort/RTTI_analyse_feedback
Electron app, v0.1.4 when this plan was written. About 16.6k lines of JS: ~1.4k main process (`main.js` 997, `sync.js` 270, `preload.js`), ~15.2k renderer. It spawns a bundled Typst CLI (0.14.2), merges PDFs with pdf-lib, and has 32 IPC handlers (29 bridge methods used by the UI). It has **no tests**. The reference is the spec: where it is ambiguous, record the quirk (`docs/reference/quirks.md`) instead of silently changing behaviour.

### Decisions already made by the user

| Topic | Decision |
|---|---|
| Framework | **Tauri 2**: Rust backend, existing web UI in the OS webview |
| Typst | Use the **`typst` crates as a library** (pin the 0.14.x line to match the reference binary 0.14.2). No bundled Typst binary |
| Platforms | **Windows first** (single portable exe, `tauri build --no-bundle`). **macOS later** (Step 11) |
| Rollout | **One-time cutover, planned after Step 8.** Old and new app never share a data folder at the same time. Data format *may* change, with a migration and a backup |
| Repo & licence | **Public repo, AGPL-3.0** (ask whether `-only` or `-or-later`). Every dependency shipped in the exe must be AGPL-compatible (see 2.5, Step 3b) |
| UI code | **Keep the JS UI**, add tests, migrate to **TypeScript gradually**. No framework rewrite |
| AI assistance | **Not decided.** Keep the door open (headless API, documented assignment format, sandboxed Typst world). Build **no** AI features now |
| Tests | Start **before** porting (Step 2), against the old app |
| Order | Port to parity first with clean seams. Refactor/optimise after parity. **Exception:** the Typst editor pipeline (Step 8), which is the main reason for using the crate |

### Why port first, then optimise

- Without tests, changing behaviour and technology at once makes every bug ambiguous ("port bug or new bug?").
- The things that are cheap now and expensive later **are** done during the port: crate layering, typed bridge, vendored dependencies (no CDN), embedded templates, no temp files, schema version, typed errors.
- Internal UI refactors (the 1,000+ line files) wait until parity, because by then the tests exist.

---

## 2. Working rules

### 2.1 Session protocol (usage limits are real: sessions can end abruptly)

1. **Start:** read this file (sections 1-3), `docs/STATE.md`, the current step. Run `git status`. Run the test suite to know the baseline.
2. Work in **small sub-tasks**. Each ends with a commit on the step branch (`step/NN-slug`) in which the tree builds and tests pass. WIP commits are fine on the step branch, never on `main`.
3. After every sub-task, and at least every ~45 minutes: update `docs/STATE.md` (done, in progress, **next action**, open questions, commands to resume).
4. If the user says to stop, or you are told usage is nearly exhausted: stop starting new work, make the tree compile, commit, update `STATE.md`. Nothing may live only in your context.
5. **End of step:** run the gate (2.2) and the review (2.3), then **stop and report**. Do not start the next step until the user says so.
6. Keep your context small: use subagents for broad reading of `_reference/`, read file ranges instead of whole large files, never paste big outputs.
7. When a step is marked **L**, it is split into sub-steps (a, b). Each sub-step ends at a safe checkpoint (tag `step-NNa`) so the session can end there.

### 2.2 Gate: a step is done only when

- `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and (once `ui/` exists) `npm run lint`, `npm run typecheck`, `npm test` all pass locally and in CI.
- New behaviour has tests. Ported behaviour has a test that traces back to a golden/spec row (`docs/parity.md`, from Step 3 onward).
- Review done and findings triaged (2.3).
- `docs/STATE.md`, `docs/parity.md` and the ADRs in `docs/adr/` are updated.
- Branch merged into `main`, tagged `step-NN`.
- Report to the user: what is done, deviations from this plan, decisions needed, **how to try it** (exact commands), next step.

### 2.3 Review protocol (at the end of every step; mid-step for L steps)

1. Spawn a **reviewer subagent with fresh context**. Give it: the step goal, the diff since the last tag, the relevant plan section, and paths into `_reference/`. Tell it not to trust the implementer's summary. Use the checklist in Appendix C.
2. The reviewer writes `docs/reviews/step-NN.md`: findings with severity (blocker / major / minor / nit), `file:line`, evidence, suggested fix.
3. Triage: fix **all blockers and majors now**; minors are fixed if cheap, otherwise added to `docs/backlog.md`; reject only with a written reason. Re-run the gate. Have blockers re-checked.
4. Also run the built-in `/security-review` (if available) after Steps 4, 5, 6 and 10.
5. At Steps 6 and 10 do an **architecture drift check**: compare the code with ADR-0002 and note deviations.

### 2.4 Git

- New repo in the current (clean) folder. `main` is always green. One branch per step, merge with a merge commit, tag `step-NN`.
- Conventional commit messages. A golden/fixture update needs one line in the commit message saying why.
- Never commit: `_reference/`, `data/`, `target/`, `node_modules/`, real student data, API keys.

### 2.5 Hard rules

- **No real student data anywhere in the repo or in tests.** All fixtures are synthetic and generated by `tools/fixtures` (deterministic seed). The user tests manually on a *copy* of real data, outside the repo.
- UI text stays **Dutch**. Decimal separator in the UI is a **comma** (`1,5`). Code, comments, docs and commit messages are English. Domain words stay Dutch in data and identifiers where the reference uses them (see glossary, Appendix A).
- `_reference/` is read-only. Never edit it.
- **Naming:** the product and core name is **Maatwerk**. "RTTI" is only the name of the educational framework: it stays in domain code (RTTI tags, RTTI analysis, charts) and in the reference repo's name. New identifiers never use `rtti` as a prefix: crates `maatwerk-core` / `maatwerk-cli`, bridge `window.maatwerk` (mechanical codemod commit in Step 3a), report template `rapport.typ`, Typst markers `<__maatwerk_vraag>` / `<__maatwerk_cursor>` (renamed when embedding in Step 5a), app identifier `nl.school.maatwerk` (confirm in Step 0). Keep `docs/reference/naming-map.md` (old name -> new name) so goldens and parity rows stay traceable. Teacher-authored assignment files keep working unchanged: their `#import "lib.typ": ...` is not renamed.
- **Licences:** only add dependencies, fonts and vendored Typst packages with permissive or AGPL-compatible licences (MIT, Apache-2.0, BSD, OFL, LGPL, GPL/AGPL). Never add proprietary or "non-commercial" licensed code. Keep `THIRD_PARTY_LICENSES.md` up to date; CI runs `cargo deny` (Rust) and an npm licence check with an allowlist.
- Every command that takes a relative path must reject `..`, absolute paths and symlink escapes (shared helper in `maatwerk-core::paths`).
- No blocking work on the async runtime or UI thread: heavy work (Typst, merge, directory walks) runs via `spawn_blocking`.
- When you find a bug, write the failing test first.

### 2.6 Stop and ask the user when

- A step says "STOP for approval".
- The reference looks buggy and fixing it would change output or data.
- You want to change the data format, add a dependency with a non-permissive licence, or deviate from ADR-0002.
- Something would be hard to undo (history rewrite, deleting data, publishing a repo).

---

## 3. Status (keep up to date)

| Step | Title | Size | Status |
|---|---|---|---|
| 0 | Bootstrap | S | done (`step-00`) |
| 1 | Reference study + architecture review (**approval gate**) | M | done (`step-01`) |
| 2 | Safety net: golden tests on the old app | L (2a, 2b) | done (`step-02`) |
| 3 | UI foundation: Vite, bridge, domain extraction (3a); score-grid replacement (3b) | L (3a, 3b) | done (`step-03`) |
| 4 | Rust core: paths, storage, watcher | L (4a, 4b) | done (`step-04`) |
| 5 | Typst service (parity with the old output) | L (5a, 5b) | done (`step-05`) |
| 6 | Tauri wiring + parity + portable build | L (6a, 6b) | todo |
| 7 | Data format v2, migration, cutover runbook | M | todo |
| 8 | New editor and assignment pipeline on the crate | L (8a, 8b) | todo |
| 9 | AI-ready seams (design + CLI, no AI) | S | todo |
| 10 | Hardening, refactor, maintainability | L | todo |
| 11 | macOS | M | todo (when needed) |

Sizes: **S** < half a session, **M** about one session (5 h), **L** about two sessions. These are estimates; split earlier rather than later.

From Step 6 onward every step leaves a *release candidate*. The cutover is planned after Step 8 and only happens when the user says so.

---

## 4. Target architecture (proposal; Step 1 confirms or revises it in ADR-0002)

```
maatwerk/                      new repo
├─ Cargo.toml                  workspace
├─ crates/
│  ├─ maatwerk-core/           pure Rust, NO tauri dependency
│  │   ├─ paths                DataDir, traversal-proof relative paths
│  │   ├─ storage              atomic write, hash CAS, locks, JSON I/O
│  │   ├─ watcher              notify + poll, own-write suppression
│  │   ├─ model                serde types where Rust needs fields (_meta, config, ...)
│  │   ├─ migrate              v1 -> v2, backup, validate-data
│  │   ├─ typst_svc            World, compile (pdf/svg), live sessions, diagnostics
│  │   ├─ pdf_merge            merge + duplex blank-page padding
│  │   └─ assets               embedded templates, lib.typ, vendored typst packages, fonts
│  └─ maatwerk-cli/            headless: validate-data, migrate, assignment check/render
├─ src-tauri/                  thin: commands -> maatwerk-core, events, plugins, window
├─ ui/                         Vite; src/{bridge,domain,screens,modals,components,utils}
├─ tests/                      golden/, e2e/
├─ tools/                      fixtures generator, golden generator, reference shims
├─ docs/                       STATE.md, parity.md, adr/, reviews/, reference/, specs/
└─ _reference/                 gitignored clone of the Electron repo
```

**Layering rules**
- `ui -> bridge -> (Tauri) -> commands -> maatwerk-core`. `maatwerk-core` never imports `tauri`.
- Command handlers parse arguments, call core, map errors. No business logic in them.
- Errors: `thiserror` enums in core, serialised to the UI as `{ code, message, details }`. The UI maps `code` to a Dutch message. The bridge keeps the old `{ ok:false, reason }` contract until the screens are migrated.
- Bridge types are **generated** from Rust (tauri-specta or ts-rs; record the choice in an ADR). CI fails when generated bindings are stale.
- Storage stays JSON-value based (path-based API like the old bridge). Typed Rust structs only where Rust needs the fields. JSON Schemas (`docs/schemas/`) describe the rest and drive `validate-data`.
- Domain logic (grades, RTTI results, best attempts, assignment coupling) stays in `ui/src/domain` for now as pure, tested functions. Step 10 decides whether it should move to Rust (single source of truth for reports, CLI, future AI). Do not move it during the port.
- Logging: `tracing` with a file appender in the OS app-data dir, **not** in the shared data folder.
- No temp files in the app or data folder. All intermediate data is in memory.

---

## 5. Testing strategy

### When to start: Step 2, before any porting

- The old app is the only spec, and it can still be run. Tests written now turn the port from "rewrite and hope" into "make red tests green".
- The pure logic (grades, RTTI, best attempt, coupling, CSV) is the cheapest and highest-value thing to test.
- Storage and sync is where silent data loss happens, so its behaviour is written down as an executable spec before it is re-implemented.
- The Typst output is the visible product; golden PDFs/PNGs from the old app define "correct".

### Layers

| Layer | Tooling | Introduced | Covers |
|---|---|---|---|
| Golden / characterization of the **old** app | Node scripts + Vitest, reference Typst CLI | Step 2 | logic, CSV, storage/sync semantics, Typst output |
| Rust unit + integration | `cargo test`, `tempfile`, `proptest` | Steps 4-5, test-first against Step 2 specs | paths, storage, watcher, typst, merge, migrate |
| Concurrency | threads on one temp dir simulating two instances, injected rename failures (EPERM/EBUSY) | Step 4 | CAS races, locks, partial writes |
| Typst parity | page count, extracted text per page, PNG pixel diff with tolerance (`typst-render` vs CLI PNG goldens) | Step 5 | reports, assignments, SVG, batch + duplex |
| UI unit | Vitest on `ui/src/domain`, `utils` | Step 3 | grade/RTTI logic |
| UI smoke | Playwright against Vite + `MockApi` | Step 3, grows | boot, tabs, create exam, score grid, modals |
| Bridge contract | generated types + stale-bindings CI check | Step 4 on | UI/Rust API drift |
| Migration | v1 fixtures -> v2 expected, idempotence, backup restores | Step 7 | cutover safety |
| Real-app E2E | tauri-driver / WebDriver on Windows CI, 2-3 flows | Step 10 (optional) | startup, save, render |
| Performance | large synthetic dataset, batch of 200 PDFs | Step 10 | budgets in `docs/perf.md` |

**Rules**
- Every bug gets a regression test first.
- Goldens change only with a justification in the commit message.
- Tests are deterministic: fixed seeds, fixed clock (`today()` injected), no network.
- `docs/testing.md` keeps a **coverage matrix**: reference behaviour -> test(s). The reviewer checks it.

---

## 6. Steps

### Step 0: Bootstrap (S)

**Goal:** an empty but real project that builds a Windows exe in CI.

- `git init`. Clone the reference: `git clone https://github.com/Liveshort/RTTI_analyse_feedback _reference`. Record commit hash and app version in `docs/reference/VERSION.md`. If the clone is newer than v0.1.4, note what changed (roadmap items such as PO's or graph export may exist).
- Check the toolchain (rustup stable + MSVC build tools on Windows, Node LTS, Tauri 2 prerequisites, WebView2). Record in `docs/dev-setup.md`. If something is missing and cannot be installed, stop and tell the user.
- Create: `CLAUDE.md` (under ~150 lines: rules from section 2, commands, layering, glossary), `docs/STATE.md` (Appendix B), `docs/adr/0001-decisions.md` (the table in section 1), `.gitignore`, rustfmt/clippy/Prettier/ESLint/editorconfig.
- Cargo workspace with the layout from section 4 (empty crates), a Tauri 2 + Vite hello-world with **one** command round trip.
- GitHub Actions workflow: fmt, clippy, test, build `tauri build --no-bundle` on `windows-latest`, upload the exe as an artifact.
- Add `LICENSE` (AGPL-3.0; ask the user: `-only` or `-or-later`), SPDX header convention, `THIRD_PARTY_LICENSES.md`, and a `cargo deny` config with a licence allowlist in CI.
- Ask the user: repo name (proposed: `maatwerk`), app identifier (proposed `nl.school.maatwerk`) and whether to create the (public) remote now.

**Gate:** the hello-world exe runs on Windows. CI green (if a remote exists).

---

### Step 1: Reference study and architecture review (M)  **STOP FOR APPROVAL**

**Goal:** understand the old app completely and decide the architecture before writing production code. Read-only on `_reference/`. Use subagents to read in parallel.

Write to `docs/reference/`:
- `ipc-api.md`: all 32 IPC handlers and preload methods: arguments, result shapes, error shapes, side effects, which UI files call them.
- `data-files.md`: every file type, fields, ID/slug rules, `_meta` handling, who writes it, concurrency mode (CAS / lock / none). Draft JSON Schemas in `docs/schemas/`, checked against generated synthetic samples.
- `business-rules.md`: grade calculation (9-point scale, n-term, CvTE bounds), RTTI tags `R/T1/T2/I`, question kinds `normal|bonus|diag`, score values (number, `null`, `'N'`), best attempt across resits, observatie-to-opdracht coupling and per-student assignment lists.
- `typst-contract.md`: exactly what data reaches the templates, the `lib.typ` API (`opgave`, `vraag`, `setup_extra`, `render_uitleg`, `render_opgaven`, `antwoorden_*`, markers such as `<__rtti_vraag>`), wrapper structure, root and path rules (`/data/...`, relative images).
- `ui-map.md`: screens and modals -> bridge calls -> `Store` methods.
- `quirks.md`: surprising or probably-buggy behaviour. Do not fix; list.
- `naming-map.md`: every `rtti`-prefixed identifier, file, marker and bridge name in the reference -> its new Maatwerk name (see 2.5). RTTI stays where it names the framework.

Write `docs/architecture-review.md`:
- Verify or refute section 8 (preliminary findings). Add measurements: file sizes, function sizes, complexity hot-spots (e.g. `scc` / ESLint complexity), duplicated code, global state, `innerHTML` call sites and whether all user data goes through the escape helper.
- Dependency review: licences of **every** dependency against AGPL-3.0 compatibility, unused deps (`docx`), CDN use. **Known blocker: Handsontable** (see Step 3b): its licence is proprietary/non-commercial and cannot ship in a public AGPL app. List the exact features of the score grid that must be preserved (input for Step 3b).
- Security notes: CSP, path handling, Typst sandbox expectations.
- A clear **keep / change now (during port) / change later (after parity)** table.

Write `docs/adr/0002-target-architecture.md` (revise section 4 if warranted) and `docs/adr/0003-data-format-v2-candidates.md`: each candidate change with cost, benefit and risk (examples: `schema_version`, removing legacy files and `migrate()`, dropping `.lock` files if CAS suffices, `lib.typ` no longer stored in the data folder, IDs, `_meta` normalisation). Pick nothing yet.

**STOP.** The user reads the architecture review, ADR-0002 and ADR-0003 and decides. Do not continue until the user answers.

---

### Step 2: Safety net on the old app (L)

**Goal:** executable specs of the old behaviour. Starts in this step on purpose (section 5).

**2a: fixtures, logic and storage goldens**
- `tools/fixtures`: deterministic generator of synthetic data folders: `tiny` (1 class) and `school` (4 subjects, ~25 groups each, ~600 students, ~100 exams). Edge cases: bonus and diag questions, `N` and `null` scores, resit chains, students in several groups, empty exam, one-student exam, names with diacritics, apostrophes, tussenvoegsels, very long names, Typst-special characters in names (`# $ " \ @ < >`), emoji in observatie icons, opdrachten with images (png, jpg, svg), opdracht with zero vragen, vragen inside grids/figures, odd and even page counts.
- `tests/reference-harness`: run the reference JS logic in Node (`vm` sandbox with a fake `window.rtti` on a temp-dir FS). Scenarios -> `tests/golden/logic/*.json`: grade/result calculation, best attempts, coupling and per-student assignments, CSV import parsing, grade/colour utils, ID/slug functions, legacy `migrate()` (record only).
- Storage and sync spec, executable against the reference `sync.js` plus the lock/CAS logic (copy verbatim into `tools/reference-shims/` with source line references; shim the Electron-bound parts): CAS conflict, `locked`, lock TTL expiry, atomic rename retry, watcher own-write ignored, external change/add/delete detected, year scope in poll, ignored dirs, `_preview_` files ignored. Write `docs/specs/storage-spec.md` as a table, one row per test.

**2b: Typst goldens**
- Use the reference CLI (`_reference/bin/typst/<platform>/<arch>`, 0.14.2). Copy `toTypst`, `buildAssignmentWrapper`, `placeholderHeader`, `typStr` verbatim into `tools/reference-shims/`.
- Compile: rapport (several students, long names, all question kinds, with and without school watermark), opdracht in `student` and `answers` mode (with/without images, multi-page), SVG preview, and a batch with duplex (odd and even page counts).
- Store: PNG per page (small ppi), extracted text per page, page counts, batch page structure. Keep the repo small (size budget in `docs/testing.md`).
- `npm run golden:regen` regenerates (needs the reference CLI). CI runs the **check** only; the Rust tests in later steps read these files.

**Review focus:** do the goldens really cover reference behaviour? Check the coverage matrix in `docs/testing.md`.

---

### Step 3: UI foundation (L)

> **Step 1 decisions (ADR-0002, ADR-0003):** the bridge has **28** methods (one of the 29 is unreachable). Do **not** port `migrate()`. Move all inline `style=` attributes into CSS classes (no `unsafe-inline` in the CSP) and clean up inconsistent styling. Fix during 3a, failing test first: U3, U9, D25, D34, U6/U7, B22, B9 (read both advice-key schemes). Domain code compares student IDs as strings (C8 prep). Quirk list: `docs/reference/quirks.md`.

> **Step 2 decisions (user, 2026-10-26):** fix quirks **T26** (a non-numeric score breaks the class rapport: `assembleVragen`/`scoreDotColor`) and **T27** (`sanitizeTypstMarkup` warning contains `$`) during 3a, failing test first. The goldens `tests/golden/typst/rapport-tiny` and `rapport-markup` pin the old, failing behaviour; see `docs/reference/quirks.md`.

**3a: foundation.** Goal: the existing UI runs in Vite, offline, against a mock backend, with logic extracted and tested. Handsontable stays **temporarily** in 3a; it must not be shipped (see 3b).

- Import `_reference/renderer` into `ui/` **verbatim as its own commit** (reviewable diffs).
- Vite + npm dependencies replace the CDN scripts: Handsontable, Chart.js + annotation plugin, pdfjs-dist, the CodeMirror 6 packages used by `editor-init.js` (currently from esm.sh). Strict CSP with **no remote origins**. App must work without internet. Lock versions.
- Bridge: `ui/src/bridge/api.ts` with the 29 methods as an interface. `MockApi` (in-memory FS seeded from `tools/fixtures`, emulates CAS conflicts and `data:changed` events). `TauriApi` is a stub until Steps 4-6. Right after the verbatim import, one mechanical codemod commit renames `window.rtti` to `window.maatwerk` everywhere; keep `window.maatwerk = api` as a compatibility shim so screens run unchanged.
- Extract pure logic out of `store.js` into `ui/src/domain/*` (TypeScript, no `window`, no DOM): grades, results, attempts, assignment coupling, IDs/slugs, CSV. `Store` keeps cache and I/O and delegates. Vitest against the Step 2 goldens.
- `tsconfig`: strict for new TS; `allowJs` + `checkJs` (lenient) for legacy JS. ESLint + Prettier.
- Playwright smoke on `MockApi`: boot, every tab renders, create exam, enter scores, open rapport modal (mock returns a canned PDF), no console errors.
- `npm run dev:mock` lets the user click through in a normal browser.
- Start `docs/parity.md`: one row per old IPC handler and per UI-visible behaviour -> new command -> test.

**3b: replace the score grid (Handsontable)**

> **Step 1 decisions (ADR-0002, ADR-0003):** preferred replacement is a small own grid on a `<table>` (feature list: `docs/architecture-review.md` 4.1, `docs/reference/metrics.md` section 8). The new grid also fixes U2 and U4. Still ask the user to choose.
- *Why:* Handsontable 14 is under the HandsOnCode Non-Commercial licence (key `'non-commercial-and-evaluation'`). That licence permits personal, education and research use, but treats institutional environments as commercial (45-day evaluation), grants no clear distribution right, and is proprietary, so it cannot be bundled in an AGPL-3.0 app. The user has been told this; do not ship it.
- First write a **behaviour spec** of the grid from `ui/src/screens/scores.js` (`docs/specs/score-grid.md`): numpad and arrow navigation, `N` for not evaluated, empty vs `0`, per-question observations, validation/colouring against max points, frozen headers, copy/paste of ranges, bonus/diag columns, colleague presence markers, keyboard shortcuts, expected size (about 30 students x 40 questions).
- Write Playwright tests for that spec **against the Handsontable version first**, so the replacement is verified against the old behaviour.
- Evaluate permissive candidates and write an ADR: AG Grid Community (MIT), Tabulator (MIT), or a purpose-built lightweight grid (a rectangular numeric entry table may be simpler than a general library and has no licence risk). **Ask the user to choose.**
- Implement behind a small `ScoreGrid` interface, remove the `handsontable` dependency, add the npm licence check to CI.
- Pass the same Playwright tests with the new grid.

---

### Step 4: Rust core: paths, storage, watcher (L)

> **Step 1 decisions (ADR-0002, ADR-0003):** **no `.lock` files** (C3; concurrency tests must confirm CAS suffices, otherwise stop and ask), CAS also for `school.json`, `config.json` and RTTI templates (C6), active year per teacher in local session state (C7), refuse folders with an unknown/newer `schema_version` (C1). Reads distinguish missing from corrupt.

> **Step 2 decisions (user, 2026-10-26):** storage spec rows **S37** (CAS check not atomic across instances) and **S38** (blind writes) are unreliable old behaviour; the user will probably rule that 4a fixes them. **Stop and ask** with a concrete proposal (what is needed to make CAS atomic without `.lock` files; CAS for students and score files?) before implementing. Spec: `docs/specs/storage-spec.md`.

**4a: paths and storage** (`maatwerk-core`)
- `paths`: `DataDir`, safe relative-path join (reject `..`, absolute, drive letters, symlink escape, reserved Windows names). Data dir location: next to the exe (`current_exe()` parent) or `data/` next to the project in dev. Overridable by an env var for tests.
- `storage`: read JSON, read JSON + content hash, write JSON atomically (temp + rename, retry on `EPERM/EBUSY/EACCES` with backoff, last-resort direct write), CAS on content hash (`expectedHash`, `null` = must not exist), `_meta.rev` stale-write rejection (as the UI does today), `.lock` files with 10 s TTL for non-score files, score files unlocked. List years (newest first), ensure year (exams/, groups/, scores/<subject>/), list score files, read all JSON in a dir, delete, ensure dir, text files, photo as data URL, save photo, local session file (OS app-config dir, not the shared folder), seed initial data (admin user, directories).
- JSON output: 2-space indent, key order preserved (`serde_json` `preserve_order`), no gratuitous reformatting.
- Port the Step 2 storage spec **test-first**. Add concurrency tests (two storage handles on one temp dir) and failure injection for rename errors. `proptest` for path safety.

**4b: watcher and commands**
- `watcher`: `notify` + 20 s poll fallback, 500 ms debounce, 100 ms flush batching, own-write suppression (`note_write`, `note_delete`), year scope, ignored dirs (`fotos`, `bak`, `templates`, `temp`, `rapporten`), watched extensions `.json`/`.typ`, retry on unparsable JSON (OneDrive still syncing), restart watch after errors. Emits `data:changed` `[{relPath, kind, meta}]`.
- Presence: heartbeat file write and mark-offline on quit/user switch.
- Tauri commands for all of the above; implement `TauriApi` for these methods; the UI runs against real storage on synthetic data.
- Typed errors and generated TS bindings (ADR for the tool choice).

**Review focus:** data loss, lost updates, watcher feedback loops, path traversal.

---

### Step 5: Typst service, parity with the old output (L)

> **Step 1 decisions (ADR-0002, ADR-0003):** two Worlds: the **rapport** World (embedded template, JSON data file, `fotos/**`) and the **opdracht** World whose root is **one opdracht project folder** (`main.typ`, `opdracht.typ`, `lib.typ`, `images/`; ADR-0002 5a). Build the service around a `TypstProject` abstraction; for parity with v1 goldens, present a v1 opdracht as a virtual project. Embed `zero`, `cetz`, `oxifmt`, `unify`. Runtime data for opdrachten via `sys.inputs` JSON with placeholder defaults. lib.typ/main.typ versioning: version line + hashes of released versions. Fonts: embed only what the templates use or record the GUST/Bitstream Vera licences. Where this section conflicts with ADR-0002, the ADR wins.

> **Step 2 decisions (user, 2026-10-26):** the template side of quirk **T26** (no `rgb()` on a non-colour) and the unguarded `uitleg_rtti` eval of **T11/T27** are fixed in 5a, failing test first; the rapport goldens `rapport-tiny`/`rapport-markup` stay as the record of the old behaviour.

**5a: World and report PDF**
- `TypstWorld` implementing `typst::World`: in-memory `main` source; embedded files (`rapport.typ` = the old `rtti_export.typ`, `lib.typ`, `base_assignment.typ`; rename markers to `<__maatwerk_*>`); **vendored Typst packages** (`@preview/cetz:0.3.4`, `@preview/unify:0.8.0`; check their licences) so compiling needs no network; fonts via `typst-assets` (Libertinus Serif) plus system fonts via `typst-kit`, searched **once** at startup; `today()` injectable.
- Path rules, kept compatible with existing assignment files: `/data/...` is the data folder, relative `image("images/<id>/x.png")` resolves relative to the .typ file. **Sandbox:** only `opdrachten/**` and `fotos/**` of the data dir plus embedded assets are readable; canonicalise and prefix-check; no symlink escapes. This matters later for AI-generated content.
- Replace the string serialiser `toTypst()` with data passed as a **virtual JSON file** read by the template via `json()` (edit `rapport.typ` accordingly). Same for the assignment header. No escaping bugs, no wrapper source generation.
- `compile_pdf(request) -> Result<Vec<u8>, Vec<Diagnostic>>`. Deterministic PDF options for tests (fixed timestamp/ident).
- `Diagnostic { severity, message, hints, file, line, column, range, trace }`, mapped to the user's file, not to a hidden wrapper.
- Parity tests against the Step 2b goldens for the rapport.

**5b: assignments, SVG, batch, merge, CLI**
- `render_assignment_pdf`, `render_assignment_svg_pages` (in memory; the old `_preview_*.typ` copies and `svg_preview/` temp files disappear), `render_assignment_batch(jobs, opts, progress)`: each (student, opdracht) is its own compile (opdracht files share function names and labels, so they cannot share one document), worker threads `max(2, min(4, cpus-1))` sharing the font book and package cache, progress callback.
- `pdf_merge`: merge PDFs; with `duplex`, every new key (student) starts on an odd page by inserting a blank page the size of the last page. Evaluate `lopdf` first; if font/resource handling is flaky, record an ADR with the alternative. Tests: merged page count, blank pages at the right places, text extraction.
- `maatwerk-cli typst compile <file.typ> --out x.pdf` for headless use.
- Verify emoji icons in observatie headers render (system emoji font on Windows). If not reliable, decide on a bundled emoji font (open decision, section 9).
- Parity tests against goldens for opdracht, SVG, batch.

**Review focus:** sandbox escapes, parity gaps, thread safety, memory use on large batches.

---

### Step 6: Tauri wiring, parity, portable build (L)

> **Step 1 decisions (ADR-0002, ADR-0003):** PDFs live in the OS cache dir and reach pdf.js through a custom URI scheme; **printing** writes a timestamped, descriptively named copy to `rapporten/<schooljaar>/` in the data folder and opens that copy (ADR-0002 section 9, C15). Image names no longer contain the opdracht id (they live in the opdracht folder after Step 7).

**6a: remaining commands and plugins**
- Image handling: file dialog (`tauri-plugin-dialog`) with a token so the absolute path stays in Rust, clipboard image (`tauri-plugin-clipboard-manager`), thumbnails as data URLs (`image` crate; SVG gets none), save/import/copy/delete opdracht images, name cleaning (NFD, strip diacritics, `[^A-Za-z0-9_-]` -> `-`, max 60), overwrite handling, allowed extensions `png jpg jpeg gif svg webp`, remove empty image dirs on start.
- `open_path` (`tauri-plugin-opener`), render commands from Step 5, Typst progress as events (`assignment:progress`), `data:changed` events, presence on window close.
- PDF viewer: deliver PDF **bytes** to pdf.js (no `file:///` URLs).
- Window config (title "Maatwerk", size 1280x800, min 900x600, no menu), icon from `_reference/build/icon.ico`. Splash is optional.

**6b: parity and build**
- Finish `docs/parity.md`: every old handler and UI behaviour has a new command and a test or an explicit manual-check line. Produce `docs/manual-test.md`: a click-through checklist per screen for the user.
- `TauriApi` is the only implementation used by the app; remove the compat shim if all screens are migrated, otherwise record the remainder in the backlog.
- CI builds the portable exe. WebView2 missing -> show a clear Dutch error.
- Tag `v0.2.0-parity`.

**Review focus:** parity gaps, architecture drift check, `/security-review`.

The user now tests on a **copy** of real data and reports differences. Fix them in a follow-up before Step 7.

---

### Step 7: Data format v2, migration, cutover runbook (M)

Only change what the user approved from ADR-0003. **The user approved all candidates** (2026-10-25); the migration covers C1, C2, C3 (delete `.lock`), C5, C8, C9, C10, C11 (folder rename), C12, C13 and C14 (opdracht project folders), per the timing table in ADR-0003. C9 and C10 are high risk: migration tests first, and stop and ask if the goldens show unexpected changes.

- `schema_version` in `config.json`; the new app refuses folders with a *newer* version and offers migration for older ones.
- `maatwerk-cli validate-data`: checks schemas and cross-references (exam -> group, score -> student/exam, opdracht -> observatie, missing images). Also callable from the app (admin screen).
- `maatwerk-cli migrate --dry-run | --apply`: backup **first** (zip to a folder outside the OneDrive folder), migrate, re-validate, report. Idempotent. Migration tests from synthetic v1 fixtures to expected v2 output.
- `lib.typ` is no longer shared: each opdracht folder gets its own copy (C14, replaces C4).
- `docs/cutover-runbook.md`: backup, announce, everyone closes the old app, one admin runs migration, distribute the new exe, move the old exe away, rollback plan (restore backup).

---

### Step 8: New editor and assignment pipeline on the crate (L)

**Goal:** use what a library gives us that a CLI cannot.

> **Step 1 decisions (ADR-0002, ADR-0003):** the editor works on one opdracht project folder: file list (`opdracht.typ`, `main.typ`, `lib.typ`, images), warning banner when editing `main.typ`/`lib.typ`, "Herstel standaardversie", "Bekijk verschillen" for outdated copies (ADR-0002 5a).

**8a: live compile service**
- `EditorSession` in `maatwerk-core`: holds the source in memory (never written to the data folder), `update(source)` debounced, **incremental compile** (long-lived World, `comemo` caches evicted after each compile), latest request wins (generation counter), keeps the last good preview while there are errors, returns **only changed pages** (SVG + hash).
- Structured diagnostics instead of stderr text.
- Tests: edit sequences give the expected diagnostics and pages; compile time budgets in `docs/perf.md`.

**8b: editor UI**
- CodeMirror 6: diagnostics via `@codemirror/lint`; autocomplete, hover and go-to-definition from `typst-ide` where available for the pinned version (verify what exists); bidirectional source <-> preview sync via `typst-ide` jump functions (replaces the `<__rtti_cursor>` metadata/link hack); keep the existing insert opgave/vraag/image actions.
- Structured extraction of `<__maatwerk_vraag>` markers through the document introspector: list of `{ opgave, label, points, answer }`, total points, "assignment has no vragen" checks. This also drives the answer key and later AI checks. Keep `lib.typ` behaviour unchanged for existing files.
- Playwright test of the editor with a mocked session; Rust tests for the session.

**Cutover readiness (end of Step 8):** licence audit shows no non-AGPL-compatible dependency in the exe; `THIRD_PARTY_LICENSES.md` is complete; the cutover runbook (Step 7) has been rehearsed on a copy of the `school` fixture and on a copy of real data (made by the user, outside the repo); release candidate tagged. Then tell the user the app is ready to switch.

**Review focus:** latency, stale results, memory growth in long sessions.

---

### Step 9: AI-ready seams (S)

> **Step 1 decisions (ADR-0002, ADR-0003):** an opdracht is a self-contained project folder (ADR-0002 5a). The CLI (and a later AI session) can run inside **one** opdracht folder and only sees that folder; design the `check`/`render` API around that.

No AI features. Make them cheap to add later.

- `maatwerk-cli assignment check <file.typ> --json`: diagnostics, page count, vragen, total points. `assignment render <file.typ> --pdf out.pdf`. `assignment export-lib <dir>` for external editors (e.g. tinymist). JSON output has a schema in `docs/schemas/`.
- `docs/assignment-format.md` and `docs/ai-context/assignment-authoring.md` (compact, self-contained, <= ~8k tokens): the `lib.typ` API, rules (unique labels, `lang: "nl"`, Figuur captions, points notation, how images are referenced), 4-5 good examples in `docs/assignment-examples/`, and the lint rules the editor applies. This is the file an AI would be given as context.
- `docs/adr/0009-ai-integration.md`: options (A) in-app assistant with the teacher's own API key stored in the OS keychain, (B) external tool operating on the data folder via the CLI, (C) later both. Constraints to record: **only assignment text and parameters leave the machine, never student names or scores** (AVG/GDPR), human-in-the-loop (diff, accept/reject), a compile-check-fix loop using the same `check` API, the Typst sandbox from Step 5, cost and offline behaviour. Decide nothing; list the questions for the user.

---

### Step 10: Hardening, refactor, maintainability (L; may take several sessions)

Order: biggest risk first, always with tests around the code you touch.

- Split the largest UI files (candidates from the reference: `scores.js` ~1.5k lines, `store.js` ~1.5k, `toets-overzicht.js` ~1.3k, `profiel.js` ~1.2k, `editor-init.js` ~1.7k, `style.css` ~2.8k) into cohesive modules. Convert extracted modules to TypeScript. Remove dead code (`docx` dependency, legacy `migrate()` if v2 made it obsolete).
- Decide, with measurements, whether domain logic moves to Rust (open decision 4).
- Consistent error handling and Dutch user-facing messages; panic hook; log file in app-data; "report a problem" shows the log path.
- Performance: run the `school` fixture and a batch of 200 PDFs; budgets in `docs/perf.md`.
- Security: `cargo audit`, `cargo deny`, `npm audit`, CSP review, `innerHTML` audit, Typst sandbox tests, path-traversal fuzzing.
- Optional: real-app E2E with tauri-driver on Windows CI.
- Docs: README (what it is, install, data folder, backup), `docs/architecture.md` (short), contributing + test guide, release process (version bump, tag, CI exe + checksum).
- Final **whole-codebase review** by a fresh reviewer, plus `/security-review`.

---

### Step 11: macOS (M, when needed)

- CI macOS job; universal build (`--target universal-apple-darwin`).
- WebKit compatibility: test the score grid, Chart.js, CodeMirror, pdf.js, the score-grid keyboard handling.
- Data folder: a `.app` is a bundle and Gatekeeper may run unsigned apps from a read-only translocated path. Add a **first-run "choose data folder"** step stored in the local config (also useful on Windows).
- Signing/notarisation decision with the user (Apple Developer account) or documented right-click -> Open instructions.
- Fonts and emoji rendering on macOS.

---

## 7. Reference notes: tricky behaviour to carry over

- OneDrive/AV can hold files open: **retry renames** on `EPERM/EBUSY/EACCES` with backoff; fall back to a direct write rather than losing the change. Never delete and recreate folders on OneDrive (the old app keeps `temp` subfolders for this reason; the new app has no temp files).
- Poll every 20 s as well as OS events: OneDrive swallows events. Poll scope is the active year only.
- Own writes must not come back as external changes (`noteWrite` after every write, including presence and images).
- Unparsable JSON in the watcher usually means "still syncing": retry once after ~1 s.
- `lib.typ` was rewritten on every start only if its hash differed, to avoid showing up as a change for everyone. If it is embedded (Step 7), this problem disappears.
- Filenames from the UI are validated to be plain basenames (`path.basename(x) === x`). Opdracht IDs must match `^[\w-]+$`.
- Batch compile order and grouping: output order = job order, jobs with the same `key` (one student) stay together, duplex pads to an odd start page per key, blank page has the size of the previous page.
- Header text uses `exam_prefix: "N.a.v."`; observatie icons are emoji.
- Documents use `lang: "nl"`; captions say "Figuur".
- Exam IDs, group IDs, student IDs, observatie/opdracht ID formats are listed in the reference `CLAUDE.md`; keep them (or migrate deliberately in Step 7).
- The reference's presence heartbeat marks users offline on quit; crashes leave a stale file, so the UI relies on `heartbeatAt`.
- Windows long paths and OneDrive "files on demand" can make reads slow or fail; treat read errors as retryable where the reference does.

---

## 8. Preliminary maintainability findings (from a first read; **verify in Step 1**)

**To keep**
- Clean process boundary: `contextIsolation`, no Node in the renderer, one `window.rtti` bridge.
- Sensible shared-folder design: atomic writes, hash CAS, `_meta.rev`, watcher plus poll, readable JSON layout.
- `Sync.on(type, handler)` pub/sub and `data-action` event delegation (CSP-friendly).

**To change**
- `main.js` is a monolith (filesystem, locking, presence, images, Typst, window, ~1,000 lines) with Electron types mixed into logic.
- `store.js` (~1.5k lines) mixes cache, IPC, RTTI/grade logic and legacy migration; it is a classic global script, so it is hard to test.
- Several renderer files over 1,000 lines; UI built with `innerHTML` strings, which makes escaping a recurring risk.
- CDN dependencies (Handsontable, Chart.js, pdf.js, CodeMirror from esm.sh): needs internet, unpinned supply chain, CSP exceptions.
- Typst data passed by generating Typst source from strings (`toTypst`), and wrapper `.typ` files written to a `temp/` folder inside the app dir.
- `lib.typ` copied into the shared data folder on every start.
- No tests, no types, unused `docx` dependency, leftover legacy migration code.

---

## 9. Open decisions (ask the user when you reach them)

1. **Score grid replacement** (Handsontable is not usable under AGPL): which permissive library or custom grid? Decided 2026-10-27: own grid on a `<table>` (ADR-0004).
2. **Emoji/icon font**: rely on system emoji fonts or bundle one (Step 5).
3. **`.lock` files**: decided in Step 1: CAS only, no lock files (ADR-0003 C3).
4. **Domain logic in Rust or JS?** (Step 10, with measurements).
5. **Data-folder policy** on macOS and first run (Step 11).
6. **macOS signing** (Step 11).
7. **Repo name and remote** (Step 0). Decided: `maatwerk`, public, AGPL-3.0-or-later. Remote created by the user (`github.com/Open-Beta-Onderwijs/Maatwerk`); first push after Step 5 (2026-10-28).
8. **App identifier**: decided in Step 0: `nl.openbetaonderwijs.maatwerk` (was `nl.school.rtti-app`). Changing it moves the local app-config folder, which is fine because of the cutover.
9. **Versioning and update policy** for a portable exe on OneDrive.
10. **AI integration style** (Step 9 ADR lists the questions).
11. **Cutover date.** Decided: after Step 8; the exact date is the user's call.

**Top risks:** sync/storage subtleties (data loss), Typst output drift, `lopdf` merge edge cases, WebView2 absence on school PCs, WebKit differences on macOS, scope creep during "while we are here" refactors (log them in `docs/backlog.md`, do them in Step 10).

---

## Appendix A: Glossary (Dutch term -> meaning)

leerling = student; toets = exam; opdracht = remedial assignment (Typst document); opgave = exercise inside an opdracht; vraag = question inside an opgave; observatie = reusable observation (icon, explanation, leeradvies); leeradvies = study advice; groep = class/group; vak (`nat`, `bio`, `schk`, `wi`) = subject; jaarlaag = year level; schoolsoort = school type; herkansing / inhaal = resit / make-up exam; cijfer = grade; n-term = normalisation term; rapport = per-student report; sectie = department; gebruiker = teacher account; school = school settings (name, logo, watermark).

## Appendix B: `docs/STATE.md` template

```markdown
# State
Last updated: <date/time>   Branch: <branch>   Last tag: <tag>

## Current step
<step number and name, sub-step>

## Done since last tag
- ...

## In progress
- ...

## Next action (concrete, resumable)
1. ...

## Open questions for the user
- ...

## How to resume
<commands to build/test, anything not committed>
```

## Appendix C: Reviewer checklist (give to the reviewer subagent)

1. **Parity:** deviations from the reference or the goldens; list each with evidence.
2. **Correctness:** error paths, empty/missing/corrupt files, Windows paths, non-ASCII file names, long paths, locked files.
3. **Data safety:** lost updates, partial writes, CAS races, watcher feedback loops, anything that can overwrite a colleague's change.
4. **Security:** path traversal in every command taking a path, Typst World sandbox, CSP, untrusted JSON, `innerHTML` with user data, secrets in logs.
5. **Architecture:** layering rules (no `tauri` in core, no logic in command handlers), public API size, duplication, drift from ADR-0002.
6. **Tests:** missing cases, flaky or time-dependent tests, justified golden changes, coverage matrix up to date.
7. **Maintainability:** file/function size, naming, dead code, TODOs, docs.
8. **Performance:** blocking calls on the async runtime/UI thread, large-dataset behaviour, memory growth.

Output: `docs/reviews/step-NN.md`, findings ranked blocker > major > minor > nit, each with `file:line`, evidence and a suggested fix. Do not fix anything yourself.

## Appendix D: Prompts for the user to paste

**First session**
> Read PLAN.md sections 1-3, then do Step 0. Ask me the questions listed there before creating a remote. Stop after the gate and report.

**Every later session**
> Read PLAN.md sections 1-3 and docs/STATE.md, then continue with the next action. Stop at the end of the step and report.

**After you answered a gate question**
> Continue with Step N. My decisions: ...
