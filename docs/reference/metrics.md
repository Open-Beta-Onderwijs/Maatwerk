# Reference metrics (architecture review input)

Source: `_reference/` (Electron app, version 0.1.6). Measured 2026-10-25.
Tools (throwaway, in the Step 1 session scratchpad `metrics-tools/`, nothing added to the repo): ESLint 9 with
`complexity` (max 10), `max-lines-per-function` (max 1, i.e. report every function, blank lines and
comments included) and `max-depth` (4), config `metrics-tools/eslint.config.mjs`; jscpd 4
(`--min-lines 5 --min-tokens 50 --max-lines 100000 --max-size 5mb`); custom espree script
`metrics-tools/tpl.js` for HTML template interpolations. `scc` is not installed. Raw outputs:
`metrics-tools/eslint.json`, `metrics-tools/jscpd/jscpd-report.json`, `metrics-tools/tpl.txt`.

## 1. Lines per file

Total (app sources below, excluding vendored Typst packages, fonts, binaries, lockfile): **22,569 lines**,
of which JS ≈ 17,100, CSS 2,936, HTML 1,547, Typst 987.

| File                                            | Lines | Blank | Comment-ish |
| ----------------------------------------------- | ----: | ----: | ----------: |
| `renderer/style.css`                            |  2936 |   128 |         106 |
| `renderer/editor-init.js`                       |  1684 |   187 |         123 |
| `renderer/store.js`                             |  1594 |   145 |         143 |
| `renderer/screens/scores.js`                    |  1578 |   116 |         152 |
| `renderer/modals/toets-overzicht.js`            |  1287 |    56 |          42 |
| `renderer/modals/profiel.js`                    |  1154 |    43 |          34 |
| `renderer/app.js`                               |  1105 |   110 |         102 |
| `main.js`                                       |  1025 |    92 |         131 |
| `renderer/editor.html` (≈ 990 lines inline CSS) |  1008 |    92 |          21 |
| `renderer/modals/toets-edit.js`                 |   759 |    33 |          14 |
| `renderer/modals/rapport.js`                    |   753 |    85 |          45 |
| `include/templates/rtti_export.typ`             |   675 |    85 |          85 |
| `renderer/modals/groep-edit.js`                 |   660 |    59 |           9 |
| `renderer/screens/toetsen.js`                   |   636 |    54 |          35 |
| `renderer/modals/opdrachten-genereren.js`       |   539 |    42 |          26 |
| `renderer/screens/observaties.js`               |   386 |    25 |          15 |
| `renderer/screens/opdrachten.js`                |   381 |    41 |          14 |
| `renderer/modals/groep-leerlingen.js`           |   349 |    26 |          17 |
| `renderer/index.html`                           |   316 |    12 |           0 |
| `renderer/pdf-viewer.js`                        |   286 |    37 |          26 |
| `renderer/modals/leerling-edit.js`              |   278 |    11 |           4 |
| `renderer/screens/school.js`                    |   275 |    37 |          11 |
| `renderer/modals/herkansing.js`                 |   274 |    12 |           6 |
| `renderer/screens/groepen.js`                   |   273 |    30 |          13 |
| `sync.js`                                       |   270 |    21 |          24 |
| `include/templates/lib.typ`                     |   269 |    26 |          48 |
| `renderer/screens/gebruikers.js`                |   251 |    25 |           5 |
| `renderer/pdf-viewer.html`                      |   223 |    16 |           7 |
| `renderer/screens/leerlingen.js`                |   213 |    22 |          12 |
| `renderer/presence.js`                          |   190 |    21 |          31 |
| `renderer/custom-select.js`                     |   177 |    27 |          24 |
| `preload.js`                                    |   123 |    27 |          44 |
| `renderer/screens/startup.js`                   |   123 |    17 |           4 |
| `renderer/utils/csv.js`                         |   110 |     5 |           9 |
| `renderer/modals/editor.js`                     |   106 |    10 |          10 |
| `renderer/sync.js`                              |    59 |     5 |          18 |
| `renderer/utils/colors.js`                      |    58 |     7 |           7 |
| `renderer/utils/spinners.js`                    |    57 |     5 |           7 |
| `renderer/utils/grades.js`                      |    56 |     7 |           6 |
| `include/templates/base_assignment.typ`         |    43 |     8 |           8 |
| `renderer/utils/icons.js`                       |    30 |     2 |           3 |

Renderer files > 1000 lines: 6 JS (`editor-init.js`, `store.js`, `scores.js`, `toets-overzicht.js`,
`profiel.js`, `app.js`) + `style.css` + `editor.html`; `main.js` (1025) is the 7th JS file over 1000.

## 2. Longest functions (ESLint `max-lines-per-function`, physical lines)

1,223 functions in total; 105 are longer than 50 lines, 47 longer than 100. Nested callbacks count
inside their parent too. The `Store` IIFE (`store.js:28`, 1,567 lines) is the module wrapper and is
left out.

|   # | Function                                      | Location                                 | Lines | Note                                                      |
| --: | --------------------------------------------- | ---------------------------------------- | ----: | --------------------------------------------------------- |
|   1 | `openExamOverviewModal`                       | `renderer/modals/toets-overzicht.js:32`  |  1256 | whole modal; complexity 80                                |
|   2 | `openProfielModal`                            | `renderer/modals/profiel.js:46`          |  1109 | whole modal; complexity 30                                |
|   3 | (anonymous `onShow` arrow)                    | `renderer/modals/profiel.js:205`         |   947 | nested in #2                                              |
|   4 | (anonymous arrow)                             | `renderer/modals/profiel.js:238`         |   912 | nested in #3                                              |
|   5 | (anonymous `onShow` arrow)                    | `renderer/modals/toets-overzicht.js:419` |   866 | nested in #1                                              |
|   6 | `createGroupHOT`                              | `renderer/screens/scores.js:730`         |   849 | the Handsontable grid incl. renderers, hooks, key handler |
|   7 | `openGroupModal`                              | `renderer/modals/groep-edit.js:17`       |   401 |                                                           |
|   8 | `showExamEditor`                              | `renderer/modals/toets-edit.js:359`      |   381 | complexity 31                                             |
|   9 | `initCijferverloop`                           | `renderer/modals/profiel.js:473`         |   371 |                                                           |
|  10 | `openGroupStudentsModal`                      | `renderer/modals/groep-leerlingen.js:22` |   328 |                                                           |
|  11 | `renderToetsenList`                           | `renderer/screens/toetsen.js:170`        |   294 | complexity 27                                             |
|  12 | `openExamModal`                               | `renderer/modals/toets-edit.js:18`       |   284 |                                                           |
|  13 | `initAnalyse`                                 | `renderer/modals/profiel.js:847`         |   276 |                                                           |
|  14 | `initRttiAnalyse`                             | `renderer/modals/toets-overzicht.js:855` |   258 |                                                           |
|  15 | (anonymous arrow)                             | `renderer/modals/toets-edit.js:492`      |   245 | nested in #8                                              |
|  16 | `openOpdrachtenModal`                         | `renderer/screens/opdrachten.js:163`     |   219 |                                                           |
|  17 | `openRttiUitlegModal`                         | `renderer/modals/rapport.js:538`         |   216 |                                                           |
|  18 | (anonymous async arrow)                       | `renderer/modals/profiel.js:632`         |   211 | complexity 19                                             |
|  19 | (anonymous arrow)                             | `renderer/modals/groep-edit.js:210`      |   205 | nested in #7                                              |
|  20 | `openObsModal`                                | `renderer/screens/observaties.js:196`    |   191 |                                                           |
|   — | `createWatcher`                               | `sync.js:85`                             |   184 | longest in the main process                               |
|   — | `openScoreModal`                              | `renderer/screens/scores.js:137`         |   164 |                                                           |
|   — | `token` (Typst tokenizer)                     | `renderer/editor-init.js:91`             |   122 | complexity 35                                             |
|   — | `applyExternalChange`                         | `renderer/store.js:1399`                 |    97 |                                                           |
|   — | `ipcMain.handle('app:renderAssignmentBatch')` | `main.js:827`                            |    91 | longest in `main.js`; complexity 18                       |

## 3. Cyclomatic complexity hot-spots (ESLint `complexity` > 10)

67 functions exceed 10; 14 exceed 20. Per file: `store.js` 10, `scores.js` 9, `profiel.js` 5,
`editor-init.js` 4, `toets-edit.js` 4, 3 each in `toets-overzicht.js`, `groep-edit.js`,
`gebruikers.js`, `opdrachten-genereren.js`, `app.js`; `main.js` 2. `max-depth` > 4 only in
`toets-overzicht.js:112,114,1029,1031`.

| Complexity | Function                                                                  | Location                                          |
| ---------: | ------------------------------------------------------------------------- | ------------------------------------------------- |
|         80 | `openExamOverviewModal`                                                   | `renderer/modals/toets-overzicht.js:32`           |
|         50 | capture-phase keydown handler of the grid                                 | `renderer/screens/scores.js:1455`                 |
|         45 | `cursorMarkerPos`                                                         | `renderer/editor-init.js:379`                     |
|         45 | `migrateLegacyToPerYear`                                                  | `renderer/store.js:828`                           |
|         35 | `token` (Typst StreamLanguage)                                            | `renderer/editor-init.js:91`                      |
|         31 | `showExamEditor`                                                          | `renderer/modals/toets-edit.js:359`               |
|         30 | `openProfielModal`                                                        | `renderer/modals/profiel.js:46`                   |
|         29 | async arrow in `applyExternalChange`                                      | `renderer/store.js:1416`                          |
|         27 | async arrow (save handler)                                                | `renderer/modals/groep-edit.js:312`               |
|         27 | arrow (results table row)                                                 | `renderer/modals/toets-overzicht.js:216`          |
|         27 | `renderToetsenList`                                                       | `renderer/screens/toetsen.js:170`                 |
|         23 | `renderStudentList`                                                       | `renderer/screens/leerlingen.js:65`               |
|         21 | `renderGroepenForYear`                                                    | `renderer/screens/groepen.js:67`                  |
|         21 | `migrateToPerSubject`                                                     | `renderer/store.js:915`                           |
|         20 | `compileRapport`                                                          | `renderer/modals/rapport.js:174`                  |
|         20 | `applyRemoteRecord`                                                       | `renderer/screens/scores.js:793`                  |
|         20 | `calcResults`                                                             | `renderer/store.js:662`                           |
|         20 | `getOpdrachtAssignments`                                                  | `renderer/store.js:1295`                          |
|         19 | `openGroupModal` / `openUserModal`                                        | `groep-edit.js:17` / `gebruikers.js:112`          |
|         18 | `renderAssignmentBatch` handler / `loadScoreGrid` / `recomputeSummaryRow` | `main.js:827` / `scores.js:411` / `scores.js:595` |
|         17 | `afterChange` (grid)                                                      | `renderer/screens/scores.js:1360`                 |

## 4. Duplicated code (jscpd)

Overall 2.17 % duplicated lines (500 of 23,019; 47 clones). JS 2.55 % (436 lines, 43 clones), markup
4.14 % (64 lines, 4 clones), CSS 0 %. Note: jscpd's defaults skip files > 1000 lines; with them
skipped the figure would have been 1.6 %.

Main clusters:

1. **Chart.js configuration blocks** (largest cluster): `profiel.js:560-587 ↔ 786-813` (28 lines),
   `profiel.js:438-452 ↔ 549-566`, and within `toets-overzicht.js` (`919-937 ↔ 996-1014`,
   `1137-1198 ↔ 1224-1242`, `980-996 ↔ 1069-1085`, `1137-1154 ↔ 1180-1196`, `737-751 ↔ 834-849`,
   `904-… ↔ 1209-1224`, `922-937 ↔ 1098-1111`, `427-456 ↔ 449-455/473-480/496-503`), plus
   cross-file `profiel.js ↔ toets-overzicht.js` (`895-906 ↔ 857-868`, `1073-1084 ↔ 434-445`,
   `1125-1135 ↔ 1243-1253`, `964-973 ↔ 1077-1086`, `856-863 ↔ 870-877`). Repeated options objects
   (scales, legend, annotation pass line, tooltips): ≈ 250 duplicated lines in these two files.
2. **Typst compile + temp wrapper** in `main.js`: `586-604 ↔ 705-723` (19 lines; rapport vs
   opdracht PDF: write wrapper, `execFile(typst, compileArgs, --root appDir)`, unlink), and
   `185-192 ↔ 195-201` (lock handling in `fs:deleteFile`).
3. **List filtering (schoolsoort / jaarlaag / WI subcategory)**: `leerlingen.js:85-103 ↔
observaties.js:105-124` (19 lines); `groepen.js:81-88 ↔ toetsen.js:175-182`; `groepen.js:35-40 ↔
toetsen.js:50-55` (year select setup); `observaties.js:217-239 ↔ opdrachten.js:20-33,182-188`
   (toggle-button builders). The WI jaarlaag mapping also exists as `matchesJaarlaagFilter`
   (`app.js:498-510`) but `leerlingen.js:87-103` re-implements it.
4. **Exam/resit editor pieces**: `herkansing.js:95-104 ↔ toets-edit.js:207-216` (structure
   CustomSelect), `herkansing.js:129-138 ↔ toets-edit.js:268-277` (question generation),
   `herkansing.js:220-225 ↔ toets-edit.js:198-202`, `toets-edit.js:197-205 ↔ 530-537`.
5. **CSV import scaffolding**: `groep-edit.js:449-456, 574-583 ↔ leerling-edit.js:195-204`
   (`getConfig` → `askSchoolYear` → preview), `groep-leerlingen.js:14-22 ↔ leerling-edit.js:19-27`.
6. **Group statistics**: `groep-leerlingen.js:40-46, 74-82 ↔ groepen.js:209-215, 227-235`;
   `groep-leerlingen.js:64-70 ↔ profiel.js:671-677`.
7. **Best-attempt resolution**: `store.js:1101-1111 ↔ 1119-1129` (calcResults comparison).
8. **Score grid**: `scores.js:570-576 ↔ 622-628` (clearing result columns), `1091-1096 ↔ 1102-1107`
   (renderers), `1434-1440 ↔ 1455-1462` (selection preamble of key handlers).
9. **Markup**: the same filter funnel `<svg>` icon is inlined 5 times in `index.html:58-74, 86-102,
115-131, 144-160, 173-189`.

## 5. `innerHTML` / `insertAdjacentHTML` / `outerHTML`

81 direct `innerHTML` assignments in 19 files; **0** `insertAdjacentHTML`, **0** `outerHTML`.
On top of that every modal body goes through `showModal(html)` → `modalContent.innerHTML = html`
(`app.js:122`; 20 call sites), and the score grid's HTML column headers are rendered by Handsontable
(`scores.js:878-925`).

| File                                                                                                                               | Direct sites |
| ---------------------------------------------------------------------------------------------------------------------------------- | -----------: |
| `renderer/app.js`                                                                                                                  |           12 |
| `renderer/editor-init.js`                                                                                                          |           10 |
| `renderer/screens/scores.js`                                                                                                       |            8 |
| `renderer/modals/opdrachten-genereren.js`                                                                                          |            8 |
| `renderer/screens/school.js`                                                                                                       |            6 |
| `renderer/screens/toetsen.js`                                                                                                      |            5 |
| `renderer/modals/rapport.js`                                                                                                       |            5 |
| `renderer/screens/opdrachten.js`                                                                                                   |            4 |
| `renderer/screens/groepen.js`, `renderer/modals/groep-edit.js`, `renderer/custom-select.js`                                        |       3 each |
| `renderer/screens/observaties.js`, `leerlingen.js`, `gebruikers.js`, `modals/toets-overzicht.js`, `profiel.js`, `leerling-edit.js` |       2 each |
| `renderer/screens/startup.js`, `renderer/modals/toets-edit.js`                                                                     |       1 each |

Escape helpers: `escHtml` (`app.js:355-361`, escapes `& < > "` but **not `'`**; no attribute in the
code uses single quotes, so this is currently harmless), `escHtmlCS` (`custom-select.js:175`, a copy
for the classic script), `esc` (`editor-init.js:1176`, editor iframe). Most interpolations of
user/teacher data use `escHtml` (exam titles, names, group names, observatie names/icons, school
fields, CSV previews, error messages). The espree scan found 336 non-escaped interpolations in
HTML-building template literals; after review almost all are app constants, numbers, booleans,
pre-built HTML fragments or `ICONS` SVG. The ones that carry user-controlled data **without**
escaping (19 interpolations on 17 lines):

| `file:line`                             | Data                                                                              | Source of the data                                                                | Effect                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `modals/rapport.js:446`                 | `data.uitleg[cat]` inside `<textarea>`                                            | `templates/RTTI explanations and advices/rtti_expl_adv_*.json`, typed by teachers | `&lt;`/`&amp;` typed by a teacher are decoded on the next open and saved back as `<`/`&`; text containing `</textarea>` breaks the form |
| `modals/rapport.js:455-457`             | `data.leeradvies[cat].laag/midden/hoog` in `<textarea>`                           | same file                                                                         | same                                                                                                                                    |
| `screens/startup.js:28`                 | `user.foto` in `data-foto="…"`                                                    | `gebruikers.json`                                                                 | attribute break-out                                                                                                                     |
| `screens/startup.js:30-31`              | `user.id` in `data-user-id`, `user.kleur` in `style`                              | `gebruikers.json`                                                                 | attribute break-out / CSS injection                                                                                                     |
| `screens/startup.js:32-33`              | initials (`afkorting` or first letters of names), `user.voornaam` as element text | `gebruikers.json` (admin-typed)                                                   | a name with `<`/`&` renders wrong / injects markup on the login screen                                                                  |
| `screens/gebruikers.js:48`              | `user.kleur` in `style`                                                           | `gebruikers.json` (color input, but file is shared and editable)                  | CSS injection                                                                                                                           |
| `modals/groep-leerlingen.js:182`        | `fromExam.description` in `title="…"`                                             | exam JSON (teacher-typed resit description)                                       | a `"` breaks the attribute                                                                                                              |
| `screens/leerlingen.js:154,156,163,164` | `s.id` in `data-id` and as text                                                   | `students-<year>.json` (CSV import does `Number(...)`, `leerling-edit.js:254`)    | low (numeric in practice)                                                                                                               |
| `modals/groep-edit.js:107,113`          | `s.id` in `data-student-id`                                                       | same                                                                              | low                                                                                                                                     |
| `screens/observaties.js:170`            | `o.schoolsoort.join`, `o.jaarlagen.join` as text                                  | observatie JSON                                                                   | low (values come from fixed toggle lists)                                                                                               |

Also unescaped but app-generated: `q.number` in grid headers (`scores.js:888,896`; numbers or
letters set in `toets-edit.js:343-353`), and the Typst SVG preview (`editor-init.js:568`,
`pageEl.innerHTML = svg`; compiler output). Mitigation in place: the CSP (`script-src 'self'
https://cdn.jsdelivr.net`, no `'unsafe-inline'`) stops inline handlers and inline scripts, so these
holes cause markup injection and data corruption rather than script execution.

## 6. CDN / remote resources

All loaded at runtime from the internet; no Subresource Integrity attributes anywhere; the app does
not work offline (no grid, no charts, no editor, no PDF viewer).

| Resource                  | Exact URL                                                                                            | Version                                 | Loaded in                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Handsontable CSS          | `https://cdn.jsdelivr.net/npm/handsontable@14.3.0/dist/handsontable.full.min.css`                    | 14.3.0 (pinned)                         | `index.html:10-13`                                    |
| Handsontable JS           | `https://cdn.jsdelivr.net/npm/handsontable@14.3.0/dist/handsontable.full.min.js`                     | 14.3.0                                  | `index.html:308`                                      |
| Chart.js                  | `https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js`                                  | 4.4.2                                   | `index.html:309`                                      |
| chartjs-plugin-annotation | `https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js` | 3.0.1                                   | `index.html:310`                                      |
| CodeMirror state          | `https://esm.sh/@codemirror/state@6`                                                                 | **major only** (resolves to latest 6.x) | `editor-init.js:14`                                   |
| CodeMirror view           | `https://esm.sh/@codemirror/view@6`                                                                  | major only                              | `editor-init.js:24`                                   |
| CodeMirror commands       | `https://esm.sh/@codemirror/commands@6`                                                              | major only                              | `editor-init.js:31`                                   |
| CodeMirror language       | `https://esm.sh/@codemirror/language@6`                                                              | major only                              | `editor-init.js:38`                                   |
| Lezer highlight           | `https://esm.sh/@lezer/highlight@1`                                                                  | major only                              | `editor-init.js:39`                                   |
| pdf.js                    | `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.min.mjs`                                  | 4.9.155                                 | `pdf-viewer.js:1`                                     |
| pdf.js worker             | `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs`                           | 4.9.155                                 | `pdf-viewer.js:3-4` (`GlobalWorkerOptions.workerSrc`) |

Fonts: none remote. `style.css` has no `@import`/`url(http…)`; UI uses system fonts; Typst fonts are
local (`include/fonts`, passed with `--font-path`). Typst packages are vendored
(`include/packages/preview/zero/0.7.1`). CSP allow-lists: `index.html:5-8` (jsdelivr),
`editor.html:5-8` (esm.sh scripts/connect, jsdelivr styles), `pdf-viewer.html:5-8` (jsdelivr scripts,
worker, connect).

## 7. Dependencies and licences (target: AGPL-3.0)

| Dependency                                                                                                                                                                        | Version                  | How used                                                                                                                                                                             | Licence                                                                                                                                                                                | AGPL-3.0 compatible?                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `docx` (dependency)                                                                                                                                                               | 8.5.0                    | **unused**: no `require('docx')`/import anywhere in `main.js`, `preload.js`, `sync.js`, `renderer/` (grep: 0 hits in code; CLAUDE.md says "still listed in dependencies but unused") | MIT                                                                                                                                                                                    | yes, but drop it                                                                                                                          |
| ↳ transitive: `jszip` 3.10.1 `(MIT OR GPL-3.0-or-later)`, `xml-js` MIT, `xml` MIT, `sax` 1.5.0 BlueOak-1.0.0, `nanoid` MIT, `readable-stream` etc. MIT/ISC, `pako` (MIT AND Zlib) |                          |                                                                                                                                                                                      | permissive                                                                                                                                                                             | yes (gone with `docx`)                                                                                                                    |
| `pdf-lib` (dependency)                                                                                                                                                            | 1.17.1                   | main process PDF merge (`main.js:6`)                                                                                                                                                 | MIT                                                                                                                                                                                    | yes                                                                                                                                       |
| ↳ `@pdf-lib/standard-fonts` 1.0.0, `@pdf-lib/upng` 1.0.1 MIT, `pako` (MIT AND Zlib), `tslib` 1.14.1 0BSD                                                                          |                          |                                                                                                                                                                                      | permissive                                                                                                                                                                             | yes                                                                                                                                       |
| `electron` (dev)                                                                                                                                                                  | 40.8.3                   | runtime                                                                                                                                                                              | MIT (+ Chromium BSD-style)                                                                                                                                                             | yes (goes away with Tauri)                                                                                                                |
| `electron-builder` (dev)                                                                                                                                                          | 26.8.1                   | packaging                                                                                                                                                                            | MIT                                                                                                                                                                                    | n/a (build tool)                                                                                                                          |
| `husky` (dev)                                                                                                                                                                     | 9.1.7                    | git hooks                                                                                                                                                                            | MIT                                                                                                                                                                                    | n/a                                                                                                                                       |
| `lint-staged` (dev)                                                                                                                                                               | 16.4.0                   | git hooks                                                                                                                                                                            | MIT                                                                                                                                                                                    | n/a                                                                                                                                       |
| `prettier` (dev)                                                                                                                                                                  | 3.8.1                    | formatting                                                                                                                                                                           | MIT                                                                                                                                                                                    | n/a                                                                                                                                       |
| Handsontable (CDN)                                                                                                                                                                | 14.3.0                   | score grid                                                                                                                                                                           | **Proprietary** "Handsontable Software License" since v7; used with `licenseKey: 'non-commercial-and-evaluation'` (`scores.js:1254`), which permits only evaluation/non-commercial use | **no**: not open source; cannot be shipped in (or required by) an AGPL app. Replacement needed (PLAN Step 3b). Last MIT version is 6.2.2. |
| Chart.js (CDN)                                                                                                                                                                    | 4.4.2                    | charts                                                                                                                                                                               | MIT                                                                                                                                                                                    | yes                                                                                                                                       |
| chartjs-plugin-annotation (CDN)                                                                                                                                                   | 3.0.1                    | pass line etc.                                                                                                                                                                       | MIT                                                                                                                                                                                    | yes                                                                                                                                       |
| CodeMirror 6 packages (CDN)                                                                                                                                                       | 6.x (unpinned)           | Typst editor                                                                                                                                                                         | MIT                                                                                                                                                                                    | yes                                                                                                                                       |
| @lezer/highlight (CDN)                                                                                                                                                            | 1.x                      | editor                                                                                                                                                                               | MIT                                                                                                                                                                                    | yes                                                                                                                                       |
| pdfjs-dist (CDN)                                                                                                                                                                  | 4.9.155                  | PDF viewer                                                                                                                                                                           | Apache-2.0                                                                                                                                                                             | yes (Apache-2.0 is GPLv3/AGPLv3-compatible)                                                                                               |
| Typst CLI (bundled binary, `bin/typst/…`)                                                                                                                                         | not recorded in the repo | PDF/SVG compile                                                                                                                                                                      | Apache-2.0                                                                                                                                                                             | yes (ship its licence and NOTICE)                                                                                                         |
| Typst package `zero` (vendored)                                                                                                                                                   | 0.7.1                    | number formatting in `lib.typ`                                                                                                                                                       | MIT (`typst.toml`)                                                                                                                                                                     | yes                                                                                                                                       |
| Source Serif 4, STIX Two Math (bundled fonts)                                                                                                                                     | —                        | Typst output                                                                                                                                                                         | SIL OFL 1.1 (`include/fonts/OFL-*.{md,txt}`)                                                                                                                                           | yes (fonts; keep OFL text)                                                                                                                |

## 8. Handsontable score grid: features a replacement must preserve

All in `renderer/screens/scores.js`. One grid per group (`loadScoreGrid`, `:411-517`), each in its
own section with an `<h3>` (`:440-443`), all in the score modal (`openScoreModal`, `:137-300`).

Layout and data

1. Column layout: `#`, Naam, one column per question, spacer, one checkbox column per observatie +
   spacer, Totaal, Cijfer, spacer, R%, T1%, T2%, I% (`:25-38, 1256-1276`); fixed pixel widths per
   column (72/150/32/20/28/72/52/44, `:1257-1274`); `height: 'auto'`, `rowHeaders: false`
   (`:1252-1253`).
2. Data is an array of arrays (`gridData`), mutated in place by the app (`:445-497`); two summary rows
   at the bottom with sentinels `__avg__` / `__std__` ("Gemiddelde", "Standaarddeviatie",
   `:484-485`), recomputed on every change (`recomputeSummaryRow`, `:595-652`).
3. Derived columns recomputed per row (`recomputeRow`, `:536-593`) via `Store.calcResults`.
4. HTML column headers: per question RTTI tag / points / section / number stacked (`:878-898`), bonus
   and diag headers grey/italic with tooltip (`:882-890`), observatie headers = icon with `title`
   "naam (Fn)" (`:900-909`); `afterGetColHeader` bottom-aligns, left-aligns Naam, tints bonus/diag
   headers (`:1342-1354`).
5. No fixed (frozen) rows or columns are used (`fixedRowsTop`/`fixedColumnsStart` absent); the
   modal scrolls the grids (CLAUDE.md "only the grids scroll"). The grid is centred and its section
   width set to the table width, then `refreshDimensions()` (`:509-515`).

Editing and validation

6. Editable cells via `cells(row, col)`: question cells, the Cijfer column, observatie cells; summary
   rows and everything else read-only (`:1277-1288`); per-column `readOnly` (`:1257-1274`).
7. Text editor (`type: 'text'`) for scores; input normalisation (`normalizeScore`, `:677-684`):
   empty → removed, `N`/`n` → null ("niet gemaakt"), number 0…max → number, anything else kept as
   typed and flagged.
8. **Decimal comma**: input accepts `,` or `.` (`parseScoreNum`, `:655-657`), display always with a
   comma (`scoreCellText`, `:658-660`); grades formatted with a comma (`formatGrade`).
9. Validation without HOT validators: invalid cells red/white/bold (`:1194-1201`), row status
   `invalid`/`partial`/`ok` (`computeRowStatus`, `:929-947`) colours the # and Naam cells red / yellow
   / blue for an overwritten grade (`rowBackground`, `:1083-1089`); invalid input is still saved as
   the raw string and raises a persistent error toast (`:1414-1419`).
10. **'N' entry**: typing `N`, or numpad `.` when the ". → N" checkbox is on (default; session-wide,
    `:51-53, 161-164, 195-197`), writes `N` even while the editor is open (cancels the edit,
    `:1464-1470`).
11. Grade override in the Cijfer column: typed grade 1,0–10,0 rounded to one decimal
    (`parseGradeInput`, `:663-667`; `gradeTyped`, `:1025-1051`), empty restores, invalid → error toast;
    blue border classes `grade-override` / `grade-override-stale` and a multi-line tooltip
    (`:1133-1143`); right-click context menu "Berekend cijfer herstellen" / "Waarschuwing negeren"
    (`:1054-1077`, menu `:688-728`).
12. Observatie cells: custom renderer draws a real `<input type="checkbox">` (`obsRenderer`,
    `:1217-1245`) with special mousedown handling so one click toggles even when the cell is not yet
    selected (`:1230-1241`); printable keys are swallowed on these cells (`beforeKeyDown`,
    `:1434-1447`); `0`/`1` uncheck/check (`:1555-1560`); `F1`…`Fn` toggle the n-th observatie of the
    current row from anywhere in the row (`:1564-1572`).

Rendering / colouring

13. Custom renderers built on `Handsontable.renderers.TextRenderer`: `idRenderer`, `naamRenderer`,
    `calcCentered`, `gradeRenderer`, `rttiRenderer`, `scoreRenderer` (`:1091-1215`), plus `obsRenderer`.
14. Score colours: 0 → light red, max → light green, in between → light yellow, `N` → grey bold;
    bonus questions blue/italic, diag grey/italic regardless of value (`:1155-1215`).
15. Grade cell background `gradeColor`, std-dev row `stdDevGradeColor` (`:1121-1132`); RTTI %
    background `rttiPctColor` (`:1147-1153`); summary rows grey (`#e8ecf2`/`#dde4f0`).
16. Cross-hair highlight of the selected row and column (alpha overlay via `backgroundImage`,
    `applyHighlight`, `:953-964`), re-render on every selection change (`afterSelection`,
    `:1330-1341`).

Keyboard navigation (capture-phase listener on the grid container, `:1453-1575`)

17. Enter / NumpadEnter / NumpadMultiply: commit and go to the next editable cell (questions →
    observaties), after the row's last editable cell to the next student's first empty question;
    in the Cijfer column to the next student's grade (`:1473-1497`); `enterMoves: {row:0,col:0}`
    (`:1289`).
18. NumpadDivide: previous editable cell (`:1500-1506`); NumpadSubtract / NumpadAdd: previous / next
    student at the first empty question (or same column) (`:1509-1528`).
19. Home / End within the question block and the observatie block (`:1531-1552`).
20. Tab: custom `tabMoves` across questions → observaties → next student (`:1290-1325`).
21. The help tooltip in the modal header documents the numpad scheme (`:158-160`).

Undo, saving, collaboration

22. **Undo/redo** owned by the app, not HOT: stack of 50 entries (`MAX_HISTORY`, `:45-50, 89-112`)
    for scores, observaties and grade overrides; an entry is skipped with a toast when a colleague
    changed the cell since (`:79-82, 1390-1401, 980-985, 1011-1020`); toolbar buttons ↶/↷ (`:156-157,
199-202`) and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (`:204-214`; see quirk U1). HOT's own UndoRedo plugin
    is not configured (default settings).
23. **Autosave per cell** through `saveCell` (`:776-787`) → `Store.setScore` / `setObservation` /
    `setGradeOverride` (CAS read-modify-write per student file); `pendingSaves` tracks in-flight
    saves per `studentId:col` (`:61-63`); `afterChange` hook does the saving and recomputation
    (`:1360-1433`, re-entrancy guard `:1247,1361`); `waitForPendingSaves` before a reload
    (`:72-77, 401-409`).
24. Copy/paste and fill handle: HOT defaults (CopyPaste, Autofill) are left on; pasted/filled values
    arrive through `afterChange` like typed ones (multi-cell `changes` loop, `:1364`). Ctrl+C copies
    the displayed strings.
25. **Live background updates**: `applyRemoteRecord` (`:793-832`) patches a row from a colleague's
    score file, skipping the cell being edited and cells with a save in flight, then flashes the
    changed cells with an inset outline in the colleague's colour for 2 s (`flashUntil`,
    `REMOTE_FLASH_MS`, `:64-68, 790, 954-957`).
26. **Presence**: own cursor published on selection (`Presence.setPosition`, `:1330-1336`) and on edit
    (`Presence.markEdit`, `:779`); colleagues' cursors drawn as an absolutely positioned overlay with a
    coloured border and name flag over the cell (`drawCursors`, `:838-875`, re-drawn in `afterRender`,
    `:1326-1329`); colleague badges in the header (`renderPresence`, `:304-331`).
27. Reload rules: N-term change by a colleague applied in place with a flash of the input
    (`:238-269`); other exam edits, deletions, or changes to groups/students/observaties shown in the
    grid trigger a blocking reload notice (`:240-253, 271-287`, `rosterSignature` `:384-398`).
28. N-term spinner in the header (`#sc-nterm`, `:169-174, 182-193`) recomputes all rows
    (`recomputeAllRows`, `:334-345`).
29. HOT API used: `new Handsontable(container, settings)`, `render`, `selectCell`, `getSelected`,
    `getActiveEditor()` (`isOpened`, `finishEditing`, `cancelChanges`, `row`, `col`),
    `setDataAtCell`, `getCell`, `getCoords`, `refreshDimensions`, `isDestroyed`, `destroy`. Hooks:
    `cells`, `tabMoves`, `afterRender`, `afterSelection`, `afterGetColHeader`, `afterBeginEditing`
    (removes HOT's wrong `aria-hidden` on its textarea, `:1355-1359`), `afterChange`, `beforeKeyDown`.
    Licence key `non-commercial-and-evaluation` (`:1254`).

## 9. Electron security settings

| Setting                                    | Value                                                                                                                                                                                                                                                                                          | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contextIsolation`                         | `true`                                                                                                                                                                                                                                                                                         | `main.js:947`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `nodeIntegration`                          | `false`                                                                                                                                                                                                                                                                                        | `main.js:948`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sandbox`                                  | not set → Electron ≥ 20 default `true` for renderers (preload only uses `require('electron')`, which works sandboxed)                                                                                                                                                                          | `main.js:945-949`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `webSecurity`                              | not set → default `true`                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `nodeIntegrationInSubFrames`, `webviewTag` | not set → default `false`                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `preload`                                  | `preload.js` (one `contextBridge.exposeInMainWorld('rtti', …)`, 34 methods)                                                                                                                                                                                                                    | `main.js:946`, `preload.js:3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CSP                                        | `<meta http-equiv>` only, no response headers / `session.webRequest`                                                                                                                                                                                                                           | `index.html:5-8`: `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:;` — `editor.html:5-8`: `default-src 'none'; script-src 'self' https://esm.sh; style-src 'unsafe-inline' https://cdn.jsdelivr.net; connect-src https://esm.sh; frame-src 'self'; worker-src blob:; img-src data: blob:;` — `pdf-viewer.html:5-8`: `default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; worker-src https://cdn.jsdelivr.net blob:; connect-src 'self' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:;` |
| Navigation / new windows                   | no `setWindowOpenHandler`, no `will-navigate` guard, no permission request handler                                                                                                                                                                                                             | `main.js` (absent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Menu / DevTools                            | `win.removeMenu()`; DevTools opened detached in dev only                                                                                                                                                                                                                                       | `main.js:954-956`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Second channel                             | editor iframe → parent `postMessage(…, '*')` proxy for 10 bridge calls incl. `writeTextFile` with a caller-chosen path (`modals/editor.js:51-95`); the parent checks `evt.source === frame.contentWindow` (`:53`); the iframe accepts `rtti-response` from any sender (`editor-init.js:54-60`) |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Shell                                      | `shell:openPath` opens any absolute path the renderer passes (`main.js:934`)                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 10. Preliminary claims: verdicts

| Claim                                                                                                                                     | Verdict                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.js` is a monolith with Electron types mixed into logic                                                                              | **Confirmed**                                                | 1025 lines, 32 `ipcMain.handle` blocks with inline fs, locking, presence, session, images, Typst compile, PDF merge and window code; `app`, `BrowserWindow`, `dialog`, `clipboard`, `nativeImage`, `shell` used next to path/fs logic (`main.js:1-7, 56-934`); the only separate module is `sync.js` (atomic write, hash, watcher).                                                                                                        |
| `store.js` mixes cache, IPC, RTTI/grade logic and legacy migration and is a classic global script                                         | **Confirmed**                                                | classic script (`index.html:311`), global `const Store` IIFE (`store.js:28`); cache `:30`; 66 direct `window.rtti.` calls; CAS/write queue `:53-124`; RTTI/grade `calcResults`/`calcGrade` `:657-755`; migration `:821-992`; opdracht assignment rules `:1209-1353`; external change patching `:1355-1504`.                                                                                                                                |
| Several renderer files > 1000 lines                                                                                                       | **Confirmed**                                                | 6 JS + `style.css` (2936) + `editor.html` (1008); see §1.                                                                                                                                                                                                                                                                                                                                                                                  |
| UI built with `innerHTML` strings                                                                                                         | **Confirmed**                                                | 81 direct sites + `showModal(html)` for every modal (20 call sites); see §5.                                                                                                                                                                                                                                                                                                                                                               |
| CDN dependencies                                                                                                                          | **Confirmed**                                                | Handsontable, Chart.js, annotation plugin, pdf.js (jsdelivr), CodeMirror/Lezer (esm.sh, major-only versions); no SRI; see §6.                                                                                                                                                                                                                                                                                                              |
| Typst data passed by generating Typst source from strings (`toTypst`) and wrapper `.typ` files written to a `temp/` folder in the app dir | **Confirmed**                                                | `toTypst` `main.js:558-576` (object keys emitted unquoted; strings escape only `` and `"`); wrappers in `path.join(appDir, 'temp')` `main.js:549,696,744,843`; template copied into `temp/` `main.js:552-555`; `appDir` = folder of the portable exe (`main.js:17-20`).                                                                                                                                                                    |
| `lib.typ` copied into the shared data folder on start                                                                                     | **Confirmed** (nuance: only when its hash differs)           | `seedInitialData` `main.js:968-973`, called in `app.whenReady` `main.js:1006`.                                                                                                                                                                                                                                                                                                                                                             |
| No tests                                                                                                                                  | **Confirmed**                                                | no test files, no test script in `package.json:6-10`; CLAUDE.md "No test suite yet".                                                                                                                                                                                                                                                                                                                                                       |
| No types                                                                                                                                  | **Confirmed**                                                | no `.ts`, no `tsconfig`/`jsconfig`, no `// @ts-check`; JSDoc `@param` only in `utils/csv.js` (3).                                                                                                                                                                                                                                                                                                                                          |
| Unused `docx` dependency                                                                                                                  | **Confirmed**                                                | `package.json:67`, no import/require in any source file.                                                                                                                                                                                                                                                                                                                                                                                   |
| Leftover legacy migration code                                                                                                            | **Confirmed**, and it still runs                             | `migrate()` on every start from `Store.preload()` (`store.js:318-319`), `migrateLegacyToPerYear` `:828-913` (complexity 45), `migrateToPerSubject` `:915-991`.                                                                                                                                                                                                                                                                             |
| Clean process boundary (contextIsolation, no Node in renderer, one bridge)                                                                | **Mostly confirmed**                                         | `contextIsolation: true`, `nodeIntegration: false` (`main.js:947-948`), one `exposeInMainWorld` (`preload.js:3`). Caveats: the editor iframe gets a second, string-typed postMessage channel that the parent proxies to the bridge (`modals/editor.js:51-95`); generic path-based methods (`readJson`, `writeJson`, `deleteFile`, `writeTextFile`, `openPath`) give the renderer broad file access; CDN code runs with full bridge access. |
| `Sync.on` pub/sub and `data-action` delegation                                                                                            | **Partly**: pub/sub confirmed; delegation mostly **refuted** | `Sync.on` (`renderer/sync.js:22-26`) with `onModalSync` lifetime (`app.js:257-273`). `data-action` is mostly bound per element after each render (`querySelectorAll('[data-action="x"]').forEach(addEventListener)`, e.g. `leerlingen.js:173-183`); true delegation only in `opdrachten-genereren.js:466` and for `data-close-modal` (`app.js:145`).                                                                                       |
