# Phase 2 intake: starting inventory

Prepared 2026-11-03 as input for the phase 2 triage session (`ROADMAP.md`). Three sources: the
quirks in `docs/reference/quirks.md` that have no recorded fix, the open items in
`docs/backlog.md`, and the size and duplication of the UI code. The user adds new features (F) and
visual changes (V) during the session.

**How to read the status column.** "Fixed" and "Kept" come from a recorded decision. The others
are a first reading of quirks.md and the code layout. They have **not** been verified in the code,
so the triage marks each one: fix, keep, drop, or verify first.

- **Bug?** The quirk is still in the app and changes what teachers see or what gets saved.
  After the cutover it can be fixed, but each fix that changes grades, statistics or rapport
  output needs the user's decision (and new goldens).
- **Parity:** deliberately kept identical to the old app (goldens pin it). Free to change once
  parity no longer binds.
- **Superseded?** The Rust core or the v2 data format probably removed the cause (in-process Typst,
  typed storage, CAS). Confirm and close.
- **Cleanup:** dead code or a leftover to remove.

## 1. Quirks without a recorded fix

### 1.1 Business logic (B): grades, statistics, attempts

These change numbers that teachers see. Most still live in the JS store and modals as ported.
Tests that pin today's behaviour exist for B3, B4, B5, B6, B10, B11, B27, B28 and B31.

| ID  | Quirk (short)                                                                                          | Status                 |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| B1  | `N` means different things in different places                                                         | Bug?                   |
| B2  | Overview RTTI/question stats include bonus/diag questions and over-max values                          | Bug?                   |
| B3  | An empty question counts as 0 for the grade but is left out of RTTI                                    | Bug? (maybe intended)  |
| B4  | Score grid summary truncates totals and uses another max                                               | Bug?                   |
| B5  | Totaal cell uses a decimal point                                                                       | Bug?                   |
| B6  | Averages differ between the score grid and the overview                                                | Bug?                   |
| B7  | Histogram/grade groups use unrounded grades, pass/fail uses rounded                                    | Bug?                   |
| B8  | `toFixed(1)` and `Math.round(x*10)/10` side by side (number formatting in ~10 files)                   | Bug? + refactor        |
| B10 | Rapport leaves out students with only `N`s or only an override                                         | Bug?                   |
| B11 | Rapport leeradvies has no I row and does not clamp invalid scores                                      | Bug?                   |
| B12 | Rapport class percentage computed from an already rounded average                                      | Bug?                   |
| B13 | Best-attempt logic implemented 4 times (store.js, profiel.js, groep-leerlingen.js, domain/attempts.ts) | Bug? + refactor        |
| B14 | Summary overview mixes question structures across attempts                                             | Bug?                   |
| B15 | Profile mixes best attempts and all attempts                                                           | Bug?                   |
| B16 | Profile's jaarlaag-SE average compares across years                                                    | Bug?                   |
| B17 | "Cijfer onder" threshold rejects 1,0 but the message allows it                                         | Bug? (small)           |
| B18 | "Cijfer onder" uses this exam's grade only, not the best attempt                                       | Bug? (maybe intended)  |
| B19 | Three different rules for "the student's group"                                                        | Bug?                   |
| B20 | Observatie availability and opdracht fit treat empty lists differently                                 | Bug?                   |
| B23 | Score input accepts hex and exponent notation                                                          | Bug?                   |
| B24 | Adding a question after a deletion can repeat a question id (corrupts scores)                          | Moved to Step 10       |
| B27 | `volgnummer` overflows above 99 exams per jaarlaag                                                     | Bug? (unlikely)        |
| B28 | An unknown `rtti` tag makes `calcResults` crash                                                        | Bug?                   |
| B29 | `calcGrade` checks the bounds in sequence instead of min/max                                           | Verify (equivalent?)   |
| B30 | "Partial" warning requires the diag and bonus questions too                                            | Bug?                   |
| B31 | Results depend on the order files come back from the folder                                            | Verify (Rust may sort) |

Fixed already: B9, B21, B22, B25, B26.

### 1.2 Typst output (T)

| ID  | Quirk (short)                                                         | Status                      |
| --- | --------------------------------------------------------------------- | --------------------------- |
| T4  | A missing watermark breaks the whole rapport                          | Verify                      |
| T5  | `toTypst({})` gives an array, not a dictionary; keys emitted raw      | Parity / verify             |
| T6  | Numbers reach Typst with a decimal point and float noise              | Parity                      |
| T7  | Fractional question scores truncated in the scoretabel                | Parity (visible wrong data) |
| T8  | Rapport footer always says "/ 2"                                      | Parity                      |
| T9  | Histogram/ranking: comments, thresholds and texts disagree            | Parity                      |
| T10 | Rapport crashes on edge-case data (missing `grenswaarden`)            | Verify                      |
| T19 | Empty `observaties` gives an empty header cell, not "Geen observatie" | Parity (rare)               |
| T20 | A `vraag` outside an `opgave` is numbered as opgave 0                 | Parity (editor check warns) |
| T23 | The batch reports only the first failure                              | Verify                      |
| T24 | The PDF merge discards metadata, outlines, named destinations         | Verify                      |
| T25 | The rapport sets no `lang` ("Figure" instead of "Figuur")             | Parity                      |

Probably superseded by the in-process World and the v2 folders: T11-T18, T21, T22. T1-T3 and
T26-T31 are fixed.

### 1.3 Data and storage layer (D)

| ID  | Quirk (short)                                                     | Status             |
| --- | ----------------------------------------------------------------- | ------------------ |
| D4  | `locked` is not retried                                           | Verify             |
| D7  | `config.json` activeYear is shared by all teachers                | Decide (intended?) |
| D11 | Image changes are not watched; colleagues don't see them          | Bug?               |
| D16 | Field-merge writers (N-term, opdrachten) bump `rev` without check | Verify             |
| D17 | `upsertExam` merges over the cached object (patch vs replace)     | Verify             |
| D20 | Presence: user switch race; files never deleted                   | Verify             |
| D24 | Dead handlers (`Store.saveStudents`, `saveStudentScores`, ...)    | Cleanup            |
| D26 | Store ignores `deleteFile` results                                | Bug?               |
| D27 | Copying images cannot copy subfolders                             | Verify             |
| D28 | Photo file name and user id can differ                            | Bug? (small)       |
| D29 | Watermark always read as SVG                                      | Verify             |
| D32 | Watcher poll covers only the active year (by design in 4b)        | Kept               |

Probably superseded by the Rust storage, the v2 format and in-process Typst: D5, D8 (the editor
has CAS saves since Step 8), D12-D15, D18, D19, D21-D23, D30, D31, D33. D35 was kept on purpose
(Files On-Demand). The rest is done.

### 1.4 UI (U)

| ID  | Quirk (short)                                                        | Status                     |
| --- | -------------------------------------------------------------------- | -------------------------- |
| U5  | Average Totaal truncates half points, uses a decimal point (= B4/B5) | Bug?                       |
| U8  | Exam description unescaped in a `title` attribute                    | Bug (security-ish)         |
| U10 | Editor iframe proxy: untyped, path-based                             | Refactor                   |
| U11 | Filter popover "Alles/Niets" listeners pile up on every login        | Bug (leak)                 |
| U12 | CustomSelects in modals are never destroyed                          | Bug (leak)                 |
| U13 | Legacy migration runs on every start                                 | Superseded? (v2 migration) |
| U14 | RTTI uitleg modal bypasses the shared close/guard mechanism          | Bug?                       |
| U15 | `showModal` over an open modal drops the previous `onClose`          | Bug?                       |
| U16 | Student id type drift (number vs string)                             | Superseded? (B21 fix)      |
| U17 | Smaller observations (a list)                                        | Triage                     |
| U18 | Group students modal: period separators never rendered               | Visual (user)              |

## 2. Open backlog items, by theme

Item IDs refer to `docs/backlog.md` (review numbers per step).

**Needed before the cutover** (proposed for the slimmed Step 10):

- M-SYNC-1..4 on two machines; M-START-3 re-run; the manual checks listed in STATE.
- 6b m6: open the core on a blocking thread (a slow OneDrive folder delays the window).
- 4b n6: a watcher thread panic silently ends change reporting.
- 5b n1: a panic in one batch job is not caught per job.
- 7b m1: two PCs can both write a snapshot in the same minute.

**Robustness (core and storage):** 4a m6 (retry reads that hit a file being replaced), 4a m4
(unreadable RTTI template), 4a n4/n6/n7/n9/n10/n11/n12, 5a m4 (watcher same size and mtime), 6a m4
(thumbnail cache, image decode limits), 6b n10 (picked image read without a size cap), 7a n4-n8,
7b n4/n5, restore-from-snapshot reload, 7c read-vs-colleague-change race, 8a m2/n2/n5/n6, 8b m5/n6/n8,
Step 9 m3 (time limit on headless check/render, needed for the AI assistant), Step 9 n6, 5b n6.

**Typst and output:** upgrade Typst from 0.14.2 (plus Noto, quick-xml advisories, goldens), show
Typst warnings in the UI (6a), name the field in errors from eval'd teacher text (5a m3), 5b n4
hash normalisation, 5b n5, 8b n1
(vragen checks edge cases), jumps after an error, `rapporten/` retention policy.

**UI and UX:** CSV import screens show an example CSV (M-LEER-3, M-GRP-3), Ctrl+X in the score
grid (3b m5), `window.confirm` in the editor becomes the app's own dialog (8b m6), the watermark
upload message (6b n9), invalid Unicode file names (6a n7), unsaved-cell mark (3b n4), first tab
visit speed (7c), kept-screen re-renders (7c m4, n2), card size estimate (7c n5), stamp issues not
shown (7a m2), user photos shown inconsistently (M-ADM-1, check if 7b fixed it).

**Styling:** 128 `u-*` one-declaration utilities with `!important` in `style.css` (3a): turn them
into semantic component classes, fix the preserved inconsistencies (grade pills 34 vs 36 px, two
panel paddings, two greys).

**Dependencies:** Typst (above), Tauri 3 when stable, pdfjs-dist 4.9.155 / chart.js 4.4.2 /
chartjs-plugin-annotation 3.0.1 (pinned to the reference versions).

**Tests and CI:** Tauri command-level tests (`tauri::test`), e2e timing (Step 9 m7, 3a n5, 7c
retries, 7c m5), the real-PDF test under the real scheme (6b m3), the 7a m6 migration parity check
(can be dropped after the cutover), Step 2 golden items (m3/m4/m6/m7, 2a n4), the bundle licence
check (3b m8), CI hygiene (pin actions, double runs; n9), the two licence allowlists (n2), SPDX
for toml/yml (n6), the verbatim LICENSE text (n3).

**Cleanup after the cutover:** `TypstProject::opdracht_v1` (7a n1), the compat layer in
`ui/src/bridge/tauri-api.ts` (removed screen by screen), v1 goldens that only served parity, the
`_reference/` harness (keep as history or archive), and the `render_assignment_svg` command (no
caller since Step 8b; its cursor marker went with `main.typ` 2 in 0.3.1, review 8b n4).

## 3. UI code: size and duplication

**JS still to convert:** 32 JS files, 15,963 lines, against 49 TS files with 7,155 lines (tests
not counted). Largest:

| File                             | Lines | Notes                                           |
| -------------------------------- | ----: | ----------------------------------------------- |
| `style.css`                      | 3,810 | 128 `u-*` utilities; one file for all screens   |
| `editor-init.js`                 | 1,960 | editor iframe; `editor-live.ts` is the new part |
| `screens/scores.js`              | 1,466 | score modal (the grid itself is TS)             |
| `store.js`                       | 1,318 | cache, statistics, attempts (B13), saves        |
| `modals/toets-overzicht.js`      | 1,288 | overview charts (B2, B6, B14)                   |
| `app.js`                         | 1,259 | shell, filters (U11), `formatGrade`             |
| `modals/profiel.js`              | 1,156 | student profile (B15, B16)                      |
| `editor.css`                     |   909 |                                                 |
| `modals/toets-edit.js`           |   760 | question editor (B24)                           |
| `modals/groep-edit.js`           |   747 | group edit, CSV import                          |
| `screens/toetsen.js`             |   650 |                                                 |
| `modals/opdrachten-genereren.js` |   550 |                                                 |
| `modals/rapport.js`              |   515 | rapport input (B10-B12, U6)                     |

**Duplicated code found:**

- Best-attempt logic in four places: `store.js`, `modals/profiel.js`,
  `modals/groep-leerlingen.js` and `domain/attempts.ts` (B13). Converge on `domain/attempts.ts`.
- Grade and number formatting: `formatGrade` in both `app.js` and `domain/scoregrid.ts`;
  `toFixed`/decimal-comma code in about ten files (B8). One `domain/format.ts`.
- DOM helper `el()` in `screens/gegevens.ts`, `instellingen.ts`, `migration.ts` and inline in
  `startup-error.ts` (Step 9 n9). One shared helper.
- `studentVersions` in both `modals/groep-leerlingen.js` and `modals/leerling-edit.js`.
- Modal handling: `showModal` stacking (U15), the RTTI uitleg modal's own close logic (U14),
  CustomSelects never destroyed (U12). One modal/dialog component that also replaces
  `window.confirm` (8b m6).
- Exam-menu click handling in both `screens/scores.js` and `screens/toetsen.js`.

**Domain logic location** (PLAN section 9, decision 4): the statistics and attempt logic still
run in JS. Moving them to `maatwerk-core` would give one tested implementation for the UI, the
rapport and the CLI. Decide this before the B fixes, so each fix is made once.

**Test infrastructure:** `bridge/mock/mock-api.ts` (1,101 lines) and `mock-editor.ts` (422) back
the e2e and visual tests. They grow with every command; keep them in mind when estimating.
