# Testing

Strategy and layers: PLAN.md section 5. This file holds the practical side: commands, the
golden format, harness assumptions, size budget and the **coverage matrix** (reference behaviour
-> tests), which the reviewer checks.

## Commands

| Command                                                 | Needs `_reference/`                       | What it does                                                                           |
| ------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm test`                                              | no                                        | UI unit tests, tool tests, fixture determinism, storage spec, golden structure checks  |
| `npm run golden:regen [-- <suite> ...]`                 | yes, at `0e30a70`                         | Re-runs the reference code and rewrites `tests/golden/logic/*.json`                    |
| `npm run golden:check`                                  | yes                                       | Re-runs the reference and fails on any byte difference                                 |
| `npm run golden:typst [-- --check] [-- <case> ...]`     | yes, plus the Typst package cache (below) | Renders the Typst goldens with the reference CLI 0.14.2 (or checks them byte for byte) |
| `node tests/reference-harness/make-shims.mjs`           | yes                                       | Rewrites `tools/reference-shims/*.cjs` from the reference                              |
| `node tools/fixtures/generate.mjs <tiny\|school> <dir>` | no                                        | Writes a synthetic data folder                                                         |

With `_reference/` present, `npm test` also re-runs every golden suite and the shim drift check.
CI has no `_reference/` (it is gitignored and has no licence), so CI checks structure only; the
goldens and shims change only through the commands above, with the reason in the commit message.

## Layout

- `tools/fixtures/`: seeded generator. `tiny` = 1 class (44 files); `school` = 4 subjects, 6
  jaarlagen x 4 classes, 600 students, 2 school years (5092 files, ~22 MB, never committed).
  `manifest.json` pins a SHA-256 over the generated tree. Edge cases: bonus/diag questions, `N`,
  invalid and missing scores, resit chain (herkansing + inhaal with another structure), cluster
  groups (students in two groups), empty exam, one-student exam, diacritics, apostrophes,
  tussenvoegsels, a very long name, Typst-special characters (`# $ " \ @ < > * _`), emoji
  (including ZWJ and flag sequences), grade overrides, saved couplings with deleted opdrachten,
  grade cards, opdrachten with PNG/JPG/SVG images, zero vragen, vragen in grids and figures, and
  long opdrachten with odd and even page counts.
- `tests/reference-harness/`: runs the reference in Node. `main-process.mjs` loads the real
  `main.js` and `preload.js` with a fake `electron`; `store.mjs` loads `renderer/store.js`;
  `extract.mjs` pulls single functions (or a checked line range) out of UI modules and runs them
  with explicit free variables; `suites/*.mjs` produce the goldens.
- `tests/golden/logic/*.json`: logic goldens.
- `tools/reference-shims/`: verbatim reference storage code and the storage spec
  (`docs/specs/storage-spec.md`).

## Golden format

```json
{
  "format": 1,
  "suite": "grades",
  "description": "...",
  "reference": { "commit": "0e30a70...", "code": ["renderer/store.js:743-754 calcGrade", "..."] },
  "cases": [{ "id": "nterm-lo1", "rule": "BR 11.2", "input": {}, "output": {} }]
}
```

`rule` points into `docs/reference/business-rules.md` (`BR`), `data-files.md` (`DF`),
`typst-contract.md` (`TC`) or `quirks.md`. JSON cannot hold some JavaScript values, so they are
tagged: `{"$undefined": true}`, `{"$number": "NaN" | "Infinity" | "-Infinity" | "-0"}`,
`{"$throws": "TypeError: ..."}` for an exception, `{"$map": [[k, v], ...]}` and `{"$set": [...]}` for Map and Set. A case named `data` holds the scenario's data
folder for the other cases of that suite. Consumers (Vitest in Step 3, Rust in Steps 4-5) must
decode these tags.

## Harness assumptions

These make runs deterministic. Each is a choice about the environment, not about the code:

| Assumption                                                                        | Why                                                                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Clock frozen at `2026-03-02T10:00:00` local (`environment.mjs`)                   | `_meta` timestamps, `currentSchoolYear()`                                                                             |
| `TZ=Europe/Amsterdam`                                                             | The school year turns over on 1 August local time                                                                     |
| `localeCompare` without a locale collates as `nl-NL`                              | The app runs on Dutch Windows; Node's default locale depends on the host                                              |
| IPC arguments and results pass through `structuredClone`                          | Same as Electron IPC                                                                                                  |
| `readdirSync` in `main.js` returns names in NTFS order (case-insensitive ordinal) | `fs:readAllJson` order decides e.g. which group a student gets (quirk B31); checked with `MAATWERK_READDIR_REVERSE=1` |
| `app.whenReady()` never resolves                                                  | No seeding, watcher or window during tests                                                                            |
| Admin-only flows run after `Store.loadYear(year, null)`                           | The admin view loads all groups (group-assignment CSV import)                                                         |

## Size budget

| Area                     | Budget | Now    |
| ------------------------ | ------ | ------ |
| `tests/golden/logic/`    | 1 MB   | 414 KB |
| `tests/golden/typst/`    | 5 MB   | 2.6 MB |
| `tools/fixtures/assets/` | 50 KB  | 5 KB   |

## Coverage matrix

### Logic (`docs/reference/business-rules.md` section 11)

Suite = `tests/golden/logic/<suite>.json`, case ids after the colon.

| #   | Behaviour                                   | Golden                                                                                                                                 |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Linear grade, n = 1                         | grades: `linear-n1-*`, `calcGrade-sweep`                                                                                               |
| 2   | n-term bound lo1                            | grades: `nterm-lo1`, `calcGrade-sweep`                                                                                                 |
| 3   | n-term bound hi1                            | grades: `nterm-hi1`                                                                                                                    |
| 4   | n-term bounds lo2/hi2                       | grades: `nterm-lo2`, `nterm-hi2`                                                                                                       |
| 5   | n = 1.3 and spinner rounding                | grades: `nterm-1.3-*`; scoregrid: `nterm-spinner`                                                                                      |
| 6   | Full marks via bonus, Totaal `(+)`          | grades: `bonus-full-marks`; scoregrid: `grid-O0` row 0                                                                                 |
| 7   | Bonus partly compensating                   | grades: `bonus-partial`                                                                                                                |
| 8   | No entries                                  | grades: `empty-entries`                                                                                                                |
| 9   | All N                                       | grades: `all-N`, `all-N-string`                                                                                                        |
| 10  | Only a bonus question, N                    | grades: `only-bonus-N`                                                                                                                 |
| 11  | Only a diag question                        | grades: `only-diag`, `diag-and-normal`                                                                                                 |
| 12  | Only invalid values                         | grades: `only-invalid`, `invalid-plus-valid`, `negative-score`                                                                         |
| 13  | Partial entry                               | grades: `partial-entry`                                                                                                                |
| 14  | Only bonus/diag questions, with override    | grades: `only-bonus-diag-exam*`                                                                                                        |
| 15  | `max_points = 0`                            | grades: `max-points-0-*`; scoregrid: `normalizeScore-max-0`                                                                            |
| 16  | Decimal comma and odd input                 | scoregrid: `normalizeScore`; grades: `string-numbers`                                                                                  |
| 17  | Float accumulation                          | grades: `float-accumulation*`                                                                                                          |
| 18  | Rounding boundaries                         | display: `grade-boundaries`                                                                                                            |
| 19  | `isFail` at 5.45/5.46/5.5                   | display: `grade-boundaries`; stats: `gradeGroupIdx`                                                                                    |
| 20  | RTTI rounding                               | grades: `rtti-thirds`, `rtti-half-percent`                                                                                             |
| 21  | Override input                              | scoregrid: `parseGradeInput`, `sameOverride`                                                                                           |
| 22  | Override stale flag                         | grades: `override-*`; scoregrid: `grid-O0` gradeInfo                                                                                   |
| 23  | Override without scores                     | grades: `examResults-override-only`                                                                                                    |
| 24  | Resit worse than original                   | attempts: `student-1`, `computeBestGradeMap`; averages: `student-7` (group and profile)                                                |
| 25  | Resit tie                                   | attempts: `student-2`; averages: `student-6`                                                                                           |
| 26  | Override decides the best attempt           | attempts: `student-3`                                                                                                                  |
| 27  | Only the resit taken                        | attempts: `student-4`, `student-8`                                                                                                     |
| 28  | Original with null grade                    | attempts: `student-5`                                                                                                                  |
| 29  | Resit with another structure / n-term       | attempts: `student-6`; stats: `overview-summary`, `computeBestGradeStats`                                                              |
| 30  | Weighted year / SE averages                 | averages: `student-*` (`profileYearAvg`, `profilePtaAvg`, `groupYearAvg`), `examFamilies`, `dossierAverages`, `calcWeightedAvg-direct` |
| 31  | Score-grid summary rows vs overview         | scoregrid: `grid-O0`, `grid-O2`, `grid-one-row`; stats: `computeExamStats`                                                             |
| 32  | Histogram binning                           | stats: `makeHistBins`                                                                                                                  |
| 33  | Boxplot quartiles                           | stats: `boxStats`                                                                                                                      |
| 34  | Vraaganalyse with N and over-max            | stats: `overview-exam` (`qStats`, `qPcts`)                                                                                             |
| 35  | "Cijfer onder" threshold vs rounding        | opdrachten: `getOpdrachtAssignments` (students 1, 2, 6), `getOpdrachtAssignments-exact-boundary` (computed 5,45)                       |
| 36  | Card threshold input                        | scoregrid: `cijfer-onder-input`                                                                                                        |
| 37  | Coupling default vs saved                   | opdrachten: `getOpdrachtCoupling`, `getOpdrachtCijferCards`                                                                            |
| 38  | Same opdracht for two reasons               | opdrachten: `getOpdrachtAssignments` (students 3, 4)                                                                                   |
| 39  | Assignment sorting                          | opdrachten: `getOpdrachtAssignments` (order, student 4 last)                                                                           |
| 40  | `opdrachtMatchesExam` matrix                | opdrachten: `opdrachtMatchesExam-matrix`                                                                                               |
| 41  | Rapport inclusion                           | rapport: `compileRapport-exam-jaarlaag-3` (students 5, 6, 7, 8)                                                                        |
| 42  | Leeradvies bracket at 40/70, no I row       | rapport: `getScoreBracket`, `compileRapport-*`                                                                                         |
| 43  | Class average rounded before the percentage | rapport: `compileRapport-exam-jaarlaag-3` (`class_avg` 1.3 -> `class_pct` 43)                                                          |
| 44  | CSV parser                                  | csv: `parseCSV-*` (19 cases)                                                                                                           |
| 45  | Student CSV mapping                         | csv: `student-csv`, `student-csv-lowercase-comma`                                                                                      |
| 46  | `currentSchoolYear`                         | ids: `currentSchoolYear`                                                                                                               |
| 47  | `makeExamId`, `volgnummer`                  | ids: `makeExamId`, `makeGroupId`, `upsertExam-volgnummer-meta`                                                                         |
| 48  | Unknown `rtti` tag throws                   | grades: `unknown-rtti-tag`                                                                                                             |

Beyond section 11: group CSV and group assignment import (csv: `group-csv`,
`group-assignment-csv`, BR 9.3-9.4, quirk D34), score-file write format (score-writes:
`sequence`), exam warnings (stats: `computeExamWarnings`), colour scales (display), rapport
helpers (`sanitizeTypstMarkup`, `fmtNum`, `subjectDisplayName`, `scoreDotColor`), name and group
helpers (ids: `fullName`, `jaarlaagFromStamklas`, `sortStudents`, `group-name-parsing`).

### Storage and sync

`docs/specs/storage-spec.md` rows S01-S40 -> `tools/reference-shims/storage.test.mjs` (one test
per row, same id; rows are grouped by topic, not by number).

### Typst (`docs/reference/typst-contract.md` section 10)

Each case in `tests/golden/typst/<case>/` calls a real reference IPC handler on the `tiny` fixture
and stores `case.json` (call arguments, handler result with paths normalised to `<app>`, the
wrapper sources the handler wrote, PDF page count, page sizes and text per page via pdf.js, SVG page
facts) plus one 30 ppi PNG per page, rendered by the reference CLI from the recorded wrapper with
the reference arguments plus `--format png`. Batches with several jobs store text and page
structure only. `tests/golden/typst.test.mjs` checks in CI that the PNG hashes match and that every
recorded wrapper follows from the call arguments through the verbatim builders in
`tools/reference-shims/typst-wrappers.cjs`.

Regen needs the Typst packages `@preview/cetz:0.3.4`, `@preview/unify:0.8.0` and `oxifmt` in the
local package cache (`%LOCALAPPDATA%\typst\packages`), because the reference does not vendor them
(quirk T1); the script stops if they are missing, so Typst never downloads them silently. PNGs
depend on the fonts of the machine for emoji (quirk T2: Segoe UI Emoji on Windows), so regenerate
on Windows. PNGs use 30 ppi instead of the 110-144 ppi in typst-contract.md section 10, to keep the
repo small (size budget); Step 5 renders its own PNGs at the same 30 ppi for the comparison.

| #   | Candidate                                           | Golden case(s)                                                                 |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Base template, placeholder header, student mode     | `opdracht-base-template`, `opdracht-placeholder-pdf`                           |
| 2   | Base template, answers mode                         | `opdracht-base-template-answers`, `opdracht-grid-answers`                      |
| 3   | Header text injection, emoji observaties            | `opdracht-lib-features`, `opdracht-images-student`, `opdracht-grid-no-answers` |
| 4   | Empty observaties (quirk T19)                       | `opdracht-grid-no-answers`                                                     |
| 5   | lib.typ features, images (PNG, JPG, SVG)            | `opdracht-lib-features`, `opdracht-images-student`, `opdracht-zero-vragen`     |
| 6   | SVG preview, cursor marker, 10+ pages               | `svg-preview`, `svg-preview-cursor`, `svg-preview-many-pages`                  |
| 7   | Batch duplex, failing job                           | `batch-duplex`, `batch-answer-key`, `batch-error`                              |
| 8   | Rapport, one student                                | `rapport-one-student`                                                          |
| 9   | Rapport, class, override, markup in leeradvies      | `rapport-valid` (11 students, histogram, long and Typst-special names)         |
| 10  | Rapport edge cases                                  | `rapport-no-watermark` (T4), `rapport-tiny` (T26), `rapport-markup` (T27)      |
| 11  | Diagnostics name the opdracht file, not `_preview_` | `svg-preview-error`, `batch-error`                                             |

Multi-page opdrachten: `opdracht-long-odd` (3 pages), `batch-duplex` (long-even 4 pages).

### Not covered yet, on purpose

| Behaviour                                                                | Where it will be covered                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Legacy `migrate()`                                                       | Not ported (Step 1 decision); behaviour recorded in `data-files.md` |
| Grid interaction (numpad `.` -> `N`, typing, undo, paste)                | Step 3 Playwright smoke tests (UI behaviour, DOM-bound)             |
| Presence files (`users/<id>.json`), local session, photos                | Step 4 Rust tests against `data-files.md`                           |
| Opdracht image and `.typ` file IPC (list, save, import, copy, delete)    | Step 4 Rust tests                                                   |
| Rapport with a 3-page first section (footer still "/ 2", contract 10.10) | Step 5 parity tests                                                 |
