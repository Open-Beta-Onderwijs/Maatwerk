# IPC API (reference app)

Spec of the Electron IPC surface of the reference app (`_reference/`, commit in
[VERSION.md](VERSION.md)). Describes behaviour as-is; it is not a design. Line numbers are
`_reference/<file>:<line>`.

- 32 `ipcMain.handle` channels, all in `main.js`.
- 34 bridge members on `window.rtti` (`preload.js:3-123`): 32 `invoke` wrappers (one per
  channel, 1:1) + 2 event subscriptions (`onDataChanged`, `onAssignmentProgress`).
- 2 main -> renderer events: `data:changed`, `assignment:progress`.
- No handler lacks a bridge method; the only bridge members without a handler are the two event
  subscriptions.
- Unused from the renderer: `listScoreFiles`, `typstVersion`, `compileTypst` (no call site);
  `renderAssignmentPdf` is only reachable through the editor proxy case `rtti-render-assignment`
  (`renderer/modals/editor.js:68`), which the editor iframe never sends.

## Conventions

- **Base dirs.** `appDir` = folder of `main.js` in dev, else `PORTABLE_EXECUTABLE_DIR` or the exe
  folder (`main.js:17-20`). `dataDir` = `<appDir>/data`, created on every call of `getDataDir()`
  (`main.js:22-26`). `tempDir` = `<appDir>/temp` (**not** inside `data/`). `templatesDir` =
  `<__dirname or exe dir>/include/templates` (`main.js:960-963`). Session file =
  `<userData>/session.json` (`main.js:439-441`).
- **`relPath`** arguments are joined to `dataDir` with `path.join` and **never validated**
  (no `..`/absolute check) unless stated.
- **Errors.** There is no common error shape. Four styles occur:
  - `{ ok: false, reason }` (fs writes/deletes), `reason` = `'conflict' | 'locked' | <e.message>`;
  - `{ ok: false, error }` / `{ ok: false, exists: true, name }` (opdracht images);
  - `{ success: false, error }` (Typst handlers; `error` = Typst stderr or `e.message`);
  - `null` on failure (`readJson`, `readPhotoAsDataUrl`, `readLocalSession`);
  - anything not caught in a handler **rejects** the `invoke` promise (Electron wraps the
    message as `Error invoking remote method '<channel>': <message>`).
- **Own-write suppression.** "noteWrite" = `watcher.noteWrite(relPath, content)` after the
  write, so the change is not echoed back as `data:changed` (see
  [data-files.md](data-files.md#watcher)). Writes without noteWrite are noted per handler.
- **Locking.** "lock" = `acquireLock`/`releaseLock` on `<file>.lock` (`main.js:31-48`), only for
  paths that do not contain `/scores/`.

## Summary

| #   | Channel                       | Bridge method             | Line | Result (success)                      | Renderer callers                                                                      |
| --- | ----------------------------- | ------------------------- | ---- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `fs:readJson`                 | `readJson`                | 56   | parsed JSON or `null`                 | store.js (13 sites), modals/rapport.js:248, :545                                      |
| 2   | `fs:readJsonVersioned`        | `readJsonVersioned`       | 70   | `{ data, hash }`                      | store.js:72                                                                           |
| 3   | `fs:writeJson`                | `writeJson`               | 86   | `{ ok: true, hash }`                  | store.js:45, :75, migration (21 sites), modals/rapport.js:736                         |
| 4   | `fs:listYears`                | `listYears`               | 124  | `string[]` newest first               | store.js:271, :320, :323, :916                                                        |
| 5   | `fs:ensureYear`               | `ensureYear`              | 142  | absolute year dir `string`            | store.js:305, :847                                                                    |
| 6   | `fs:listScoreFiles`           | `listScoreFiles`          | 153  | `string[]` student ids                | none                                                                                  |
| 7   | `fs:readAllJson`              | `readAllJson`             | 163  | `any[]`                               | store.js:283, :291, :299, :982, :1154; presence.js:66; screens/opdrachten.js:41, :165 |
| 8   | `fs:deleteFile`               | `deleteFile`              | 181  | `{ ok: true }`                        | store.js:487, :572, :798, :986, :1201, :1203                                          |
| 9   | `fs:ensureDir`                | `ensureDir`               | 208  | `undefined`                           | store.js:938, :950, :964                                                              |
| 10  | `fs:getDataDir`               | `getDataDir`              | 213  | absolute `string`                     | modals/editor.js:94 (proxy for editor-init.js:676)                                    |
| 11  | `fs:readTextFile`             | `readTextFile`            | 216  | `string` or `null`                    | store.js:1183; modals/editor.js:63 (proxy, editor-init.js:675)                        |
| 12  | `fs:writeTextFile`            | `writeTextFile`           | 223  | `{ ok: true }`                        | store.js:1187; modals/editor.js:66 (proxy, editor-init.js:640)                        |
| 13  | `app:createAssignmentTypFile` | `createAssignmentTypFile` | 231  | `{ ok: true }`                        | store.js:1185; screens/opdrachten.js:362                                              |
| 14  | `opdracht:listImages`         | `listOpdrachtImages`      | 284  | `[{ file, name, thumb }]`             | modals/editor.js:75 (proxy, editor-init.js:1225, :1237)                               |
| 15  | `opdracht:saveImage`          | `saveOpdrachtImage`       | 302  | `{ ok: true, file, name }`            | modals/editor.js:79 (proxy, editor-init.js:1301)                                      |
| 16  | `opdracht:pickImage`          | `pickImageFile`           | 308  | `{ token, name, ext }` or `null`      | modals/editor.js:83 (proxy, editor-init.js:1347)                                      |
| 17  | `opdracht:importImage`        | `importOpdrachtImage`     | 323  | `{ ok: true, file, name }`            | modals/editor.js:87 (proxy, editor-init.js:1308)                                      |
| 18  | `clipboard:readImage`         | `readClipboardImage`      | 338  | base64 PNG `string` or `null`         | modals/editor.js:91 (proxy, editor-init.js:1332, :1653)                               |
| 19  | `opdracht:copyImages`         | `copyOpdrachtImages`      | 344  | `{ ok: true }`                        | store.js:1191                                                                         |
| 20  | `opdracht:deleteImages`       | `deleteOpdrachtImages`    | 373  | `{ ok: true }`                        | store.js:1205                                                                         |
| 21  | `presence:update`             | `updatePresence`          | 428  | `undefined`                           | presence.js:44, :76                                                                   |
| 22  | `fs:readLocalSession`         | `readLocalSession`        | 443  | object or `null`                      | store.js:173, :178, :182, :194                                                        |
| 23  | `fs:writeLocalSession`        | `writeLocalSession`       | 453  | `undefined`                           | store.js:174, :190                                                                    |
| 24  | `fs:readPhotoAsDataUrl`       | `readPhotoAsDataUrl`      | 460  | data URL `string` or `null`           | app.js:957; screens/school.js:17, :18, :246; screens/startup.js:84                    |
| 25  | `fs:savePhoto`                | `savePhoto`               | 479  | `undefined`                           | screens/gebruikers.js:222; screens/school.js:235                                      |
| 26  | `typst:version`               | `typstVersion`            | 519  | `{ success: true, version }`          | none                                                                                  |
| 27  | `typst:compile`               | `compileTypst`            | 532  | `{ success: true, outputPdfPath }`    | none                                                                                  |
| 28  | `app:renderRapportPdf`        | `renderRapportPdf`        | 546  | `{ success: true, pdfPath }`          | modals/rapport.js:281                                                                 |
| 29  | `app:renderAssignmentPdf`     | `renderAssignmentPdf`     | 693  | `{ success: true, pdfPath }`          | modals/editor.js:69 (proxy case never triggered)                                      |
| 30  | `app:renderAssignmentSvg`     | `renderAssignmentSvg`     | 737  | `{ success: true, pages: string[] }`  | modals/editor.js:72 (proxy, editor-init.js:588)                                       |
| 31  | `app:renderAssignmentBatch`   | `renderAssignmentBatch`   | 827  | `{ success: true, pdfPath, pages }`   | modals/opdrachten-genereren.js:382                                                    |
| 32  | `shell:openPath`              | `openPath`                | 934  | `''` (Electron: empty = ok, else msg) | modals/opdrachten-genereren.js:494; modals/rapport.js:316                             |

`store.js` `readJson` sites: 38 (`load`), 829, 834, 835, 891, 919, 924, 948, 962, 974 (migration),
1412 (`applyExternalChange`). `writeJson` migration sites: 876-909, 940-978, 985.

## Handlers

### 1. `fs:readJson(relPath: string)` — `main.js:56`

- Result: parsed JSON; `null` if the file is missing **or** unparsable (logged, not
  distinguishable from missing).
- Never rejects (missing -> `null` via `existsSync`; read and parse errors caught -> `null`).
- Side effects: none. Validation: none.

### 2. `fs:readJsonVersioned(relPath: string)` — `main.js:70`

- Result: `{ data, hash }`; `{ data: null, hash: null }` if missing. `hash` = SHA-1 hex of the
  raw bytes (`sync.js:24-26`).
- Error: `{ error: string }` if unreadable/unparsable (callers must not overwrite;
  `store.js:73` throws `Bestand <relPath> is onleesbaar: …`).
- Side effects: none.

### 3. `fs:writeJson(relPath: string, data: any, opts?: { cas?: boolean, expectedHash?: string|null })` — `main.js:86`

- Serialises `JSON.stringify(data, null, 2)` (no trailing newline), writes with
  `writeFileAtomic`, then noteWrite.
- CAS (`opts.cas`): re-reads the file; writes only if the current hash equals
  `opts.expectedHash` (`null`/absent = file must not exist) (`main.js:91-96`).
- Lock: non-score paths (`!relPath.includes('/scores/')`) take `<file>.lock` first; mkdir of the
  parent happens before the lock (`main.js:110`).
- Result: `{ ok: true, hash }` (hash of the written content).
- Error: `{ ok: false, reason: 'conflict' }` (CAS mismatch), `{ ok: false, reason: 'locked' }`
  (fresh lock file present), `{ ok: false, reason: e.message }` (write threw). `acquireLock`
  itself is outside the try, so a lock-file error rejects.
- `data === null` writes the literal file `null` (used by migration to "empty" legacy files).

### 4. `fs:listYears()` — `main.js:124`

- Result: names in `dataDir` matching `^\d{4}-\d{4}$` that are directories, sorted descending.
  `[]` on any error.

### 5. `fs:ensureYear(year: string)` — `main.js:142`

- Creates `<year>/exams`, `<year>/groups`, `<year>/scores/{nat,bio,schk,wi}` (recursive).
- Result: absolute year dir. Validation: none (any string). Errors reject.

### 6. `fs:listScoreFiles(year: string, subject: string)` — `main.js:153`

- Result: file names in `<year>/scores/<subject>/` ending in `.json`, minus the first `.json`.
  `[]` if the dir is missing. Not used by the renderer.

### 7. `fs:readAllJson(dirRelPath: string)` — `main.js:163`

- Result: parsed contents of every `*.json` directly in the dir (non-recursive), in `readdir`
  order; skips directories, unparsable files and `null` contents silently. File names are not
  returned. `[]` if the dir is missing.

### 8. `fs:deleteFile(relPath: string)` — `main.js:181`

- Deletes the file if it exists, then `noteDelete(relPath)`. Lock as in `writeJson`, but
  **without** mkdir (missing parent dir -> `writeFileSync` of the lock throws -> rejects).
- Result: `{ ok: true }` (also when the file did not exist). Error: `{ ok: false, reason }`
  (`'locked'` or `e.message`). Store callers ignore the result (`store.js:487`, `:572`, `:798`,
  `:1201`, `:1203`).

### 9. `fs:ensureDir(relPath: string)` — `main.js:208`

- `mkdir -p`. Result `undefined`; errors reject.

### 10. `fs:getDataDir()` — `main.js:213`

- Result: absolute `dataDir` (and creates it). Used by the editor only as a truthy "ready" flag
  (`editor-init.js:678`, `:637`).

### 11. `fs:readTextFile(relPath: string)` — `main.js:216`

- Result: UTF-8 string, `null` if missing. Other read errors reject.

### 12. `fs:writeTextFile(relPath: string, content: string)` — `main.js:223`

- `writeFileAtomic` + noteWrite. **No lock, no CAS.** Result `{ ok: true }`; errors reject.
- Used for opdracht `.typ` files (editor autosave 600 ms after typing, `editor-init.js:653`).

### 13. `app:createAssignmentTypFile(typFile: string)` — `main.js:231`

- Copies `templatesDir/base_assignment.typ` to `data/opdrachten/<typFile>` (atomic + noteWrite).
  Overwrites an existing file. Validation: none on `typFile`. Result `{ ok: true }`.

### 14. `opdracht:listImages(opdrachtId: string)` — `main.js:284`

- Validation: `opdrachtId` must match `^[\w-]+$` else throws `Ongeldige opdracht.` (rejects).
- Result: files in `data/opdrachten/images/<id>/` with extension in
  `png|jpg|jpeg|gif|svg|webp` (case-insensitive), sorted `localeCompare(…, 'nl')`:
  `{ file: 'images/<id>/<f>', name: <basename without ext>, thumb: dataURL|null }`. `thumb` =
  `nativeImage` resized to 48 px height, PNG data URL; `null` when the image cannot be decoded
  (SVG). `[]` if the dir is missing.

### 15. `opdracht:saveImage(opdrachtId, name, ext, base64, overwrite?)` — `main.js:302`

- Decodes base64 and calls `storeOpdrachtImage` (`main.js:267-281`):
  - `name` cleaned by `cleanImageName` (`main.js:255-262`): NFD, strip combining marks,
    `[^A-Za-z0-9_-]+` -> `-`, trim `-`, max 60 chars. Empty -> `{ ok: false, error: 'Geef de
afbeelding een naam.' }`.
  - `ext` lower-cased, must be in the list -> else `{ ok: false, error: 'Bestandstype .<ext>
wordt niet ondersteund.' }`.
  - Creates the dir; any existing file with the same basename (any extension) ->
    `{ ok: false, exists: true, name }` unless `overwrite`; with `overwrite` those files are
    deleted first.
  - Writes `<name>.<ext>` atomically + noteWrite.
- Result `{ ok: true, file: 'images/<id>/<name>.<ext>', name }` (`file` relative to
  `data/opdrachten`). Invalid id rejects.

### 16. `opdracht:pickImage()` — `main.js:308`

- Opens a native open-file dialog (title `Afbeelding kiezen`, filter = image exts) parented to
  the sender window. Stores the chosen absolute path in an in-memory `Map` under an incrementing
  token (`main.js:244-245`).
- Result `{ token: string, name: cleaned basename, ext: lower-case ext without dot }` or `null`
  (cancelled). Tokens live until imported successfully or the app quits.

### 17. `opdracht:importImage(opdrachtId, token, name, overwrite?)` — `main.js:323`

- Unknown token -> `{ ok: false, error: 'Kies de afbeelding opnieuw.' }`.
- Otherwise reads the picked file and calls `storeOpdrachtImage` with the source extension;
  same results as #15. Token deleted on success only.

### 18. `clipboard:readImage()` — `main.js:338`

- Result: clipboard image as base64 PNG, or `null` if none.

### 19. `opdracht:copyImages(fromId, toId)` — `main.js:344`

- Both ids validated (`^[\w-]+$`, throws). If the source dir is missing -> `{ ok: true }`.
- Copies every entry of the source dir (atomic write + noteWrite each; subdirectories would make
  `readFileSync` throw). Result `{ ok: true }`.

### 20. `opdracht:deleteImages(opdrachtId)` — `main.js:373`

- Id validated. Deletes every entry (`rmSync`, `maxRetries: 5`), then `removeDirLater(dir)`:
  `rmSync` the folder, retried every 5 s up to 24 attempts (~2 min) in the background
  (`main.js:360-371`). **No noteDelete.** Result `{ ok: true }`.

### 21. `presence:update(userId: string|null, state?: object)` — `main.js:428`

- If a different user was last written, that user's file is first marked offline
  (`markPresenceOffline`, `main.js:416-425`: `{ ...state, online: false, scoreModal: null,
heartbeatAt: now }`).
- `userId` falsy -> stop. Else remembers `{ userId, state }` and writes
  `data/users/<userId>.json` = `JSON.stringify(state, null, 2)` (atomic + noteWrite; errors only
  logged) (`main.js:405-414`). No lock, no validation of `userId`.
- Result `undefined`. Also called internally on `before-quit` and `window-all-closed`
  (`main.js:1020-1022`).

### 22. `fs:readLocalSession()` — `main.js:443`

- Result: parsed `<userData>/session.json` or `null` (missing/unparsable).

### 23. `fs:writeLocalSession(data: object)` — `main.js:453`

- Plain `writeFileSync` (not atomic) of `JSON.stringify(data, null, 2)`. Result `undefined`;
  errors reject. Callers do read-merge-write (`store.js:172-191`).

### 24. `fs:readPhotoAsDataUrl(relPath: string)` — `main.js:460`

- Result: `data:<mime>;base64,…` with mime from extension (`png`, `svg` -> `image/svg+xml`,
  `gif`, `webp`, anything else -> `image/jpeg`); `null` if missing or on error. Any path under
  `dataDir` (no restriction to `fotos/`).

### 25. `fs:savePhoto(relPath: string, base64Data: string)` — `main.js:479`

- mkdir parent, plain `writeFileSync` (not atomic, no noteWrite; `fotos/` is not watched
  anyway). Result `undefined`; errors reject.

### 26. `typst:version()` — `main.js:519`

- Spawns `<typst> --version`. Result `{ success: true, version: trimmed stdout }` or
  `{ success: false, error: err.message }`.

### 27. `typst:compile(typFilePath: string, outputPdfPath: string)` — `main.js:532`

- Spawns `typst compile --font-path <fonts> --package-path <packages> <in> <out>` with
  arbitrary absolute paths (no `--root`, no validation). Result
  `{ success: true, outputPdfPath }` or `{ success: false, error: stderr || err.message }`.

### 28. `app:renderRapportPdf(examId: string, students: object[], examInfo: object)` — `main.js:546`

- `examId` unused. Copies `templatesDir/rtti_export.typ` to `temp/rtti_export.typ`, writes
  `temp/_rapport_run.typ` (wrapper importing `setup, render`, data serialised by `toTypst`,
  `main.js:558-574`), compiles with `--root <appDir>` to `temp/rapport_preview.pdf`, deletes the
  wrapper (template copy stays).
- Result `{ success: true, pdfPath: <abs temp/rapport_preview.pdf> }` or
  `{ success: false, error }`. Copy/write errors before compile reject.
- Payload shapes (built in `modals/rapport.js:250-279`): see typst-contract.md.

### 29. `app:renderAssignmentPdf(typFile: string, title: string)` — `main.js:693`

- Wrapper `temp/_assignment_run.typ` from `buildAssignmentWrapper('/data/opdrachten/<typFile>',
placeholderHeader(title))` (`main.js:623-687`), compile to `temp/assignment_preview.pdf`,
  delete wrapper. **No `typFile` validation.** Results as #28.

### 30. `app:renderAssignmentSvg(typFile: string, title: string, previewContent?: string)` — `main.js:737`

- Validation: `typFile` must be a bare file name (`path.basename(typFile) === typFile`) else
  `{ success: false, error: 'Ongeldige bestandsnaam: <typFile>' }`.
- Ensures `temp/svg_preview/`, **deletes every file in it**, writes the editor text to
  `data/opdrachten/_preview_<typFile>` (inside the synced folder; not watched) and the wrapper
  `temp/_assignment_svg_run.typ` (with the `<__rtti_cursor>` foreground, `main.js:606-612`).
- Compiles to `temp/svg_preview/r<seq>-p{p}.svg` (`maxBuffer` 10 MB), deletes wrapper and
  preview copy, reads pages matching `^r<seq>-p(\d+)\.svg$` sorted numerically, deletes them.
- Result `{ success: true, pages: string[] }`; error `{ success: false, error }` where
  occurrences of `_preview_<typFile>` in stderr are replaced by `<typFile>`.

### 31. `app:renderAssignmentBatch(jobs: Job[], opts?: { includeAnswers?=true, duplex?=false, outputName?='opdrachten.pdf' })` — `main.js:827`

- `Job = { key: string, typFile: string, label?: string, header?: { title, student, group, exam,
observaties: [{ icon, name }] }, mode?: 'student'|'answers' }` (built in
  `modals/opdrachten-genereren.js:316-349`).
- Validation: non-empty array (`Er is niets om te genereren.`), each `typFile` and
  `outputName` bare file names (`Ongeldige bestandsnaam: …`).
- Writes wrappers `temp/opdrachten_run/b<seq>-<i>.typ`, compiles each to `b<seq>-<i>.pdf` with
  `BATCH_PARALLEL = max(2, min(4, cpus-1))` workers (`main.js:813`); first failure stops new
  jobs: `{ success: false, error: 'Fout in opdracht "<label|typFile>":\n\n<stderr>' }`.
- Emits `assignment:progress` to the sender (once with `done: 0`, then after each success).
- Merges with pdf-lib in job order; with `duplex`, before a job whose `key` differs from the
  previous one, a blank page (size of the last page) is added if the page count is odd.
- Writes `temp/<outputName>` (overwrites). Always deletes the run's `b<seq>-*` files.
- Result `{ success: true, pdfPath, pages: number }`; other errors `{ success: false, error:
e.message }`.

### 32. `shell:openPath(absPath: string)` — `main.js:934`

- `shell.openPath` with any path. Result: Electron's string (`''` on success, error text
  otherwise). Callers ignore it.

## Main -> renderer events

| Channel               | Sent by                                                      | To                       | Payload                                                                                                                                                                       | Bridge                                                                                                            |
| --------------------- | ------------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `data:changed`        | watcher `onChanges` (`main.js:1008-1014`, `sync.js:121-131`) | every `BrowserWindow`    | `Array<{ relPath: string (posix, relative to data/), kind: 'added'\|'changed'\|'deleted', meta: object\|null }>`; `meta` = the file's `_meta` for non-array JSON, else `null` | `onDataChanged(cb)` -> unsubscribe fn (`preload.js:21-25`); used by `renderer/sync.js:46`                         |
| `assignment:progress` | `app:renderAssignmentBatch` (`main.js:853-857`)              | the invoking webContents | `{ done: number, total: number }`                                                                                                                                             | `onAssignmentProgress(cb)` -> unsubscribe fn (`preload.js:112-116`); used by `modals/opdrachten-genereren.js:376` |

Renderer side of `data:changed`: `renderer/sync.js` queues changes one at a time, runs
`Store.applyExternalChange(change)` (`store.js:1399-1495`) which classifies `relPath` into
`type` (`scores | exam | group | students | observatie | opdracht | opdrachtTyp | gebruikers |
school | presence | other`, regexes `store.js:1362-1374`), patches the cache and dispatches
`{ type, kind, relPath, year, subject, id, before, after, meta, inScope }` to `Sync.on(type)` and
`Sync.on('*')` subscribers.

## Non-IPC message channels (renderer-internal)

- **Editor iframe proxy** (`renderer/editor-init.js:46-60` -> `renderer/modals/editor.js:51-106`):
  `postMessage({ type, id, ...args })`, answered with `{ type: 'rtti-response', id, result }`.
  Types: `rtti-read-text {path}`, `rtti-write-text {path, content}`, `rtti-render-assignment
{typFile, title}` (never sent), `rtti-render-assignment-svg {typFile, title, content}`,
  `rtti-list-images {opdrachtId}`, `rtti-save-image {opdrachtId, name, ext, base64, overwrite}`,
  `rtti-pick-image`, `rtti-import-image {opdrachtId, token, name, overwrite}`,
  `rtti-clipboard-image`, `rtti-get-data-dir`, plus `editor-close` and `editor-logout` (no
  reply). A rejected IPC call is never answered (no `.catch`), so the iframe promise hangs.
- **PDF viewer** (`renderer/pdf-viewer.html`): posts `{ type: 'print-pdf' }`; the rapport modal
  answers by calling `openPath(pdfPath)` (`modals/rapport.js:315-317`).

## Lifecycle hooks in main (not IPC, but observable)

- `app.whenReady` (`main.js:1005-1019`): `seedInitialData()` (copy `lib.typ`, seed
  `gebruikers.json`, mkdir `fotos/`, `opdrachten/images/`, remove empty image dirs),
  `cleanupStalePreviewFiles()` (delete `data/opdrachten/_preview_*.typ` older than 1 h), start
  the watcher, create the window.
- `before-quit` / `window-all-closed`: mark presence offline; close the watcher.
