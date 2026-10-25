# UI map of the reference renderer

What the Electron renderer in `_reference/renderer/` is made of: screens, modals, what they call in
`Store` and on the `window.rtti` bridge, the background events they listen to, and the shared UI
mechanics (navigation, modals, dialogs, unsaved-changes guard, keyboard). All `file:line` references
point into `_reference/` (read-only). The bridge itself is described in `ipc-api.md`, data files in
`data-files.md`, business rules in `business-rules.md`.

## 1. Load order and global state

### Main window (`renderer/index.html`)

Scripts at the end of `<body>`, in this order (`index.html:308-313`):

| #   | Script                                                                                               | Kind                       | Defines                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `https://cdn.jsdelivr.net/npm/handsontable@14.3.0/dist/handsontable.full.min.js`                     | classic, CDN               | global `Handsontable` (used only in `screens/scores.js`)                                                                                                |
| 2   | `https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js`                                  | classic, CDN               | global `Chart` (used in `modals/profiel.js`, `modals/toets-overzicht.js`, `app.js:108` destroy)                                                         |
| 3   | `https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js` | classic, CDN               | registers itself with `Chart` (no `Chart.register` call in the code); used as `plugins.annotation` (`profiel.js:454,606,827`, `toets-overzicht.js:568`) |
| 4   | `store.js`                                                                                           | classic                    | top-level `function qKind` (`store.js:23`) and `const Store = (() => {…})()` IIFE (`store.js:28-1594`)                                                  |
| 5   | `custom-select.js`                                                                                   | classic                    | top-level `class CustomSelect` (`custom-select.js:15`), helper `escHtmlCS` (`custom-select.js:175`)                                                     |
| 6   | `app.js`                                                                                             | `type="module"` (deferred) | entry point; imports every screen, `modals/editor.js`, `sync.js`, `presence.js`                                                                         |

The stylesheet `https://cdn.jsdelivr.net/npm/handsontable@14.3.0/dist/handsontable.full.min.css` and
`style.css` are loaded in `<head>` (`index.html:10-14`).

Notes:

- `Store`, `qKind` and `CustomSelect` are top-level `const`/`function`/`class` declarations of
  classic scripts: they are globals in the shared global lexical scope, but `Store` and
  `CustomSelect` are **not** properties of `window` (`const`/`class`). ES modules use them as free
  identifiers (e.g. `Store.loadUsers()` in `app.js:298`, `new CustomSelect(...)` in `app.js:372`).
- `window.rtti` is the contextBridge object from `preload.js:3`.
- The module graph has cycles: `app.js` imports the screens, and the screens, modals, `presence.js`
  and `utils/grades.js` import `../app.js` back (for `showModal`, `toast`, `escHtml`, `SEL`, …). It works
  because nothing calls an `app.js` export while modules are being evaluated, except
  `presence.js`, which at import time only calls `Sync.on('presence', …)` (`presence.js:122`) and
  `setInterval` (`presence.js:130`).
- Top-level side effects in `app.js` (run once, in order): nav button listeners (`app.js:26`), modal
  overlay listeners (`app.js:145-158`), filter popover listeners (`app.js:445,578-593,846-867`),
  user badge listener (`app.js:946`), `unhandledrejection` handler (`app.js:964`), `Sync.on('*')`
  (`app.js:1039`), `Sync.on('exam')` (`app.js:1052`), `Sync.start()` (`app.js:1095`), then
  `init()` = `Store.preload()` → `applyWatermerk()` → `initSelects()` → `navigateTo('startup')`
  (`app.js:1098-1105`). `Store.preload()` runs the legacy migration first (`store.js:318-324`).

### Iframes

| Page                                      | Opened from                                                                                                | Scripts                                                                                                                                                                                                                           | Talks to the app via                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editor.html` (CodeMirror 6 Typst editor) | `modals/editor.js:29` sets `#editor-frame.src = editor.html?id&typFile&naam&badge…`                        | `editor-init.js` (module, `editor.html:1006`), which imports `@codemirror/state@6`, `@codemirror/view@6`, `@codemirror/commands@6`, `@codemirror/language@6`, `@lezer/highlight@1` from `https://esm.sh` (`editor-init.js:14-39`) | `postMessage` to the parent (`editor-init.js:46-60`); `modals/editor.js:51-106` proxies each message type to a `window.rtti` call and answers with `rtti-response` |
| `pdf-viewer.html`                         | `modals/rapport.js:310` and `modals/opdrachten-genereren.js:405` (`<iframe src="pdf-viewer.html?file=…">`) | `pdf-viewer.js` (module, `pdf-viewer.html:221`), which imports `pdfjs-dist@4.9.155` from jsdelivr (`pdf-viewer.js:1-4`)                                                                                                           | none (reads the PDF by `file:` URL)                                                                                                                                |

The iframes have no `window.rtti`: Electron runs the preload only in the main frame.

### Global and module-level state

| Where                                | State                                                                                                                                                                                                                                           | Notes                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `store.js:30-34`                     | `cache`, `_years`, `_activeSubject`, `_activeUser` (inside the `Store` closure), `writeQueues` (`store.js:61`)                                                                                                                                  | Single source of truth for the UI; screens read it synchronously via `get…Sync()`.                                               |
| `app.js:22`                          | `screens` (name → `<section>`)                                                                                                                                                                                                                  | built from `.screen` elements                                                                                                    |
| `app.js:99,106`                      | `_modalCharts`, `_onCloseModal`                                                                                                                                                                                                                 | modal lifecycle                                                                                                                  |
| `app.js:164,257-258`                 | `_closeGuard`, `_modalSubs`, `_modalSession`                                                                                                                                                                                                    | unsaved guard; per-modal sync subscriptions; session counter to ignore stale async work                                          |
| `app.js:151`                         | `_overlayPress`                                                                                                                                                                                                                                 | backdrop click must start on the backdrop                                                                                        |
| `app.js:369`                         | exported `SEL` (`studentYear`, `groupsYear`, `toetsenYear` CustomSelects)                                                                                                                                                                       | created once in `initSelects()` (`app.js:371-395`)                                                                               |
| `app.js:398,455-461,596,649,784-785` | `_adminSubjectFilter`, `_filterState { schoolsoorten, jaarlagen, jaarlagenKlas, eigenOnly }`, `_activeUserId`, `_schoolsoortOptions`, `_jaarlagOptions`, `_obsFilter`, `_obsFilterOptions`                                                      | filter bar; persisted per user with `Store.saveFilterState` (`app.js:871`) except the admin vak filter and the observatie filter |
| `app.js:1006-1007`                   | `_screenRefreshPending`, `_screenRefreshTimer`                                                                                                                                                                                                  | background redraw of the active list                                                                                             |
| `screens/leerlingen.js:22`           | exported `leerlingenState { year, search }`                                                                                                                                                                                                     | also read by `modals/profiel.js:52` and `app.js:376,983`                                                                         |
| `screens/scores.js:41-70`            | `activeExam`, `activeObs`, `activeGridData`, `hotInstances`, `scoreHistory`, `redoHistory`, `undoKeydownHandler`, `undoBtnEl`, `redoBtnEl`, `numpadDotIsN`, `rowUpdaters`, `activeRoster`, `pendingSaves`, `remoteFlashColor`, `cursorUpdaters` | one score modal at a time; `numpadDotIsN` survives for the app session                                                           |
| `screens/toetsen.js:469`             | `_openMenu`                                                                                                                                                                                                                                     | open exam card menu                                                                                                              |
| `modals/editor.js:9`                 | `_messageHandler`                                                                                                                                                                                                                               | iframe proxy listener                                                                                                            |
| `modals/rapport.js:7`                | `_printListener`                                                                                                                                                                                                                                |                                                                                                                                  |
| `modals/opdrachten-genereren.js:280` | `_recomputeSeq`                                                                                                                                                                                                                                 | drops stale async recomputes                                                                                                     |
| `presence.js:25-34`                  | `me`, `own`, `heartbeatTimer`, `writeTimer`, `lastWriteAt`, `remote`, `listeners`, `lastSummary`                                                                                                                                                |                                                                                                                                  |
| `sync.js:19-20,41`                   | `handlers`, `started`, `queue`                                                                                                                                                                                                                  |                                                                                                                                  |
| `document.documentElement` style     | `--watermerk-url` (`app.js:958`)                                                                                                                                                                                                                | school watermark as CSS variable                                                                                                 |

No `localStorage`/`sessionStorage` is used anywhere in the renderer. Machine-local state (last
session, filter state) goes through `window.rtti.readLocalSession` / `writeLocalSession`
(`store.js:172-197`) to `session.json` in Electron's `userData` folder (`main.js:439-458`).

## 2. Navigation and tabs

- The page is one `index.html` with a `<section id="screen-<name>" class="screen">` per tab
  (`index.html:38-301`). `app.js:22-25` maps them by name.
- Top bar: `<nav id="main-nav">` with `.nav-btn[data-screen]` (`index.html:19-27`). Each button calls
  `navigateTo(btn.dataset.screen)` (`app.js:26-28`).
- `navigateTo(name)` (`app.js:30-65`): marks the nav button active, hides all sections, hides the top
  bar on `startup`, greys out the admin vak filter on `leerlingen`, updates the "Eigen/Alle" label,
  swaps the Eigen toggle for the observatie filter on `opdrachten`, clears a pending background
  refresh, calls `renderScreen(name)` **without awaiting it** (screens render async; the section
  is shown immediately), scrolls to the top and **moves the shared `#filter-bar` element** into
  `#filter-row-<name>` (`app.js:62-63`).
- `renderScreen` (`app.js:67-86`) is a switch: `renderStartup`, `renderLeerlingen`,
  `renderGroepen`, `renderToetsen`, `renderObservaties`, `renderOpdrachten`, `renderGebruikers`,
  `renderSchool`. Screens are rebuilt from scratch on every visit and on every filter change
  (`rerenderActive`, `app.js:874-879`).
- Role visibility (`applyRoleVisibility`, `app.js:933-944`): admins see `gebruikers` and `school` but
  not `toetsen` and `observaties`; teachers the reverse.
- Login: the startup screen (subject list + user badges, `screens/startup.js`) calls
  `Store.setActiveUser` → `Store.initSubject` → `Store.saveLastSession` → `showUserBadge` →
  `navigateTo('leerlingen')` (`startup.js:108-116`). `showUserBadge` builds the filter bar and starts
  presence (`app.js:915-931`).
- Logout: click on the top-bar user badge (`app.js:946-953`) → `Presence.stop()`, reset admin and
  observatie filters, `navigateTo('startup')`. The Store's active user/subject are not reset.
- The scores grid is **not** a tab: `screens/scores.js` is opened as a modal (`openScoreModal`) from the
  exam card menu (`screens/toetsen.js:506`).
- Year selects on Leerlingen/Groepen/Toetsen are the three `SEL` CustomSelects; their `onChange` calls
  `Store.loadYear(v)` and redraws (`app.js:371-395`).
- Static header buttons are (re)bound with `element.onclick = …` on each render (e.g.
  `leerlingen.js:56-59`, `toetsen.js:59-60`, `observaties.js:84`), so they never collect duplicate
  listeners.

### Background refresh of the visible list

`Sync.on('*')` (`app.js:1039-1047`) checks the active screen against `SCREEN_REFRESH`
(`app.js:980-1003`: which event types, which year, which render function) and schedules a redraw after
750 ms (`app.js:1005,1013-1017`). The redraw waits while a modal is open (`closeModal` picks it up,
`app.js:142`) or an exam menu is open (retry every 2 s, `app.js:1023-1026`), and keeps page and section
scroll positions (`app.js:1031-1036`). The school screen is excluded (edited inline). A separate
`Sync.on('exam')` (`app.js:1052-1057`) shows a "Nieuwe toets toegevoegd" card (`app.js:1059-1093`).

## 3. Screens

| Screen (file)                               | Entry                                               | Opens                                                                                                            | Store (main calls)                                                                                                                       | Bridge                                                                   | Sync                                                                         |
| ------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Startup (`screens/startup.js`)              | `renderStartup` `:9`                                | — (logs in)                                                                                                      | `loadUsers`, `loadLastSession` `:12`, `SUBJECT_DISPLAY` `:17,38`, `setActiveUser` `:112`, `initSubject` `:113`, `saveLastSession` `:114` | `readPhotoAsDataUrl` `:84`                                               | —                                                                            |
| Leerlingen (`screens/leerlingen.js`)        | `renderLeerlingen` `:35`, `renderStudentList` `:65` | profiel, leerling-edit (add/edit/delete, CSV import)                                                             | `getStudentsSync`, `getGroupsSync`, `isAdminActive`, `jaarlaagFromStamklas`, `studentHasScores`/`studentHasAnyScores` `:188-189`         | —                                                                        | via `app.js` `SCREEN_REFRESH` (`students`, `group`)                          |
| Groepen (`screens/groepen.js`)              | `renderGroepen` `:35`, `renderGroepenForYear` `:67` | groep-leerlingen (`open-group`), groep-edit (add/edit/delete, 2 CSV imports)                                     | `getGroupsSync`, `getStudentsSync`, `loadUsers`, `getExams`, `getStudentScores`, `examResults` `:199-228`                                | —                                                                        | via `SCREEN_REFRESH` (`group`, `students`, `exam`, `scores`)                 |
| Toetsen (`screens/toetsen.js`)              | `renderToetsen` `:50`, `renderToetsenList` `:170`   | toets-edit, scores (modal), rapport, RTTI-uitleg (rapport.js), opdrachten-genereren, herkansing, toets-overzicht | `getExamsSync`, `preloadScores`, `getStudentScores`, `examResults`, `computeBestGradeMap`, `examHasResits`, `examHasScores`              | —                                                                        | via `SCREEN_REFRESH` (`exam`, `scores`, `group`); presence badges `:155-160` |
| Observaties (`screens/observaties.js`)      | `renderObservaties` `:81`                           | own modal `openObsModal` `:196`                                                                                  | `getObservatiesSync`, `obsIsUsedInAnyExam` `:174`, `deleteObservation` `:191`, `upsertObservation` `:376`                                | —                                                                        | via `SCREEN_REFRESH` (`observatie`, `group`)                                 |
| Opdrachten (`screens/opdrachten.js`)        | `renderOpdrachten` `:35`                            | own modal `openOpdrachtenModal` `:163`, Typst editor (`open-editor` → `openEditor`)                              | `getOpdrachten`, `copyOpdracht` `:141`, `deleteOpdracht` `:156`, `upsertOpdracht` `:365`                                                 | `readAllJson('observaties')` `:41,165`, `createAssignmentTypFile` `:362` | via `SCREEN_REFRESH` (`opdracht`, `observatie`)                              |
| Gebruikers, admin (`screens/gebruikers.js`) | `renderGebruikers` `:12`                            | own modal `openUserModal` `:112`                                                                                 | `loadUsers`, `upsertUser` `:102,245`                                                                                                     | `savePhoto` `:222`                                                       | via `SCREEN_REFRESH` (`gebruikers`)                                          |
| School, admin (`screens/school.js`)         | `renderSchool` `:11`                                | inline edit fields                                                                                               | `loadSchool` `:15`, `saveSchool` `:126,184,239`                                                                                          | `readPhotoAsDataUrl` `:17,18,246`, `savePhoto` `:235`                    | none (excluded from refresh)                                                 |

## 4. Modals

All modals go through `showModal(html, onShow, wide, onClose)` (`app.js:117-129`): it bumps
`_modalSession`, clears the close guard and the previous modal's sync subscriptions, destroys
registered charts and sets `#modal-content.innerHTML = html`. 20 `showModal` call sites.

| Modal (file:function)                                                                                | Opened from                                                              | Store (main calls)                                                                                                                                                       | Bridge                                                                                                                                                                                                                           | `onModalSync`                                                              | Unsaved guard                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Score grid `screens/scores.js:openScoreModal` `:137`                                                 | exam menu (`toetsen.js:506`), reopened after "Toets bewerken" `:216-222` | `getExamsSync`, `setExamNTerm` `:187`, `getStudentScores` `:455`, `calcResults` `:566,579`, `setScore` `:1385-1422`, `setObservation` `:978`, `setGradeOverride` `:1008` | —                                                                                                                                                                                                                                | `scores` `:230`, `exam` `:238`, `group`/`students`/`observatie` `:278`     | no (autosave per cell)                                                                                     |
| Exam editor `modals/toets-edit.js:openExamModal` `:18` (step 1) and `showExamEditor` `:359` (step 2) | `btn-add-exam`, exam menu, scores modal, toets-overzicht, herkansing     | `getConfig`, `loadYear`, `makeExamId` `:258`, `getExams`, `examHasScores`, `examHasResits`, `removeObsFromExamScores` `:709`, `upsertExam` `:711`, `deleteExam` `:756`   | —                                                                                                                                                                                                                                | `exam` `:496`                                                              | yes, `formSnapshot` `:218-219`, `:734-735`                                                                 |
| Exam overview `modals/toets-overzicht.js:openExamOverviewModal` `:32`                                | exam card (`exam-overview`), herkansing                                  | `getExams`, `getStudentsSync`, `getGroupsSync`, `getObservatiesSync`, `getStudentScores`, `calcResults`                                                                  | —                                                                                                                                                                                                                                | `scores` `:1275`, `exam` `:1278` (silent `modalRefresher`)                 | no                                                                                                         |
| Resit / best grades / summary card `modals/herkansing.js` `:7,144,153`                               | exam menu                                                                | `getExams`, `getResitsSync`, `makeExamId`, `computeBestGradeMap`, `upsertExam` `:241,255`                                                                                | —                                                                                                                                                                                                                                | —                                                                          | no                                                                                                         |
| Rapport `modals/rapport.js:openRapportModal` `:324`                                                  | exam menu                                                                | `loadYear`, `preloadScores`, `getObservaties`, `getStudentsSync`, `getGroupsSync`, `getStudentScores`, `calcResults`, `getExamsSync`                                     | `readJson` `:248`, `renderRapportPdf` `:281`, `openPath` `:316`                                                                                                                                                                  | —                                                                          | no                                                                                                         |
| RTTI uitleg / leeradvies `modals/rapport.js:openRttiUitlegModal` `:538`                              | `btn-toetsen-rtti-uitleg` (`toetsen.js:60`)                              | `getActiveSubject`                                                                                                                                                       | `readJson` `:545`, `writeJson` `:736` (no CAS)                                                                                                                                                                                   | —                                                                          | own mechanism: `_dirty` + inline confirm bar, capture listeners on overlay and ✕ (`:575-628`)              |
| Opdrachten genereren `modals/opdrachten-genereren.js:openOpdrachtenGenererenModal` `:21`             | exam menu                                                                | `getOpdrachtCoupling`, `getOpdrachtCijferCards`, `getOpdrachtAssignments` `:36,283`, `opdrachtMatchesExam`, `setExamOpdrachten` `:301`                                   | `onAssignmentProgress` `:376`, `renderAssignmentBatch` `:382`, `openPath` `:494`                                                                                                                                                 | `scores`, `students`, `group`, `opdracht`, `observatie`, `exam` `:507-518` | no                                                                                                         |
| Profiel `modals/profiel.js:openProfielModal` `:46`                                                   | leerlingen (`profile`), groep-leerlingen                                 | `getStudents`, `getStudentHistory`, `resolveBestAttempts`, `calcResults`, `getExamsSync`, `getStudentScores`, `examResults`                                              | —                                                                                                                                                                                                                                | `scores` `:24`, `exam` `:27`, `students` `:30` (in `watchProfile` `:20`)   | no                                                                                                         |
| Groep edit `modals/groep-edit.js:openGroupModal` `:17`, CSV imports `:449,574`                       | groepen                                                                  | `getStudents`, `loadUsers`, `getGroups`, `parseGroupName`, `upsertGroup`, `makeGroupId`, `deleteGroup`, `upsertGroups`                                                   | —                                                                                                                                                                                                                                | `group` `:213`                                                             | no                                                                                                         |
| Groep leerlingen `modals/groep-leerlingen.js:openGroupStudentsModal` `:22`                           | groepen (`open-group`)                                                   | `getStudentScores`, `resolveBestAttempts`, `getStudentHistory`, `calcResults`, `examResults`                                                                             | —                                                                                                                                                                                                                                | `scores` `:306`, `exam` `:310`, `group` `:313`, `students` `:324`          | no                                                                                                         |
| Leerling edit `modals/leerling-edit.js:openStudentModal` `:27`, CSV import `:195`                    | leerlingen                                                               | `getStudents`, `upsertStudent` `:165`, `deleteStudent` `:189`, `upsertStudents` `:270`                                                                                   | —                                                                                                                                                                                                                                | `students` `:97`                                                           | no                                                                                                         |
| Observatie `screens/observaties.js:openObsModal` `:196`                                              | observaties                                                              | `upsertObservation` `:376`                                                                                                                                               | —                                                                                                                                                                                                                                | —                                                                          | yes `:382-383`                                                                                             |
| Opdracht `screens/opdrachten.js:openOpdrachtenModal` `:163`                                          | opdrachten                                                               | `upsertOpdracht` `:365`                                                                                                                                                  | `readAllJson` `:165`, `createAssignmentTypFile` `:362`                                                                                                                                                                           | —                                                                          | no                                                                                                         |
| Gebruiker `screens/gebruikers.js:openUserModal` `:112`                                               | gebruikers                                                               | `upsertUser` `:245`                                                                                                                                                      | `savePhoto` `:222`                                                                                                                                                                                                               | —                                                                          | no                                                                                                         |
| School year picker `utils/csv.js:askSchoolYear` `:51`                                                | CSV imports                                                              | —                                                                                                                                                                        | —                                                                                                                                                                                                                                | —                                                                          | no                                                                                                         |
| Typst editor overlay `modals/editor.js:openEditor` `:11`                                             | opdrachten (`open-editor`)                                               | —                                                                                                                                                                        | proxies `readTextFile`, `writeTextFile`, `renderAssignmentPdf`, `renderAssignmentSvg`, `listOpdrachtImages`, `saveOpdrachtImage`, `pickImageFile`, `importOpdrachtImage`, `readClipboardImage`, `getDataDir` (`editor.js:61-95`) | —                                                                          | not a modal: full-window `#editor-overlay` iframe; autosave 600 ms after typing (`editor-init.js:649-653`) |

Modal helpers in `app.js`: `onModalSync(type, h)` (`:266`) and `onModalCleanup(fn)` (`:271`) end
with the modal; `modalRefresher(reopen, ms)` (`:281-293`) re-runs a display-only modal, keeping its
scroll position, unless the modal was replaced or a reload notice is up; `showReloadNotice(msg, onOk)`
(`:307-326`) is a blocking notice ("Gewijzigd door een collega") on top of a modal whose data changed;
`changedByName(ev)` (`:296-300`); `pushModalChart(chart)` (`:102`) destroys charts on close.

## 5. Event wiring: `data-action`, `data-close-modal`

- Buttons in rendered lists carry `data-action="…"` plus `data-id`/`data-examid`. The usual pattern
  is **not** event delegation: after each `container.innerHTML = html`, the screen binds every
  element with `container.querySelectorAll('[data-action="x"]').forEach(b => b.addEventListener('click', …))`
  (e.g. `leerlingen.js:173-183`, `groepen.js:165-178`, `toetsen.js:378-391`, `observaties.js:181-184`,
  `opdrachten.js:121-134`, `gebruikers.js:88-96`, `school.js:114,134`, `groep-leerlingen.js:337`).
  Real delegation (one listener on the root, `e.target.closest('[data-action]')`) is used only in
  `modals/opdrachten-genereren.js:418,466`, for `[data-close-modal]` on `#modal-content`
  (`app.js:145-147`), `[data-answer]` in `confirmDialog` (`app.js:230-234`), `[data-value]` in
  CustomSelect (`custom-select.js:50-54`), `[data-tab-idx]` in the RTTI uitleg modal
  (`rapport.js:718`) and `.exam-menu-item` menus (`scores.js:717`, `toetsen.js:601`).
- `data-action` values: see the per-file inventory below.
- `data-close-modal="1"` on "Annuleren" buttons closes the modal directly with `closeModal()`,
  bypassing the unsaved guard by design (`app.js:145-147`, comment `app.js:161-163`).
- No inline `on…=` handlers anywhere (CSP has no `'unsafe-inline'` for scripts).

## 6. In-app dialogs, toasts, notices

| Function                                                          | Where                                     | Behaviour                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirmDialog(message, { title, okLabel, cancelLabel, danger })` | `app.js:208-251`                          | Promise<boolean>; `.app-dialog-backdrop` appended to `body`; focus on the action button; Escape/backdrop → false; Tab cycles the buttons; `keydown` is stopped from propagating (the score grid listens on `document`). `cancelLabel: null` = one-button notice. Native `alert/confirm/prompt` are never used. |
| `showReloadNotice(message, onOk)`                                 | `app.js:307-326`                          | one at a time (`#reload-notice`), blocks the modal until OK                                                                                                                                                                                                                                                    |
| `toast(message, type)`                                            | `app.js:329-339`                          | auto-dismiss after 3.5 s                                                                                                                                                                                                                                                                                       |
| `persistentError(message)`                                        | `app.js:341-352`                          | stays until ✕; de-duplicated by message                                                                                                                                                                                                                                                                        |
| global save-conflict handler                                      | `app.js:964-973`                          | `unhandledrejection` with `reason.code === 'conflict'` (from `Store.saveEntity`, `store.js:106-124`) → `persistentError("Niet opgeslagen: …")`; all other rejections are left to the console                                                                                                                   |
| "Nieuwe toets toegevoegd" card                                    | `app.js:1052-1093`                        | `#bg-notices`, click to dismiss                                                                                                                                                                                                                                                                                |
| Cell/exam context menus                                           | `scores.js:688-728`, `toetsen.js:571-625` | `.exam-menu`, close on outside mousedown, Escape (capture, stops propagation), scroll, resize                                                                                                                                                                                                                  |

## 7. Unsaved-changes guard

- `guardModalClose(isDirty)` (`app.js:166-168`) registers a predicate; `showModal` and `closeModal`
  reset it (`app.js:119,133`).
- `requestCloseModal()` (`app.js:170-181`) is used by the ✕ button (`app.js:148`) and a backdrop click
  that also started on the backdrop (`app.js:151-158`). If `isDirty()` → `confirmDialog('Weet je zeker
dat je dit scherm wilt sluiten? Er zijn onopgeslagen wijzigingen.', { okLabel: 'Sluiten zonder
opslaan', danger: true })`; a modal replaced while the dialog is open is not closed (`_modalSession`
  check, `app.js:178`).
- `formSnapshot(root)` (`app.js:188-198`) serialises inputs, toggle buttons (`.selected`,
  `data-checked`) and CustomSelect labels.
- Users: exam editor step 1 (`toets-edit.js:218-219`), step 2 (`toets-edit.js:734-735`, always dirty
  for a new exam), observatie modal (`observaties.js:382-383`). The RTTI uitleg modal has its own
  inline confirm (`rapport.js:575-628`). Other form modals (groep, leerling, gebruiker, opdracht,
  herkansing) have no guard.
- There is no Escape-to-close for modals; Escape only closes dialogs, menus, popovers and
  CustomSelects. No `beforeunload` guard (window close with an open form loses it; the Typst
  editor can lose the last <600 ms of typing).

## 8. Keyboard shortcuts

| Scope                                                | Key                                                                                                                                                                  | Effect                                                                                                                                                                   | Where                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Score grid (capture listener on each grid container) | Numpad `.` (`NumpadDecimal`)                                                                                                                                         | writes `N` in a question cell (also while editing, discarding the typed value), when ". → N" is ticked (default on)                                                      | `scores.js:1464-1470`, toggle `:161-164,195-197`                                          |
|                                                      | `Enter`, `NumpadEnter`, `NumpadMultiply`                                                                                                                             | commit and go to the next editable cell (questions then observaties); after the last one: next student, first empty question; in the Cijfer column: next student's grade | `scores.js:1473-1497`                                                                     |
|                                                      | `NumpadDivide`                                                                                                                                                       | previous editable cell                                                                                                                                                   | `scores.js:1500-1506`                                                                     |
|                                                      | `NumpadSubtract` / `NumpadAdd`                                                                                                                                       | previous / next student, first empty question or same column                                                                                                             | `scores.js:1509-1528`                                                                     |
|                                                      | `Home` / `End`                                                                                                                                                       | first/last question; jump between question and observatie blocks                                                                                                         | `scores.js:1531-1552`                                                                     |
|                                                      | `0` / `1` on an observatie cell                                                                                                                                      | uncheck / check                                                                                                                                                          | `scores.js:1555-1560`                                                                     |
|                                                      | `F1`…`Fn` (no modifiers)                                                                                                                                             | toggle the n-th observatie of the current student, selection unchanged                                                                                                   | `scores.js:1564-1572` (regex allows F1–F99; header tooltip lists F1–F12, `scores.js:905`) |
|                                                      | any printable key on an observatie cell                                                                                                                              | swallowed (no editor)                                                                                                                                                    | `scores.js:1434-1447` (`beforeKeyDown`)                                                   |
|                                                      | `Tab`                                                                                                                                                                | custom `tabMoves`: next question → first observatie → next student's first question                                                                                      | `scores.js:1290-1325`                                                                     |
|                                                      | `Ctrl+Z` / `Ctrl+Y`, `Ctrl+Shift+Z`                                                                                                                                  | intended app-level undo/redo (document listener) — see quirk Q1: the listener is removed again by `loadScoreGrid`                                                        | `scores.js:204-214`                                                                       |
| Context menu (cell)                                  | right click on overwritten grade                                                                                                                                     | "Berekend cijfer herstellen" / "Waarschuwing negeren"                                                                                                                    | `scores.js:1054-1077`                                                                     |
| Dialogs                                              | `Escape`, `Tab`                                                                                                                                                      | cancel; cycle buttons                                                                                                                                                    | `app.js:236-247`                                                                          |
| Menus                                                | `Escape`                                                                                                                                                             | close (capture, stops propagation)                                                                                                                                       | `scores.js:712-716`, `toetsen.js:613`                                                     |
| CustomSelect                                         | `Escape`                                                                                                                                                             | close                                                                                                                                                                    | `custom-select.js:62-64`                                                                  |
| Spinners                                             | `ArrowUp` / `ArrowDown`                                                                                                                                              | step value                                                                                                                                                               | `utils/spinners.js:39-46`                                                                 |
| School inline edit                                   | `Enter` / `Escape`                                                                                                                                                   | save / cancel                                                                                                                                                            | `school.js:197-200`                                                                       |
| Typst editor                                         | CodeMirror default + history keymaps; `Ctrl+V` with an image on the clipboard inserts a figure; `Ctrl`+wheel zooms preview; `Enter`/`Escape` in the image-name popup | `editor-init.js:693` (`defaultKeymap`, `historyKeymap`, `indentWithTab`), `:537-545`, `:1279-1282`, `:1368`                                                              |
| PDF viewer                                           | `ArrowLeft`/`PageUp`, `ArrowRight`/`PageDown`, `Enter` in page field                                                                                                 | `pdf-viewer.js:263-272`                                                                                                                                                  |

## 9. Background-change (Sync) wiring

`renderer/sync.js` exposes `on(type, handler) → off` and `start()` (`sync.js:22-59`). `start()`
subscribes once to `window.rtti.onDataChanged` and processes changes one at a time: each change
first goes through `Store.applyExternalChange(change)` (cache patch, `store.js:1399`) and is then
dispatched to handlers of `ev.type` and `'*'`. Event shape:
`{ type, kind, relPath, year, subject, id, before, after, meta, inScope }` (`sync.js:9`). Types used:
`students`, `group`, `exam`, `scores`, `observatie`, `opdracht`, `gebruikers`, `presence`, `*`.

| Subscriber                       | Types         |
| -------------------------------- | ------------- |
| `app.js:1039` (`SCREEN_REFRESH`) | `*`           |
| `app.js:1052` (new-exam card)    | `exam`        |
| `presence.js:122`                | `presence`    |
| Modals via `onModalSync`         | see section 4 |

## 10. Per-file inventory (generated)

Generated by a script over the reference sources (regexes for `Store.x`, `window.rtti.x`,
`Sync.on('t')`/`onModalSync('t')`, `export function`, `data-action="…"`, `e.key/e.code === '…'`,
`type: 'rtti-…'`); numbers are line numbers in that file.

### `renderer/app.js` (1106 lines)

- **Store**: `isAdminActive` (41); `loadUsers` (298, 967, 1061); `fullName` (299, 969, 1088); `loadYear` (375, 383, 390); `preloadScores` (392); `saveFilterState` (871); `getSchoolSync` (884); `loadFilterState` (886); `getConfigSync` (998); `getActiveSubject` (1044); `getActiveUser` (1054); `preload` (1099)
- **Bridge** (`window.rtti.*`): `readPhotoAsDataUrl` (957)
- **Sync events** (`Sync.on` / `onModalSync`): `*` (1039); `exam` (1052)
- **Exports**: `navigateTo` (30); `pushModalChart` (102); `showModal` (117); `closeModal` (131); `guardModalClose` (166); `formSnapshot` (188); `confirmDialog` (208); `onModalSync` (266); `onModalCleanup` (271); `modalRefresher` (281); `changedByName` (296); `showReloadNotice` (307); `toast` (329); `persistentError` (341); `escHtml` (355); `formatGrade` (363); `getAdminSubjectFilter` (400); `getSchoolsoortFilter` (480); `getJaarlagFilter` (483); `getJaarlagKlasFilter` (486); `getEigenOnly` (489); `matchesJaarlaagFilter` (498); `getObservatieFilter` (788); `setObservatieFilterOptions` (793); `showUserBadge` (915)
- **Keys handled**: `Escape` (238); `Tab` (241)

### `renderer/sync.js` (60 lines)

- **Store**: `applyExternalChange` (6, 50)
- **Bridge** (`window.rtti.*`): `onDataChanged` (46)
- **Sync events** (`Sync.on` / `onModalSync`): `scores` (14)
- **Exports**: `on` (22); `start` (43)

### `renderer/presence.js` (191 lines)

- **Bridge** (`window.rtti.*`): `updatePresence` (44, 76); `readAllJson` (66)
- **Sync events** (`Sync.on` / `onModalSync`): `presence` (122)
- **Exports**: `start` (60); `stop` (72); `setScoreModal` (84); `setPosition` (90); `markEdit` (99); `online` (135); `inScoreModal` (151); `onChange` (161); `badgeHtml` (182)

### `renderer/custom-select.js` (178 lines)

- **Keys handled**: `Escape` (63)

### `renderer/editor-init.js` (1685 lines)

- **`data-action` values**: `figure` (1219)
- **Keys handled**: `Enter` (1280); `Escape` (1281)

### `renderer/pdf-viewer.js` (287 lines)

- **Keys handled**: `Enter` (264); `ArrowLeft` (269); `PageUp` (269); `ArrowRight` (271); `PageDown` (271)

### `renderer/screens/gebruikers.js` (252 lines)

- **Store**: `loadUsers` (32, 90, 98); `upsertUser` (102, 245); `getSchoolSync` (126)
- **Bridge** (`window.rtti.*`): `savePhoto` (222)
- **Exports**: `renderGebruikers` (12)
- **`data-action` values**: `edit-user` (60, 88); `toggle-user` (61, 96)

### `renderer/screens/groepen.js` (274 lines)

- **Store**: `getConfigSync` (36, 170); `listYearsSync` (37); `isAdminActive` (44, 74, 81, 105, 147, 153); `getGroupsSync` (68); `getStudentsSync` (69, 195); `loadUsers` (70); `getActiveSubject` (81); `getActiveUser` (86); `fullName` (131); `getExams` (199); `getStudentScores` (222); `examResults` (228)
- **Exports**: `renderGroepen` (35); `renderGroepenForYear` (67)
- **`data-action` values**: `open-group` (147, 165); `edit-group` (156, 175); `del-group` (157, 178)

### `renderer/screens/leerlingen.js` (214 lines)

- **Store**: `getConfigSync` (36); `listYearsSync` (37); `isAdminActive` (52, 109, 154, 160, 187, 202); `getStudentsSync` (70); `getActiveSubject` (72); `getActiveUser` (77); `getGroupsSync` (110, 204); `fullName` (121, 154); `jaarlaagFromStamklas` (140); `studentHasAnyScores` (188); `studentHasScores` (189)
- **Exports**: `renderLeerlingen` (35); `renderStudentList` (65)
- **`data-action` values**: `profile` (154, 174); `edit-student` (163, 179); `del-student` (164, 182, 193)

### `renderer/screens/observaties.js` (387 lines)

- **Store**: `getObservatiesSync` (82, 197); `getActiveSubject` (86, 207, 214); `getActiveUser` (91); `isAdminActive` (137); `getConfigSync` (138); `getGroupsSync` (139); `obsIsUsedInAnyExam` (174); `deleteObservation` (191); `getSchoolSync` (219); `upsertObservation` (376)
- **Exports**: `renderObservaties` (81); `deleteObs` (188); `openObsModal` (196)
- **`data-action` values**: `edit-obs` (173, 181); `del-obs` (174, 184)

### `renderer/screens/opdrachten.js` (382 lines)

- **Store**: `getOpdrachten` (40); `getOpdrachtenSync` (43, 123, 167); `copyOpdracht` (141); `deleteOpdracht` (156); `getSchoolSync` (184); `upsertOpdracht` (365)
- **Bridge** (`window.rtti.*`): `readAllJson` (41, 165); `createAssignmentTypFile` (362)
- **Exports**: `renderOpdrachten` (35)
- **`data-action` values**: `open-editor` (107, 121); `edit-opdracht` (113, 128); `copy-opdracht` (114, 131); `del-opdracht` (115, 134)

### `renderer/screens/school.js` (276 lines)

- **Store**: `loadSchool` (15); `saveSchool` (126, 184, 239)
- **Bridge** (`window.rtti.*`): `readPhotoAsDataUrl` (17, 18, 246); `savePhoto` (235)
- **Exports**: `renderSchool` (11)
- **`data-action` values**: `edit-field` (64, 114, 157); `edit-watermerk` (93, 134)
- **Keys handled**: `Enter` (198); `Escape` (199)

### `renderer/screens/scores.js` (1579 lines)

- **Store**: `getExamsSync` (139, 408, 420); `setExamNTerm` (187); `getActiveSubject` (225, 231, 308); `loadUsers` (307); `fullName` (313, 391, 463); `getGroupsSync` (368); `getStudentsSync` (385, 426); `getObservatiesSync` (386, 448); `getConfigSync` (419); `getStudentScores` (455); `calcResults` (566, 579); `setObservation` (978); `setGradeOverride` (1008); `setScore` (1385, 1407, 1411, 1416, 1422)
- **Sync events** (`Sync.on` / `onModalSync`): `scores` (230); `exam` (238)
- **Exports**: `destroyHotInstances` (114); `openScoreModal` (137); `examGroups` (366); `groupStudentsOf` (377); `loadScoreGrid` (411); `recomputeRow` (536); `recomputeSummaryRow` (595); `createGroupHOT` (730)
- **Keys handled**: `0` (1555); `1` (1555, 1558); `z` (205, 209); `y` (209); `NumpadDecimal` (1464); `Enter` (1474); `NumpadEnter` (1475); `NumpadMultiply` (1476); `NumpadDivide` (1500); `NumpadSubtract` (1509); `NumpadAdd` (1520); `Home` (1531); `End` (1543)

### `renderer/screens/startup.js` (124 lines)

- **Store**: `loadUsers` (12); `loadLastSession` (12); `SUBJECT_DISPLAY` (17, 38); `setActiveUser` (112); `initSubject` (113); `saveLastSession` (114)
- **Bridge** (`window.rtti.*`): `readPhotoAsDataUrl` (84)
- **Exports**: `renderStartup` (9)

### `renderer/screens/toetsen.js` (637 lines)

- **Store**: `getConfigSync` (51, 382, 388); `listYearsSync` (52); `preloadScores` (62); `getStudentsSync` (66, 98); `getStudentScores` (73, 101); `examResults` (74); `fullName` (114, 116, 162); `computeBestGradeMap` (122); `getActiveSubject` (155, 175); `loadUsers` (156); `getExamsSync` (172, 525); `isAdminActive` (175, 202); `getActiveUser` (180); `getGroupsSync` (203); `examHasResits` (482); `examHasScores` (484)
- **Exports**: `renderToetsen` (50); `computeExamStats` (65); `computeExamWarnings` (97); `computeBestGradeStats` (121); `renderToetsenList` (170)
- **`data-action` values**: `exam-menu` (304, 378); `exam-overview` (311, 317, 340, 347, 380); `exam-overview-best` (357, 362, 386)
- **Keys handled**: `Escape` (613)

### `renderer/modals/editor.js` (107 lines)

- **Bridge** (`window.rtti.*`): `readTextFile` (63); `writeTextFile` (66); `renderAssignmentPdf` (69); `renderAssignmentSvg` (72); `listOpdrachtImages` (75); `pickImageFile` (83); `readClipboardImage` (91); `getDataDir` (94)
- **Exports**: `openEditor` (11)
- **postMessage types**: `rtti-response` (58)

### `renderer/modals/groep-edit.js` (661 lines)

- **Store**: `getConfigSync` (18, 422); `getStudents` (19); `loadUsers` (19, 456); `getGroups` (30, 361, 646); `getGroupsSync` (32, 605); `getSchoolSync` (58); `getActiveSubject` (76); `jaarlaagFromStamklas` (102); `fullName` (114); `parseGroupName` (344, 534); `upsertGroup` (391, 395, 651); `makeGroupId` (394, 536); `deleteGroup` (423); `getConfig` (450, 575); `listYearsSync` (451, 576); `upsertGroups` (565); `getStudentsSync` (606)
- **Sync events** (`Sync.on` / `onModalSync`): `group` (213)
- **Exports**: `openGroupModal` (17); `deleteGroup` (419); `openGroupCSVImport` (449); `openGroupAssignmentCSVImport` (574)

### `renderer/modals/groep-leerlingen.js` (350 lines)

- **Store**: `getGroupsSync` (23); `getStudentsSync` (25); `getExamsSync` (31); `getStudentScores` (52); `resolveBestAttempts` (59); `getStudentHistory` (59); `calcResults` (64); `examResults` (75); `fullName` (162); `getActiveSubject` (307)
- **Sync events** (`Sync.on` / `onModalSync`): `scores` (306); `exam` (310); `group` (313); `students` (324)
- **Exports**: `openGroupStudentsModal` (22)
- **`data-action` values**: `open-student-from-group` (160, 337)

### `renderer/modals/herkansing.js` (275 lines)

- **Store**: `getExams` (8, 154); `getResitsSync` (11, 157); `makeExamId` (122); `computeBestGradeMap` (145); `upsertExam` (241, 255)
- **Exports**: `openResitModal` (7); `openBestGradesOverviewModal` (144); `openSummaryEditModal` (153)

### `renderer/modals/leerling-edit.js` (279 lines)

- **Store**: `getSchoolSync` (32); `getConfigSync` (92); `getStudents` (127); `upsertStudent` (165); `deleteStudent` (189); `getConfig` (196); `listYearsSync` (197); `upsertStudents` (270)
- **Sync events** (`Sync.on` / `onModalSync`): `students` (97)
- **Exports**: `openStudentModal` (27); `deleteStudent` (186); `openStudentCSVImport` (195)

### `renderer/modals/opdrachten-genereren.js` (540 lines)

- **Store**: `getExamsSync` (22); `getActiveSubject` (24, 160, 414); `getOpdrachten` (25); `getObservaties` (25); `getOpdrachtCoupling` (30); `getOpdrachtCijferCards` (31); `getOpdrachtAssignments` (36, 283); `getOpdrachtenSync` (107, 162); `cijferCardReason` (108); `opdrachtMatchesExam` (116, 122, 175, 186); `getObservatiesSync` (160); `fullName` (255, 326); `setExamOpdrachten` (301)
- **Bridge** (`window.rtti.*`): `onAssignmentProgress` (376); `renderAssignmentBatch` (382); `openPath` (494)
- **Sync events** (`Sync.on` / `onModalSync`): `scores` (507); `students` (510); `group` (513); `opdracht` (516); `observatie` (517); `exam` (518)
- **Exports**: `openOpdrachtenGenererenModal` (21)
- **`data-action` values**: `og-show-all` (49); `og-cijfer-add` (54); `og-all-on` (60); `og-all-off` (61); `og-answers` (68); `og-key` (71, 276); `og-generate` (72, 275); `og-back` (77, 368); `og-couple-cijfer` (125); `og-cijfer-onder` (142); `og-cijfer-remove` (146); `og-couple` (193); `og-student` (253)

### `renderer/modals/profiel.js` (1155 lines)

- **Store**: `getActiveSubject` (25, 28); `getConfigSync` (52); `getStudents` (53); `getStudentHistory` (57, 729); `resolveBestAttempts` (58, 729); `fullName` (63, 135, 218, 228); `calcResults` (75, 82, 671); `jaarlaagFromStamklas` (106, 699, 723); `getObservatiesSync` (110); `getExamsSync` (113, 683, 701); `getStudentScores` (114, 684, 710); `examResults` (652); `getStudentsSync` (697, 722)
- **Sync events** (`Sync.on` / `onModalSync`): `scores` (24); `exam` (27); `students` (30)
- **Exports**: `openProfielModal` (46)

### `renderer/modals/rapport.js` (754 lines)

- **Store**: `SUBJECT_DISPLAY` (92); `loadYear` (180); `preloadScores` (181); `getObservaties` (182); `getStudentsSync` (185); `getGroupsSync` (186); `jaarlaagFromStamklas` (190); `getStudentScores` (197); `calcResults` (202); `getObservatiesSync` (209); `fullName` (253); `getExamsSync` (325); `getActiveSubject` (539)
- **Bridge** (`window.rtti.*`): `readJson` (248, 545); `renderRapportPdf` (281); `openPath` (316); `writeJson` (736)
- **Exports**: `openRapportModal` (324); `openRttiUitlegModal` (538)

### `renderer/modals/toets-edit.js` (760 lines)

- **Store**: `getConfig` (19); `loadYear` (21); `getActiveSubject` (23); `getSchoolSync` (24); `makeExamId` (258); `getExams` (282); `examHasScores` (294, 747); `examHasResits` (298, 743); `getObservatiesSync` (379); `removeObsFromExamScores` (709); `upsertExam` (711); `getConfigSync` (742); `deleteExam` (756)
- **Sync events** (`Sync.on` / `onModalSync`): `exam` (496)
- **Exports**: `openExamModal` (18); `extractBoundaries` (303); `secIndexOf` (318); `cascadeStructure` (332); `showExamEditor` (359); `deleteExam` (741)

### `renderer/modals/toets-overzicht.js` (1288 lines)

- **Store**: `getExams` (39, 1018); `getStudentsSync` (44); `getGroupsSync` (48); `getObservatiesSync` (58); `getStudentScores` (71, 1023); `calcResults` (103, 226); `fullName` (267); `getActiveSubject` (1276)
- **Sync events** (`Sync.on` / `onModalSync`): `scores` (1275); `exam` (1278)
- **Exports**: `openExamOverviewModal` (32)

### `renderer/utils/colors.js` (59 lines)

- **Exports**: `examTypeColor` (7); `hexToRgb` (13); `lerpColor` (21); `stdDevGradeColor` (27); `isFail` (38); `gradeColor` (42); `rttiPctColor` (50)

### `renderer/utils/csv.js` (111 lines)

- **Exports**: `parseCSV` (3); `askSchoolYear` (51)

### `renderer/utils/grades.js` (57 lines)

- **Exports**: `gradeGroupIdx` (9); `gradeChartColor` (19); `gradeTextColor` (24); `gradeBorderColor` (30); `gradeCell` (37); `gradeStatHtml` (48)

### `renderer/utils/icons.js` (31 lines)

### `renderer/utils/spinners.js` (58 lines)

- **Exports**: `wireSpinners` (8); `spinnerValue` (53)
- **Keys handled**: `ArrowUp` (40); `ArrowDown` (44)
