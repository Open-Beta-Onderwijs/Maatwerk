# Testing

Strategy and layers: PLAN.md section 5. This file holds the practical side: commands, the
golden format, harness assumptions, size budget and the **coverage matrix** (reference behaviour
-> tests), which the reviewer checks.

## Commands

| Command                                                 | Needs `_reference/` | What it does                                                                          |
| ------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `npm test`                                              | no                  | UI unit tests, tool tests, fixture determinism, storage spec, golden structure checks |
| `npm run golden:regen [-- <suite> ...]`                 | yes, at `0e30a70`   | Re-runs the reference code and rewrites `tests/golden/logic/*.json`                   |
| `npm run golden:check`                                  | yes                 | Re-runs the reference and fails on any byte difference                                |
| `node tests/reference-harness/make-shims.mjs`           | yes                 | Rewrites `tools/reference-shims/*.cjs` from the reference                             |
| `node tools/fixtures/generate.mjs <tiny\|school> <dir>` | no                  | Writes a synthetic data folder                                                        |

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
`{"$throws": "TypeError: ..."}` for an exception. A case named `data` holds the scenario's data
folder for the other cases of that suite. Consumers (Vitest in Step 3, Rust in Steps 4-5) must
decode these tags.

## Harness assumptions

These make runs deterministic. Each is a choice about the environment, not about the code:

| Assumption                                                      | Why                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Clock frozen at `2026-03-02T10:00:00` local (`environment.mjs`) | `_meta` timestamps, `currentSchoolYear()`                                |
| `TZ=Europe/Amsterdam`                                           | The school year turns over on 1 August local time                        |
| `localeCompare` without a locale collates as `nl-NL`            | The app runs on Dutch Windows; Node's default locale depends on the host |
| IPC arguments and results pass through `structuredClone`        | Same as Electron IPC                                                     |
| `app.whenReady()` never resolves                                | No seeding, watcher or window during tests                               |
| Admin-only flows run after `Store.loadYear(year, null)`         | The admin view loads all groups (group-assignment CSV import)            |

## Size budget

| Area                     | Budget | Now    |
| ------------------------ | ------ | ------ |
| `tests/golden/logic/`    | 1 MB   | 468 KB |
| Typst goldens (Step 2b)  | 5 MB   | -      |
| `tools/fixtures/assets/` | 50 KB  | 5 KB   |

## Coverage matrix

### Logic (`docs/reference/business-rules.md` section 11)

Suite = `tests/golden/logic/<suite>.json`, case ids after the colon.

| #   | Behaviour                                   | Golden                                                                        |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Linear grade, n = 1                         | grades: `linear-n1-*`, `calcGrade-sweep`                                      |
| 2   | n-term bound lo1                            | grades: `nterm-lo1`, `calcGrade-sweep`                                        |
| 3   | n-term bound hi1                            | grades: `nterm-hi1`                                                           |
| 4   | n-term bounds lo2/hi2                       | grades: `nterm-lo2`, `nterm-hi2`                                              |
| 5   | n = 1.3 and spinner rounding                | grades: `nterm-1.3-*`; scoregrid: `nterm-spinner`                             |
| 6   | Full marks via bonus, Totaal `(+)`          | grades: `bonus-full-marks`; scoregrid: `grid-O0` row 0                        |
| 7   | Bonus partly compensating                   | grades: `bonus-partial`                                                       |
| 8   | No entries                                  | grades: `empty-entries`                                                       |
| 9   | All N                                       | grades: `all-N`, `all-N-string`                                               |
| 10  | Only a bonus question, N                    | grades: `only-bonus-N`                                                        |
| 11  | Only a diag question                        | grades: `only-diag`, `diag-and-normal`                                        |
| 12  | Only invalid values                         | grades: `only-invalid`, `invalid-plus-valid`, `negative-score`                |
| 13  | Partial entry                               | grades: `partial-entry`                                                       |
| 14  | Only bonus/diag questions, with override    | grades: `only-bonus-diag-exam*`                                               |
| 15  | `max_points = 0`                            | grades: `max-points-0-*`; scoregrid: `normalizeScore-max-0`                   |
| 16  | Decimal comma and odd input                 | scoregrid: `normalizeScore`; grades: `string-numbers`                         |
| 17  | Float accumulation                          | grades: `float-accumulation*`                                                 |
| 18  | Rounding boundaries                         | display: `grade-boundaries`                                                   |
| 19  | `isFail` at 5.45/5.46/5.5                   | display: `grade-boundaries`; stats: `gradeGroupIdx`                           |
| 20  | RTTI rounding                               | grades: `rtti-thirds`, `rtti-half-percent`                                    |
| 21  | Override input                              | scoregrid: `parseGradeInput`, `sameOverride`                                  |
| 22  | Override stale flag                         | grades: `override-*`; scoregrid: `grid-O0` gradeInfo                          |
| 23  | Override without scores                     | grades: `examResults-override-only`                                           |
| 24  | Resit worse than original                   | attempts: `student-1`, `computeBestGradeMap`                                  |
| 25  | Resit tie                                   | attempts: `student-2`                                                         |
| 26  | Override decides the best attempt           | attempts: `student-3`                                                         |
| 27  | Only the resit taken                        | attempts: `student-4`, `student-8`                                            |
| 28  | Original with null grade                    | attempts: `student-5`                                                         |
| 29  | Resit with another structure / n-term       | attempts: `student-6`; stats: `overview-summary`, `computeBestGradeStats`     |
| 30  | Weighted year / SE averages                 | averages: `student-*`, `calcWeightedAvg-direct`, `dossierAverages`            |
| 31  | Score-grid summary rows vs overview         | scoregrid: `grid-O0`, `grid-O2`, `grid-one-row`; stats: `computeExamStats`    |
| 32  | Histogram binning                           | stats: `makeHistBins`                                                         |
| 33  | Boxplot quartiles                           | stats: `boxStats`                                                             |
| 34  | Vraaganalyse with N and over-max            | stats: `overview-exam` (`qStats`, `qPcts`)                                    |
| 35  | "Cijfer onder" threshold vs rounding        | opdrachten: `getOpdrachtAssignments` (students 1, 2, 6)                       |
| 36  | Card threshold input                        | scoregrid: `cijfer-onder-input`                                               |
| 37  | Coupling default vs saved                   | opdrachten: `getOpdrachtCoupling`, `getOpdrachtCijferCards`                   |
| 38  | Same opdracht for two reasons               | opdrachten: `getOpdrachtAssignments` (students 3, 4)                          |
| 39  | Assignment sorting                          | opdrachten: `getOpdrachtAssignments` (order, student 4 last)                  |
| 40  | `opdrachtMatchesExam` matrix                | opdrachten: `opdrachtMatchesExam-matrix`                                      |
| 41  | Rapport inclusion                           | rapport: `compileRapport-exam-jaarlaag-3` (students 5, 6, 7, 8)               |
| 42  | Leeradvies bracket at 40/70, no I row       | rapport: `getScoreBracket`, `compileRapport-*`                                |
| 43  | Class average rounded before the percentage | rapport: `compileRapport-exam-jaarlaag-3` (`class_avg` 1.3 -> `class_pct` 43) |
| 44  | CSV parser                                  | csv: `parseCSV-*` (19 cases)                                                  |
| 45  | Student CSV mapping                         | csv: `student-csv`, `student-csv-lowercase-comma`                             |
| 46  | `currentSchoolYear`                         | ids: `currentSchoolYear`                                                      |
| 47  | `makeExamId`, `volgnummer`                  | ids: `makeExamId`, `makeGroupId`, `upsertExam-volgnummer-meta`                |
| 48  | Unknown `rtti` tag throws                   | grades: `unknown-rtti-tag`                                                    |

Beyond section 11: group CSV and group assignment import (csv: `group-csv`,
`group-assignment-csv`, BR 9.3-9.4, quirk D34), score-file write format (score-writes:
`sequence`), exam warnings (stats: `computeExamWarnings`), colour scales (display), rapport
helpers (`sanitizeTypstMarkup`, `fmtNum`, `subjectDisplayName`, `scoreDotColor`), name and group
helpers (ids: `fullName`, `jaarlaagFromStamklas`, `sortStudents`, `group-name-parsing`).

### Storage and sync

`docs/specs/storage-spec.md` rows S01-S36 -> `tools/reference-shims/storage.test.mjs` (one test
per row, same id).

### Not covered yet, on purpose

| Behaviour                                                    | Where it will be covered                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Typst output (rapport, opdracht, SVG preview, batch, duplex) | Step 2b (`tests/golden/typst/`)                                     |
| Legacy `migrate()`                                           | Not ported (Step 1 decision); behaviour recorded in `data-files.md` |
| Grid interaction (numpad `.` -> `N`, typing, undo, paste)    | Step 3 Playwright smoke tests (UI behaviour, DOM-bound)             |
| Presence files (`users/<id>.json`), local session, photos    | Step 4 Rust tests against `data-files.md`                           |
| Opdracht images and `.typ` file IPC                          | Step 2b (Typst) and Step 4                                          |
