# Shared `data/` folder (reference app)

Spec of the on-disk data of the reference app (`_reference/`, commit in
[VERSION.md](VERSION.md)). Describes behaviour as-is. Line numbers are `_reference/<file>:<line>`.
IPC details: [ipc-api.md](ipc-api.md). Draft JSON Schemas: [`docs/schemas/`](../schemas/README.md).

## Location

- `data/` = `<appDir>/data`; `appDir` = folder of `main.js` in dev, else
  `PORTABLE_EXECUTABLE_DIR` or the exe folder (`main.js:17-26`). The folder is shared between
  teachers through OneDrive.
- Not in `data/`: `<appDir>/temp/` (Typst wrappers and output PDFs/SVGs) and
  `<userData>/session.json` (machine-local).
- All JSON is written as `JSON.stringify(x, null, 2)`, UTF-8, no BOM, no trailing newline
  (`main.js:97`, `:407`, `:454`). Readers use `JSON.parse` on UTF-8 (`main.js:60`).

## Layout

```
data/
├── config.json                          { activeYear }
├── gebruikers.json                      User[]            (seeded on first start)
├── school.json                          School
├── fotos/                               user photos, school logo + watermark (not watched)
├── users/<userId>.json                  Presence
├── observaties/<obsId>.json             Observatie        (_meta)
├── opdrachten/
│   ├── <opdrachtId>.json                Opdracht          (_meta)
│   ├── <typFile>                        Typst source, usually <opdrachtId>.typ
│   ├── lib.typ                          app-managed copy of include/templates/lib.typ
│   ├── _preview_<typFile>               transient editor preview copy
│   └── images/<opdrachtId>/<name>.<ext> figures
├── templates/RTTI explanations and advices/
│   └── rtti_expl_adv_<fileKey>_<jaar>.json   RttiTemplate (not watched)
├── <YYYY-YYYY>/
│   ├── students-<YYYY-YYYY>.json        Student[]
│   ├── exams/<examId>.json              Exam              (_meta)
│   ├── groups/<groupId>.json            Group             (_meta)
│   └── scores/<subject>/<studentId>.json ScoreRecord      (no lock)
├── *.lock                               lock sentinels next to any locked file
├── *.<pid>.tmp                          atomic-write temp files (transient)
└── legacy: students.json, groups.json, exams.json, observaties.json, scores/<id>.json,
    <year>/students.json, <year>/groups.json, <year>/exams.json, <year>/scores/<id>.json, *.bak
```

Path builders: `store.js:199-203` (`ypStudents`, `ypExam`, `ypGroup`, `ypObs`, `ypScore`).
`fs:ensureYear` creates `exams/`, `groups/`, `scores/{nat,bio,schk,wi}/` (`main.js:141-150`).
Year folders match `^\d{4}-\d{4}$` (`main.js:126`). The academic year is never stored inside
objects; `academic_year` is stripped on save (`store.js:461`, `:521`) and re-added in memory only
(`store.js:644`). The `subject` field inside a file is authoritative, not the path
(`store.js:20`, `:284`).

## File types

Types: `str`, `num`, `int`, `bool`, `[]` = array, `?` = optional / may be absent, `|null` =
nullable. "Concurrency" values: **CAS** = `Store.update` hash compare-and-swap (`store.js:69-87`);
**rev** = `saveEntity` `_meta.rev` check on top of CAS (`store.js:116-123`); **lock** =
`.lock` sentinel in main (`main.js:31-48`); **blind** = plain overwrite.

### `config.json`

| Field        | Type  | Meaning                                   |
| ------------ | ----- | ----------------------------------------- |
| `activeYear` | `str` | active school year `YYYY-YYYY` (selected) |

- Default when missing: `{ activeYear: currentSchoolYear() }` (August onwards = `Y-(Y+1)`,
  `store.js:338-373`). Never created on disk until `setActiveYear`.
- Writer: `Store.setActiveYear` -> `save()` = blind `writeJson` + lock (`store.js:363-367`).
- Also read synchronously by the watcher poll to decide which year folder to scan
  (`sync.js:185-191`).

### `gebruikers.json` — `User[]`

| Field                                     | Type        | Meaning                                                               |
| ----------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `id`                                      | `str`       | `'admin'` (seed) or `gebr-<Date.now()>` (`screens/gebruikers.js:230`) |
| `voornaam`, `tussenvoegsel`, `achternaam` | `str`       | name parts                                                            |
| `afkorting`                               | `str`       | initials (upper-cased; default first 3 letters of voornaam)           |
| `schoolsoort`                             | `str[]`?    | school types (absent on the seed user)                                |
| `vakken`                                  | `str[]`     | subjects `nat`/`bio`/`schk`/`wi`                                      |
| `kleur`                                   | `str`       | CSS colour `#rrggbb`                                                  |
| `foto`                                    | `str\|null` | data-relative photo path `fotos/<userId>.<png\|jpg>`                  |
| `isAdmin`                                 | `bool`      | admin account                                                         |
| `actief`                                  | `bool`      | active (toggle)                                                       |

- Seed on first start (no atomic write, no noteWrite): one admin user (`main.js:976-999`).
- Writer: `Store.upsertUser` = CAS, replace-or-append by `id` (`store.js:158-169`); callers
  `screens/gebruikers.js:102`, `:245`. Locked (non-score path). No `_meta` (array file).

### `school.json`

| Field                         | Type     | Meaning                                                     |
| ----------------------------- | -------- | ----------------------------------------------------------- |
| `naam`, `ondertitel`, `motto` | `str`?   | school texts (`screens/school.js:8`)                        |
| `schoolsoort`                 | `str[]`? | offered school types, values from `screens/school.js:9`     |
| `logo`                        | `str`?   | `fotos/school-logo.<ext>` (`screens/school.js:109`, `:230`) |
| `watermerk`                   | `str`?   | `fotos/school-watermerk.<ext>` (`screens/school.js:146`)    |

- Writer: `Store.saveSchool` = blind `writeJson` + lock (`store.js:154-156`). The whole cached
  object is rewritten.
- School types used across the app: `Vmbo-bb`, `Vmbo-kb`, `Vmbo-gl`, `Vmbo-tl`, `Havo`, `Vwo`,
  `Gymnasium`.

### `users/<userId>.json` — Presence

| Field         | Type          | Meaning                                                                                           |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `userId`      | `str`         | same as file name                                                                                 |
| `online`      | `bool`        | `false` after logout / user switch / quit                                                         |
| `heartbeatAt` | `str` ISO8601 | time of the write (sender clock)                                                                  |
| `scoreModal`  | object\|null  | `{ year, subject, examId, cell: {studentId: str, questionId: str}\|null, lastEditAt: ISO\|null }` |

- Written only through `presence:update` (atomic + noteWrite, no lock, `main.js:405-433`).
  `questionId` is a question id or `obs:<obsId>` (`presence.js:89`).
- Timing (`presence.js:20-24`): heartbeat every 15 s, immediate write on score-modal open/close,
  cursor/edit writes throttled to once per 5 s; colleague counts as online if a change was
  received within 60 s (local receive time, not file time — except at startup), "active" if
  `lastEditAt` changed within 120 s; status re-evaluated every 5 s.
- Files are never deleted; offline users keep a file with `online: false`.

### `observaties/<obsId>.json` — Observatie

| Field         | Type    | Meaning                                                                                          |
| ------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `id`          | `str`   | `obs-<Date.now()>` (`screens/observaties.js:201`); file name                                     |
| `naam`        | `str`   | name (required in UI)                                                                            |
| `icon`        | `str`   | emoji                                                                                            |
| `uitleg`      | `str`   | explanation                                                                                      |
| `leeradvies`  | `str`   | learning advice                                                                                  |
| `schoolsoort` | `str[]` | >= 1 in UI                                                                                       |
| `subjects`    | `str[]` | `nat`, `bio`, `schk`, `wisob`, `wisa`, `wisb`, `wisc`, `wisd` (`screens/observaties.js:228-237`) |
| `jaarlagen`   | `str[]` | year levels as strings                                                                           |
| `subject`     | `str`?  | legacy single subject; removed on save (`store.js:789`)                                          |
| `_meta`       | Meta    | see [_meta](#_meta)                                                                              |

- Subject match: `subjects` (or legacy `subject`); for `wi` any `wis*` variant matches
  (`store.js:214-224`).
- Writer: `Store.upsertObservation` -> rev (`store.js:781-795`). Delete:
  `Store.deleteObservation` -> `fs:deleteFile` (`store.js:797-801`).

### `opdrachten/<opdrachtId>.json` — Opdracht

| Field          | Type    | Meaning                                                                |
| -------------- | ------- | ---------------------------------------------------------------------- |
| `id`           | `str`   | `opdracht_<Date.now()>` (`screens/opdrachten.js:358`, `store.js:1180`) |
| `naam`         | `str`   | name; copies get ` (kopie)` (`store.js:1193`)                          |
| `beschrijving` | `str`   | description                                                            |
| `schoolsoort`  | `str[]` | >= 1 in UI                                                             |
| `vakken`       | `str[]` | subject codes as for observaties                                       |
| `jaarlagen`    | `str[]` | year levels                                                            |
| `observaties`  | `str[]` | observatie ids this opdracht remedies                                  |
| `typFile`      | `str`   | Typst file name in `opdrachten/`, `<id>.typ`                           |
| `_meta`        | Meta    |                                                                        |

- Writer: `Store.upsertOpdracht` -> rev, with `baseRev` from the argument or the cache
  (`store.js:1167-1173`). The edit form passes only the fields above, so unknown fields are
  dropped (`screens/opdrachten.js:365-374`).
- `copyOpdracht` (`store.js:1177-1196`): new id, `.typ` text copied with every
  `images/<oldId>/` replaced by `images/<newId>/` (or a fresh `base_assignment.typ`), images
  copied, `_meta` dropped.
- `deleteOpdracht` (`store.js:1198-1207`): delete JSON, delete `.typ`, delete images folder.
- `readAllJson('opdrachten')` loads only entries with an `id` (`store.js:1155`).

### `opdrachten/<typFile>` — Typst source

- Plain text. Created from `include/templates/base_assignment.typ`
  (`app:createAssignmentTypFile`). Edited via `fs:writeTextFile` (atomic, noteWrite, **no lock,
  no CAS**; editor autosaves 600 ms after the last keystroke, `editor-init.js:637-654`).
- Watched (`.typ`); external changes arrive as type `opdrachtTyp` (`store.js:1370`).
- Contract with `lib.typ` (functions `setup_extra`, `render_uitleg`, `render_opgaven`): see
  typst-contract.md.

### `opdrachten/lib.typ`

- Copied from `include/templates/lib.typ` at every start **only if the SHA-1 differs**, so an
  unchanged start does not show up as a change for colleagues (`main.js:968-974`). Atomic write,
  no noteWrite (the watcher is created afterwards and snapshots it).

### `opdrachten/_preview_<typFile>`

- Written by `app:renderAssignmentSvg` with the unsaved editor text, deleted after compiling
  (`main.js:752-778`). Ignored by the watcher (`sync.js:76`). Leftovers older than 1 h are
  deleted at start (`main.js:920-931`).

### `opdrachten/images/<opdrachtId>/<name>.<ext>`

- `opdrachtId` must match `^[\w-]+$` (`main.js:248`). `name` = `cleanImageName` (NFD, strip
  diacritics, `[^A-Za-z0-9_-]+` -> `-`, trim `-`, max 60, `main.js:255-262`). `ext` in
  `png jpg jpeg gif svg webp` (`main.js:243`). Name uniqueness is per basename, any extension
  (`main.js:274`).
- Referenced from `.typ` as `image("images/<id>/<file>")` (relative to the opdracht file).
- Delete: files right away, the folder retried for ~2 min (OneDrive EPERM), empty folders
  removed at the next start (`main.js:360-396`). Non-empty orphan folders are kept on purpose
  (`main.js:384-385`).
- Watched only if `.json`/`.typ`, so images never produce change events.

### `templates/RTTI explanations and advices/rtti_expl_adv_<fileKey>_<jaar>.json` — RttiTemplate

| Field          | Type                                               | Meaning                            |
| -------------- | -------------------------------------------------- | ---------------------------------- |
| `uitleg`       | `{ R, T1, T2, I: str }`                            | explanation per RTTI category      |
| `leeradvies`   | `{ R,T1,T2,I: { laag, midden, hoog: str } }`       | advice per category and level      |
| `grenswaarden` | `{ R,T1,T2,I: { laag_midden, midden_hoog: num } }` | percentage bounds; default 40 / 70 |

- Path: `modals/rapport.js:403-405`. `fileKey` = subject (`nat`, `bio`, `schk`, `wi` for years
  1-3) or `wisa`..`wisd` for years 4-6; `jaar` = 1..6 (`modals/rapport.js:380-401`). Default
  content when missing: `defaultTabData()` (`modals/rapport.js:407-422`).
- Writer: the RTTI-uitleg modal writes **all tabs** with blind `writeJson` + lock
  (`modals/rapport.js:735-737`). Read by the rapport (`modals/rapport.js:248`).
- `templates/` is not watched (`sync.js:21`).

### `<year>/students-<year>.json` — `Student[]`

| Field                                     | Type                    | Meaning                                                                         |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `id`                                      | `int` (or legacy `str`) | student number; UI stores `Number(...)` (`modals/leerling-edit.js:155`, `:254`) |
| `voornaam`, `tussenvoegsel`, `achternaam` | `str`                   | name parts (`achternaam` required)                                              |
| `stamklas`                                | `str`                   | home class, e.g. `3b`; leading digits = year level                              |
| `geslacht`                                | `str`                   | gender code (free)                                                              |
| `jaarlaag`                                | `str`                   | year level, `''` if unknown                                                     |
| `schoolsoort`                             | `str[]`                 | school types                                                                    |

- Writers: `upsertStudent(s)` / `deleteStudent` -> CAS (`store.js:412-452`); `mergeStudent`
  normalises the fields above and shallow-merges into an existing entry (`store.js:420-434`).
  The list is sorted (jaarlaag of stamklas, stamklas, achternaam) on every write
  (`store.js:387-398`). Locked (non-score path). No `_meta`.

### `<year>/exams/<examId>.json` — Exam

| Field                 | Type                                                      | Meaning                                                                                                                         |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `str`                                                     | `makeExamId` (see IDs)                                                                                                          |
| `subject`             | `str`                                                     | `nat`/`bio`/`schk`/`wi`                                                                                                         |
| `title`               | `str`                                                     | title; resit title = `<parent title> — <description>`                                                                           |
| `jaarlaag`            | `str`                                                     | year level                                                                                                                      |
| `subcategory`         | `str`?                                                    | wi only: `onderbouw`, `wisa`..`wisd`                                                                                            |
| `schoolsoort`         | `str[]`                                                   | >= 1                                                                                                                            |
| `n_term`              | `num`                                                     | N-term (default 1 in calculations)                                                                                              |
| `weging`, `weging_se` | `num`                                                     | weights                                                                                                                         |
| `periode`             | `str\|null`                                               | period button value                                                                                                             |
| `type`                | `'pta'\|'regular'`                                        |                                                                                                                                 |
| `structureMode`       | `'roman'\|'alpha'\|'alpha2'\|'seq'`                       | question numbering scheme                                                                                                       |
| `volgnummer`          | `int`?                                                    | `jaarlaag*100 + seq` assigned on first save (`store.js:531-541`)                                                                |
| `questions`           | Question[]                                                | `{ id: 'q<n>', section: str, number: int\|str, max_points: num, rtti: 'R'\|'T1'\|'T2'\|'I', kind?: 'normal'\|'bonus'\|'diag' }` |
| `obs_ids`             | `str[]`                                                   | observaties used in this exam                                                                                                   |
| `opdrachten`          | `{ [obsId]: str[] }`?                                     | obs -> opdracht coupling                                                                                                        |
| `opdrachtenCijfer`    | `[{ id: 'cijfer-<ms>', onder: num, opdrachten: str[] }]`? | grade cards; key removed when empty                                                                                             |
| `parent_id`           | `str`?                                                    | resit: id of the original exam                                                                                                  |
| `attempt`             | `int`?                                                    | resit attempt number (original = 1, first resit = 2)                                                                            |
| `description`         | `str`?                                                    | resit label, e.g. `INHAAL`                                                                                                      |
| `_meta`               | Meta                                                      |                                                                                                                                 |

- Writers: `upsertExam` -> rev, merged over the cached version (`store.js:519-546`);
  `setExamNTerm` and `setExamOpdrachten` -> CAS on the latest disk version **without** rev check
  (field merge, `store.js:558-566`, `:1265-1281`). Delete: `deleteExam` refuses when resits
  exist (`store.js:568-575`).
- Shape builders: `modals/toets-edit.js:257-276`, `:711-725`; `modals/herkansing.js:120-137`.

### `<year>/groups/<groupId>.json` — Group

| Field         | Type    | Meaning                                                      |
| ------------- | ------- | ------------------------------------------------------------ |
| `id`          | `str`   | `makeGroupId` (see IDs)                                      |
| `name`        | `str`   | display name, e.g. `3a nat`                                  |
| `jaarlaag`    | `str`   | year level                                                   |
| `subject`     | `str`   | from the form or `subjectFromGroupName` (`store.js:232-239`) |
| `subcategory` | `str`?  | wi: `onderbouw`/`wisa`..`wisd` (`store.js:246-267`)          |
| `schoolsoort` | `str[]` |                                                              |
| `docenten`    | `str[]` | user ids                                                     |
| `student_ids` | `int[]` | members (same type as `Student.id`)                          |
| `_meta`       | Meta    |                                                              |

- Writers: `upsertGroup` -> rev; `upsertGroups` (CSV import) -> `force: true`, overwrites
  regardless of rev (`store.js:459-482`). Delete via `fs:deleteFile` (`store.js:484-490`).

### `<year>/scores/<subject>/<studentId>.json` — ScoreRecord

| Field          | Type                                                  | Meaning                                     |
| -------------- | ----------------------------------------------------- | ------------------------------------------- |
| `student_id`   | `int\|str`                                            | student id                                  |
| `scores`       | `{ [examId]: { [questionId]: num \| null \| str } }`  | see below                                   |
| `observations` | `{ [examId]: str[] }`?                                | observatie ids ticked; empty arrays removed |
| `overrides`    | `{ [examId]: { cijfer: num, berekend: num\|null } }`? | teacher grade; key removed when empty       |

- Score values as written by the grid (`screens/scores.js:677-684`, `:1404-1422`): key absent =
  not filled; `null` = "N" (not evaluated); number in `[0, max_points]`; any other **string** =
  invalid raw input kept as typed. `calcResults` also accepts the string `'N'` as N
  (`store.js:680`).
- Writers: `setScore`, `setGradeOverride`, `setObservation`, `removeObsFromExamScores` -> CAS
  (`store.js:591-627`, `:803-814`, `:1136-1148`). **No lock** (path contains `/scores/`,
  `main.js:88`), no `_meta`.
- `subject` in the path is the exam subject (`nat|bio|schk|wi`); the record has no subject
  field.

### `<userData>/session.json` (local, not shared)

`{ lastSubject?: str, lastUserId?: str, filtersByUser?: { [userId]: { schoolsoorten: str[],
jaarlagen: str[], jaarlagenKlas: str[], eigenOnly: bool } } }` — read-merge-write, plain
`writeFileSync` (`store.js:172-196`, `main.js:443-455`).

### Photos — `fotos/`

- `fotos/<userId>.<png|jpg>` (`screens/gebruikers.js:219-221`), `fotos/school-logo.<ext>`,
  `fotos/school-watermerk.<ext>` (`screens/school.js:228-236`). Written by `fs:savePhoto`
  (plain write, no atomic, no lock). Read as data URL by `fs:readPhotoAsDataUrl`; the app
  background always reads `fotos/school-watermerk.svg` (`app.js:957`).
- Not watched (`sync.js:21`). Created at start (`main.js:1000`).

## IDs and slugs

| Entity     | Rule                                                                                                                               | Source                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Exam       | `<subject>-<slug(title)>-<year>`; slug = lower-case, `[^a-z0-9]+` -> `-`, trim leading/trailing `-` (one each); `/` in year -> `-` | `store.js:757-763`                         |
| Group      | `<slug(name)>-<year>`, same slug                                                                                                   | `store.js:765-774`                         |
| Student    | student number (number in new data; `[^/]+` in paths)                                                                              | `modals/leerling-edit.js:155`              |
| Observatie | `obs-<ms epoch>`                                                                                                                   | `screens/observaties.js:201`               |
| Opdracht   | `opdracht_<ms epoch>`; `.typ` = `<id>.typ`                                                                                         | `screens/opdrachten.js:358`                |
| User       | `admin` or `gebr-<ms epoch>`                                                                                                       | `main.js:983`, `screens/gebruikers.js:230` |
| Grade card | `cijfer-<ms epoch>`                                                                                                                | `modals/opdrachten-genereren.js:469`       |
| Question   | `q<n>` (1-based at creation)                                                                                                       | `modals/toets-edit.js:270`, `:673`         |
| Year       | `^\d{4}-\d{4}$`                                                                                                                    | `main.js:126`, `sync.js:198`               |

Older exams have no subject prefix (CLAUDE.md). Non-ASCII letters are dropped by the slug, not
transliterated (`é` -> `-`).

Path classification regexes for change events (`store.js:1362-1374`):

```
scores      ^(\d{4}-\d{4})/scores/([^/]+)/([^/]+)\.json$
exam        ^(\d{4}-\d{4})/exams/([^/]+)\.json$
group       ^(\d{4}-\d{4})/groups/([^/]+)\.json$
students    ^(\d{4}-\d{4})/students-\d{4}-\d{4}\.json$
observatie  ^observaties/([^/]+)\.json$
opdracht    ^opdrachten/([^/]+)\.json$
opdrachtTyp ^opdrachten/([^/]+)\.typ$
gebruikers  ^gebruikers\.json$
school      ^school\.json$
presence    ^users/([^/]+)\.json$
```

## `_meta`

Single-object files (exams, groups, observaties, opdrachten) carry (`store.js:90-102`):

| Field       | Type            | Rule                                                        |
| ----------- | --------------- | ----------------------------------------------------------- |
| `rev`       | `int`           | on-disk `rev` + 1 (first save = 1; legacy files count as 0) |
| `createdBy` | `str\|null`     | kept from disk; active user id when the file is new         |
| `createdAt` | ISO `str\|null` | kept from disk; now when new                                |
| `updatedBy` | `str\|null`     | active user id                                              |
| `updatedAt` | ISO `str`       | now                                                         |

- **No content hash is stored in `_meta`.** The hash used for CAS is SHA-1 of the file bytes,
  computed on read (`sync.js:24-42`).
- `saveEntity(relPath, entity, baseRev, { force })` (`store.js:116-123`): inside `update`, if
  the file exists and `onDisk._meta.rev ?? 0 !== baseRev ?? 0` (and not `force`) throw
  `Error('conflict')` with `code: 'conflict'` and `updatedBy`; handled globally as a persistent
  toast (`app.js:964-973`).
- Field-merge writers (`setExamNTerm`, `setExamOpdrachten`) bump `rev` without checking it.
- The watcher forwards `_meta` of changed non-array JSON as `meta` in `data:changed`
  (`sync.js:159-169`).

## Writes and concurrency

### Atomic write — `writeFileAtomic` (`sync.js:44-66`)

1. `mkdir -p` the parent.
2. Write `<file>.<pid>.tmp` (UTF-8 for strings, raw for buffers).
3. `renameSync(tmp, file)`; on `EPERM`/`EBUSY`/`EACCES` retry up to 5 more times, sleeping
   synchronously 30, 60, 90, 120, 150 ms (`Atomics.wait`, blocks the main process).
4. After that (or on any other error) delete the tmp file and **write the target directly**
   (non-atomic fallback).

Used by `writeJson`, `writeTextFile`, `createAssignmentTypFile`, images, presence, `lib.typ`.
Not used by: seed `gebruikers.json`, `savePhoto`, `writeLocalSession`, temp files.

### Compare-and-swap — `Store.update` (`store.js:60-87`)

- Per-path promise queue in the renderer (`serialize`, `store.js:63-67`) so own writes to one
  file never overlap, and external refreshes queue behind them (`store.js:1416`).
- Loop up to 5 attempts: `readJsonVersioned` -> `mutator(data ?? fallback(), data)` ->
  `writeJson(…, { cas: true, expectedHash: hash })`. `ok` -> return; `reason === 'conflict'` ->
  retry with the fresh file; other reason -> throw `Save failed for <relPath>: <reason>`; after
  5 conflicts throw `…: conflict`. No delay between attempts.
- Main checks the hash and writes in one synchronous handler (`main.js:90-101`), so the check is
  atomic per process, not across PCs (OneDrive).

### Lock files (`main.js:31-48`, `:103-120`, `:184-204`)

- Applies to `fs:writeJson` and `fs:deleteFile` for paths **not** containing `/scores/`.
- `acquireLock`: if `<file>.lock` exists and its mtime is < 10 s old -> `{ ok:false,
reason:'locked' }`; else delete it and write `<file>.lock` = `String(Date.now())`. Released in
  `finally`. Not exclusive-create (`existsSync` + `writeFileSync`).
- Locks are held only for the duration of one synchronous handler.

### Blind writes

`Store.save` (`store.js:43-47`): updates the cache, `writeJson` without CAS (still locked),
throws on `!ok`. Used by `saveSchool`, `setActiveYear`, and (unused) `saveStudents`,
`saveStudentScores`.

### Summary by file type

| File                   | Writer(s)                                                                   | Mode           | Lock | `_meta` |
| ---------------------- | --------------------------------------------------------------------------- | -------------- | ---- | ------- |
| `config.json`          | `setActiveYear`                                                             | blind          | yes  | no      |
| `gebruikers.json`      | `upsertUser`; seed                                                          | CAS; plain     | yes  | no      |
| `school.json`          | `saveSchool`                                                                | blind          | yes  | no      |
| `users/*.json`         | `presence:update`                                                           | atomic         | no   | no      |
| `observaties/*.json`   | `upsertObservation`                                                         | CAS + rev      | yes  | yes     |
| `opdrachten/*.json`    | `upsertOpdracht`                                                            | CAS + rev      | yes  | yes     |
| `opdrachten/*.typ`     | `writeTextFile`, `createAssignmentTypFile`                                  | atomic         | no   | no      |
| `opdrachten/images/**` | image handlers                                                              | atomic         | no   | no      |
| RTTI templates         | RTTI-uitleg modal                                                           | blind          | yes  | no      |
| `students-<y>.json`    | `upsertStudent(s)`, `deleteStudent`                                         | CAS            | yes  | no      |
| `exams/*.json`         | `upsertExam`; `setExamNTerm`, `setExamOpdrachten`                           | CAS + rev; CAS | yes  | yes     |
| `groups/*.json`        | `upsertGroup`; `upsertGroups` (force)                                       | CAS + rev; CAS | yes  | yes     |
| `scores/<s>/*.json`    | `setScore`, `setGradeOverride`, `setObservation`, `removeObsFromExamScores` | CAS            | no   | no      |
| `fotos/*`              | `savePhoto`                                                                 | plain          | no   | no      |

## Watcher

`createWatcher(dataDir, { onChanges })` (`sync.js:85-268`), started at app ready
(`main.js:1008`).

- **Relevant files** (`sync.js:20-22`, `:72-78`): extension `.json` or `.typ`; first path
  segment not in `fotos`, `bak`, `templates`, `temp`; basename not starting with `_preview_`.
  So `.lock`, `.tmp`, `.bak`, images are never reported.
- **State**: `known: Map<relPath, { mtimeMs, size, hash? }>`; initial snapshot of all relevant
  files (mtime/size only, all years) (`sync.js:240-244`).
- **fs.watch** recursive on `dataDir`; each relevant event schedules a check debounced 500 ms
  per path (`sync.js:174-183`, `:222-238`). On watcher error it is closed and restarted after
  30 s; polling continues.
- **Poll** every 20 s (`sync.js:17`, `:194-220`, `:246-252`): walks root files, non-year
  folders and only the **active year** folder (from `config.json`); schedules a check for any
  file whose mtime/size differ from `known` or that is new, and for every known in-scope path
  that disappeared.
- **Check** (`sync.js:133-172`): read + SHA-1. Missing -> `deleted` (if known). Same hash (or,
  without a stored hash, same mtime+size) -> no event. JSON that fails to parse -> retry once
  after 1 s, else drop. Otherwise update `known` and emit `added`/`changed` with `meta`.
- **Batching**: events are flushed to `onChanges` 100 ms after the first one (`sync.js:121-131`)
  and sent as one `data:changed` message to every window.
- **Own-write suppression**: `noteWrite(rel, content)` sets `known[rel] = { stat, hash(content)
}` right after writing, so the following fs event finds an identical hash (`sync.js:256-259`);
  `noteDelete(rel)` forgets the path so no `deleted` event follows (`sync.js:260-262`). Callers:
  `main.js:99`, `:187`, `:197`, `:226`, `:234`, `:279`, `:351`, `:410`. Keys must be the same
  posix relPath the watcher computes.

## Temp folders (`<appDir>/temp/`, outside `data/`)

| Path                                                          | Written by                  | Lifetime                         |
| ------------------------------------------------------------- | --------------------------- | -------------------------------- |
| `temp/rtti_export.typ`                                        | `app:renderRapportPdf`      | overwritten each render          |
| `temp/_rapport_run.typ`                                       | `app:renderRapportPdf`      | deleted after compile            |
| `temp/rapport_preview.pdf`                                    | `app:renderRapportPdf`      | kept, overwritten                |
| `temp/_assignment_run.typ`, `assignment_preview.pdf`          | `app:renderAssignmentPdf`   | wrapper deleted, PDF kept        |
| `temp/_assignment_svg_run.typ`                                | `app:renderAssignmentSvg`   | deleted after compile            |
| `temp/svg_preview/r<seq>-p<n>.svg`                            | `app:renderAssignmentSvg`   | deleted after read; folder kept  |
| `temp/opdrachten_run/b<seq>-<i>.{typ,pdf}`                    | `app:renderAssignmentBatch` | deleted after merge; folder kept |
| `temp/<outputName>` (`opdrachten.pdf`, `antwoordsleutel.pdf`) | `app:renderAssignmentBatch` | kept, overwritten                |

Compiles use `--root <appDir>` so the wrapper can import `/data/opdrachten/lib.typ` and
`/data/opdrachten/<typFile>` (`main.js:650-652`).

## Legacy files and `migrate()`

`Store.preload()` runs `migrate()` before anything else (`store.js:318-325`, `:822-825`).

**Phase 1 — flat root -> per year** (`store.js:828-912`), runs if `students.json` (root) parses
to a truthy value:

- Inputs: `students.json` (students with `schooljaren: [{ year, stamklas, geslacht }]`),
  `groups.json`, `exams.json` (with `academic_year`), `scores/<studentId>.json`.
- Years = union of `schooljaren[].year`, `groups[].academic_year`, `exams[].academic_year`.
- Per year: `ensureYear`; write `<year>/students.json` (per-year stamklas/geslacht; students
  without `schooljaren` but with stamklas/geslacht go to every year), `<year>/groups.json`,
  `<year>/exams.json` (minus `academic_year`); scores split per exam year into
  `<year>/scores/<studentId>.json`.
- Backups `students.json.bak`, `groups.json.bak`, `exams.json.bak`; then `students.json` is
  overwritten with `null` (stops re-running). Root `groups.json`/`exams.json`/`scores/` stay.

**Phase 2 — per-year arrays -> per-subject files** (`store.js:915-991`), runs if
`observaties.json` is an array or any `<year>/exams.json` is an array:

- `observaties.json` -> `observaties/<id>.json` with `subject` defaulting to `nat`; `.bak`;
  original set to `null`.
- Per year: `exams.json` -> `exams/<id>.json` (`subject ?? 'nat'`); `groups.json` ->
  `groups/<id>.json` (`subject` from the group name, else `nat`); `students.json` ->
  `students-<year>.json`; each with `.bak` and the original set to `null`.
- `<year>/scores/*.json` (direct children with `student_id`) -> `<year>/scores/nat/<id>.json`,
  originals deleted. Only checked when phase 2 runs at all.
- No `_meta` is added; migrated objects have `rev` 0 until first saved.
