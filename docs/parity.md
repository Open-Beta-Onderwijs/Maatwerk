# Parity table

One row per reference IPC handler and per UI-visible behaviour: where it lives in the port and
which test pins it (PLAN.md 2.2). Started in Step 3a; Steps 4-6 fill in the Rust commands.

Status: **mock** = implemented by `MockApi` only (UI runs on it; real backend in Steps 4-6);
**core (4a)** = implemented and tested in `maatwerk-core` (Tauri command and `TauriApi` in 4b);
**port** = ported and tested; **fixed** = ported with a decided fix (quirk id); **dropped** = not
ported (reason given); **todo** = later step.

Test locations: Vitest `ui/tests/**`, `ui/src/**/*.test.ts`; Playwright `ui/e2e/**`; logic goldens
`tests/golden/logic/*.json` (reference behaviour, Step 2).

## IPC handlers (`docs/reference/ipc-api.md`)

The bridge is `ui/src/bridge/api.ts` (`MaatwerkApi`, compat result shapes). `MockApi` contract
tests: `ui/src/bridge/mock/mock-api.test.ts` ("MockApi").

| #   | Reference handler             | Bridge method             | Status          | Rust command                   | Tests                                                                                                                            |
| --- | ----------------------------- | ------------------------- | --------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `fs:readJson`                 | `readJson`                | core (4a)       | `Storage::read_json`           | mock-api.test "readJson returns null…"; Store goldens (attempts, ids, opdrachten, rapport, score-writes); Rust: `storage::tests` |
| 2   | `fs:readJsonVersioned`        | `readJsonVersioned`       | core (4a)       | `Storage::read_json_versioned` | mock-api.test "writes JSON…", "CAS"; `tests/store/score-writes.test.ts`; Rust: `storage::tests`                                  |
| 3   | `fs:writeJson`                | `writeJson`               | core (4a)       | `Storage::write_json`          | mock-api.test "CAS…", "writes JSON like JSON.stringify"; score-writes golden (file bytes); Rust: `storage::tests`                |
| 4   | `fs:listYears`                | `listYears`               | core (4a)       | `Storage::list_years`          | mock-api.test "is seeded", "ensureYear"; Rust: `storage::tests`                                                                  |
| 5   | `fs:ensureYear`               | `ensureYear`              | core (4a)       | `Storage::ensure_year`         | mock-api.test "ensureYear"; Rust: `storage::tests`                                                                               |
| 6   | `fs:listScoreFiles`           | —                         | dropped         | —                              | no call site (ADR-0002 §2)                                                                                                       |
| 7   | `fs:readAllJson`              | `readAllJson`             | core (4a)       | `Storage::read_all_json`       | mock-api.test "readAllJson … NTFS order (B31)"; Rust: `storage::tests`                                                           |
| 8   | `fs:deleteFile`               | `deleteFile`              | core (4a)       | `Storage::delete`              | via Store flows (e2e); no lock files (ADR-0003 C3); Rust: `storage::tests`                                                       |
| 9   | `fs:ensureDir`                | `ensureDir`               | core (4a)       | `Storage::ensure_dir`          | only `migrate()` used it, which is not ported (C2); kept in the interface; Rust: `storage::tests`                                |
| 10  | `fs:getDataDir`               | `getDataDir`              | mock            | Step 6                         | e2e editor (ready flag)                                                                                                          |
| 11  | `fs:readTextFile`             | `readTextFile`            | core (4a)       | `Storage::read_text`           | e2e quirks "U9", "D25"; Rust: `storage::tests`                                                                                   |
| 12  | `fs:writeTextFile`            | `writeTextFile`           | core (4a)       | `Storage::write_text`          | e2e quirks "U9"; Rust: `storage::tests`                                                                                          |
| 13  | `app:createAssignmentTypFile` | `createAssignmentTypFile` | mock            | Step 5/6                       | —                                                                                                                                |
| 14  | `opdracht:listImages`         | `listOpdrachtImages`      | mock            | Step 6                         | mock-api.test "opdracht images"                                                                                                  |
| 15  | `opdracht:saveImage`          | `saveOpdrachtImage`       | mock            | Step 6                         | mock-api.test "opdracht images" (name cleaning, duplicates, types)                                                               |
| 16  | `opdracht:pickImage`          | `pickImageFile`           | mock (cancel)   | Step 6                         | —                                                                                                                                |
| 17  | `opdracht:importImage`        | `importOpdrachtImage`     | mock            | Step 6                         | —                                                                                                                                |
| 18  | `clipboard:readImage`         | `readClipboardImage`      | mock (none)     | Step 6                         | —                                                                                                                                |
| 19  | `opdracht:copyImages`         | `copyOpdrachtImages`      | mock            | Step 6                         | mock-api.test "opdracht images"                                                                                                  |
| 20  | `opdracht:deleteImages`       | `deleteOpdrachtImages`    | mock            | Step 6                         | mock-api.test "opdracht images"                                                                                                  |
| 21  | `presence:update`             | `updatePresence`          | mock            | Step 4/6                       | mock-api.test "presence: switching users…"                                                                                       |
| 22  | `fs:readLocalSession`         | `readLocalSession`        | core (4a)       | `LocalSession::read`           | e2e (login); Rust: `storage::tests`                                                                                              |
| 23  | `fs:writeLocalSession`        | `writeLocalSession`       | core (4a)       | `LocalSession::write`          | e2e (login); Rust: `storage::tests`                                                                                              |
| 24  | `fs:readPhotoAsDataUrl`       | `readPhotoAsDataUrl`      | core (4a)       | `Storage::read_photo_data_url` | e2e visual/CSP (school screen, badges); Rust: `storage::tests`                                                                   |
| 25  | `fs:savePhoto`                | `savePhoto`               | core (4a)       | `Storage::save_photo`          | —; Rust: `storage::tests`                                                                                                        |
| 26  | `typst:version`               | —                         | dropped         | —                              | no call site                                                                                                                     |
| 27  | `typst:compile`               | —                         | dropped         | —                              | no call site                                                                                                                     |
| 28  | `app:renderRapportPdf`        | `renderRapportPdf`        | mock (canned)   | Step 5/6                       | `ui/tests/domain/rapport.test.ts` (payload = golden + fixes); e2e smoke (viewer renders)                                         |
| 29  | `app:renderAssignmentPdf`     | —                         | dropped         | —                              | only a dead editor proxy branch (removed, naming map)                                                                            |
| 30  | `app:renderAssignmentSvg`     | `renderAssignmentSvg`     | mock (canned)   | Step 5/6                       | e2e editor views                                                                                                                 |
| 31  | `app:renderAssignmentBatch`   | `renderAssignmentBatch`   | mock (canned)   | Step 5/6                       | mock-api.test "batch render validates input and reports progress"                                                                |
| 32  | `shell:openPath`              | `openPath`                | mock (no-op)    | Step 6                         | —                                                                                                                                |
| —   | event `data:changed`          | `onDataChanged`           | mock            | Step 4/6                       | mock-api.test "own writes are not echoed; external writes emit…"                                                                 |
| —   | event `assignment:progress`   | `onAssignmentProgress`    | mock            | Step 5/6                       | mock-api.test "batch render…"                                                                                                    |
| —   | (`'file:///' + pdfPath`)      | `pdfUrl` (new)            | mock (blob URL) | Step 6                         | mock-api.test "render output is a real PDF reachable through pdfUrl"; e2e smoke                                                  |

## Storage spec (`docs/specs/storage-spec.md`)

Rust tests in `crates/maatwerk-core/src/storage/{atomic,tests}.rs` are named after the row id.
Watcher rows (S28-S36, S39, S40) follow in 4b.

| Rows                | Status       | Rust tests                                                                                      |
| ------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| S01-S06             | port         | `atomic::tests::s01_*`-`s06_*` (rename failures injected); S06 temp name gets a counter         |
| S07, S09-S12, S19   | port         | `tests::s07_*`, `s09_*`-`s12_*`, `s19_*`                                                        |
| S08                 | fixed (D2)   | `tests::s08_*`: corrupt is `corrupt_json`, not `null`; the bridge compat layer maps it back     |
| S13-S17             | fixed (C3)   | `tests::s13_s16_no_lock_files_in_the_data_folder`                                               |
| S18                 | port         | `tests::s18_*` (`WriteObserver`)                                                                |
| S20-S27             | port         | `tests::s20_*`-`s27_*` (`Storage::update`, `save_entity`); the UI keeps its JS `update` for now |
| S37                 | fixed (user) | `tests::s37_*` (two handles), `tests/cross_process.rs` (three processes)                        |
| S38                 | fixed (C6)   | `tests::s38_*`; UI `ui/tests/store/cas-writes.test.ts`                                          |
| C1 `schema_version` | port (check) | `tests::schema_version_c1`                                                                      |
| Paths (D1)          | fixed        | `paths::tests` (incl. proptest, junction escape on Windows)                                     |

## Domain logic (`docs/reference/business-rules.md`)

| Behaviour                                               | Reference                                                     | Port                                           | Status    | Tests                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| Grade, n-term bounds, bonus/diag, RTTI %, overrides     | `store.js` `calcResults`, `calcGrade`, `examResults`, `qKind` | `ui/src/domain/grades.ts`                      | port      | `ui/tests/domain/grades.test.ts` (grades.json, 45 cases)                                                           |
| Resits, best attempt, history                           | `store.js` `computeBestGradeMap`, `resolveBestAttempts`, …    | `ui/src/domain/attempts.ts` + Store            | port      | `ui/tests/store/attempts.test.ts` (attempts.json)                                                                  |
| Ids, slugs, school year, names, group names, volgnummer | `store.js` `makeExamId`, `currentSchoolYear`, `upsertExam`, … | `ui/src/domain/ids.ts` + Store                 | port      | `ui/tests/domain/ids.test.ts` (ids.json)                                                                           |
| Opdracht coupling, grade cards, assignments             | `store.js` `getOpdrachtCoupling`, `getOpdrachtAssignments`, … | `ui/src/domain/opdrachten.ts` + Store          | port      | `ui/tests/domain/opdrachten.test.ts` (opdrachten.json); C8: group lookup compares ids as strings ("C8" test)       |
| Score writes (setScore, overrides, observations)        | `store.js` `update`, `setScore`, `setGradeOverride`, …        | Store (unchanged) on the bridge                | port      | `ui/tests/store/score-writes.test.ts` (score-writes.json, file bytes)                                              |
| CSV parsing, student CSV                                | `utils/csv.js` `parseCSV`, `leerling-edit.js` rows            | `ui/src/domain/csv.ts`                         | fixed B22 | `ui/tests/domain/csv.test.ts` (csv.json + "B22")                                                                   |
| Group CSV, group assignment CSV                         | `groep-edit.js` `groupRows`, `assignRows`, `applyAssignments` | screen code; `ui/src/domain/groups.ts` (D34)   | fixed D34 | `ui/tests/domain/groups.test.ts`, quirks.spec "D34"; csv.json `group-csv`, `group-assignment-csv` not yet consumed |
| Rapport payload (vragen, leeradvies rows, exam info)    | `rapport.js` `compileRapport`, `assembleVragen`, …            | `ui/src/domain/rapport.ts`, `services/rapport` | fixed     | `ui/tests/domain/rapport.test.ts` (rapport.json + T26, T27, B9; C8 group lookup)                                   |
| Averages (group modal, profile)                         | `groep-leerlingen.js`, `profiel.js`                           | screen code (unchanged)                        | todo      | averages.json (not yet consumed; Step 10 decides extraction)                                                       |
| Display colours and grade formatting                    | `utils/colors.js`, `utils/grades.js`, `app.js formatGrade`    | screen code; `gradeCell` markup now classes    | todo      | display.json (not yet consumed)                                                                                    |
| Score grid row/summary computation                      | `scores.js` `recomputeRow`, `normalizeScore`, …               | `ui/src/domain/scoregrid.ts`                   | port      | `ui/tests/domain/scoregrid.test.ts` (scoregrid.json, 8 of 10 cases; the other 2 are not grid code)                 |
| Exam statistics, histogram, boxplot                     | `toetsen.js`, `toets-overzicht.js`                            | screen code (unchanged)                        | todo      | stats.json (not yet consumed)                                                                                      |
| Legacy migration                                        | `store.js` `migrate()`                                        | —                                              | dropped   | ADR-0003 C2 (no legacy data)                                                                                       |

## UI behaviour

| Behaviour                                           | Port                                                    | Status                | Tests                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| App works offline (no CDN)                          | npm deps bundled by Vite                                | port                  | `ui/tests/offline.test.ts`                                                              |
| Strict CSP, no inline styles/scripts                | `ui/vite/csp.ts`, `legacy/style-data.ts`, classes       | port                  | `ui/tests/csp.test.ts`, `ui/e2e/csp.spec.ts` (37 views)                                 |
| Every screen and modal looks as in the reference    | —                                                       | port                  | `npm run test:visual` (local, 37 views; score modal: own grid, reviewed in 3b)          |
| Login, tabs, create exam, enter score, rapport      | legacy screens on `MockApi`                             | port                  | `ui/e2e/smoke.spec.ts`                                                                  |
| Score save errors are shown                         | `scores.js saveCell`                                    | fixed                 | `ui/e2e/quirks.spec.ts` "U3"                                                            |
| Teacher text in the RTTI uitleg modal kept as typed | `rapport.js` textareas                                  | fixed                 | quirks.spec "U6"                                                                        |
| User data on the login screen shown as text         | `startup.js`, `gebruikers.js`                           | fixed                 | quirks.spec "U7"                                                                        |
| Closing the editor keeps the last edit              | `editor-init.js flushSave`                              | fixed                 | quirks.spec "U9"                                                                        |
| Editor reports failed calls instead of hanging      | `modals/editor.js` proxy, `editor-init.js postToParent` | fixed                 | quirks.spec "D25"                                                                       |
| Score grid (spec G01-G63)                           | own grid `ui/src/components/score-grid/` (ADR-0004)     | fixed U1, U2, U4, U19 | `ui/e2e/score-grid.spec.ts` (spec `docs/specs/score-grid.md`), Vitest clipboard helpers |
| Editor iframe `postMessage` types `maatwerk-*`      | codemod                                                 | port                  | e2e editor views                                                                        |
