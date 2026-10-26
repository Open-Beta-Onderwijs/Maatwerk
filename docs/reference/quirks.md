# Quirks in the reference app

Surprising or probably-buggy behaviour found in Step 1. **Nothing here is fixed.** For each item the
port decides (Step 2 onward): keep it and pin it with a test, or change it deliberately (and, if it
changes output or data, ask the user first, PLAN.md 2.6).

IDs are stable: **D** = IPC and data layer, **B** = business logic, **T** = Typst, **U** = UI. Paths
are relative to `_reference/` unless a section says otherwise.

## D. IPC and data layer

1. **D1 · No path validation on generic fs handlers**
   - Where: `main.js:56-235`, `:460-483` (`fs:readJson`, `writeJson`, `deleteFile`, `readTextFile`, `writeTextFile`, `ensureDir`, `readPhotoAsDataUrl`, `savePhoto`, `createAssignmentTypFile`)
   - Evidence: `path.join(getDataDir(), relPath)` with no `..`/absolute check. `typst:compile` and `shell:openPath` take any absolute path (`main.js:532`, `:934`).
   - Port: Tauri commands must canonicalise and confine to `data/` (or offer typed commands per entity instead of raw paths).

2. **D2 · Inconsistent error shapes**
   - Where: `main.js:100-119` (`{ok,reason}`), `:269-275` (`{ok,error}` / `{ok:false,exists}`), `:523-537` (`{success,error}`), `:58-63` (`null`), plus handlers that throw (reject).
   - Evidence: four result conventions; `fs:readJson` returns `null` for both missing and corrupt files.
   - Port: decide one `Result` error enum; keep "missing" vs "corrupt" distinct.

3. **D3 · Lock not exclusive and errors outside try**
   - Where: `main.js:33-42`, `:111`, `:193`
   - Evidence: `existsSync` + `writeFileSync` (no `wx`); a stale lock is deleted and re-created non-atomically. `acquireLock` is called outside the `try`, so an fs error rejects instead of `{ok:false}`. `fs:deleteFile` does no mkdir, so deleting in a missing dir throws while writing the lock.
   - Port: the lock only lasts one synchronous handler, so within one process it never blocks; across PCs it depends on OneDrive syncing `.lock` files and on mtimes. Likely drop it (CAS covers the case) or document why it stays.

4. **D4 · `locked` is not retried**
   - Where: `store.js:79-82`
   - Evidence: `update()` retries only on `'conflict'`; `'locked'` throws `Save failed …: locked`.
   - Port: decide retry/backoff semantics explicitly.

5. **D5 · CAS retries without delay; conflict loop limit 5**
   - Where: `store.js:71-84`
   - Evidence: immediate re-read/re-write loop.
   - Port: harmless locally; mention in storage design.

6. **D6 · Blind writes on shared files**
   - Where: `store.js:43-47`, `:154-156`, `:363-367`; `modals/rapport.js:735-737`
   - Evidence: `school.json`, `config.json` and the RTTI template files are overwritten from the cache (last writer wins). The RTTI modal writes **all** tabs (up to 15 files for wi) even if only one changed.
   - Port: CAS for all shared files would be a behaviour change; decide consciously.

7. **D7 · `config.json` activeYear is shared between all teachers**
   - Where: `store.js:363-367`, `sync.js:185-191`
   - Evidence: setting the active year writes the shared file, which also changes the watcher poll scope and `inScope` (`store.js:1498`) for every colleague.
   - Port: likely intended as a school-wide setting, but confirm.

8. **D8 · `.typ` files: no lock, no CAS, autosave**
   - Where: `main.js:223-228`; `editor-init.js:637-654`
   - Evidence: editor writes the whole file 600 ms after typing; two teachers editing one opdracht overwrite each other silently. Incoming `opdrachtTyp` changes are only reported.
   - Port: consider hash-CAS for text files too.

9. **D9 · Renaming fallback is a non-atomic direct write**
   - Where: `sync.js:58-63`
   - Evidence: after 5 failed renames (or any other error) the target is written directly; the retry sleep is a synchronous `Atomics.wait` on the main process (max ~450 ms).
   - Port: keep the "never lose the change" rule but in a blocking thread, not the UI/event loop.

10. **D10 · Some writes are not atomic and not noted**
    - Where: `main.js:978` (seed `gebruikers.json`), `:482` (`savePhoto`), `:454` (session), temp files
    - Evidence: plain `writeFileSync`; the seed is written before the watcher exists, so fine, but `savePhoto` can leave half-written photos on OneDrive.

11. **D11 · `deleteImages` has no `noteDelete` and no change event**
    - Where: `main.js:373-381`; `sync.js:22`
    - Evidence: images are not watched (`.json`/`.typ` only), so colleagues never learn that images were added/removed; the editor image list is refreshed only on open.

12. **D12 · Migration "empties" legacy files by writing `null`**
    - Where: `store.js:909`, `:943`, `:958`, `:970`, `:978`
    - Evidence: `writeJson(path, null)` writes the text `null`; the files stay forever. Phase 1 leaves root `groups.json`, `exams.json`, `scores/` in place. Phase 2 `.bak` files are written through the locked `writeJson`.
    - Port: the Rust migrator must treat `null` files as "already migrated", and must expect files with literal content `null`.

13. **D13 · Migration scores step only runs if exams/observaties need migrating**
    - Where: `store.js:915-932`, `:981-987`
    - Evidence: `needsMigration` is decided only by `observaties.json` / `<year>/exams.json`; stray `<year>/scores/<id>.json` files are not moved otherwise. All migrated scores go to `nat`.

14. **D14 · Score files have no lock and no `_meta`; locking is decided by substring**
    - Where: `main.js:88`, `:183`
    - Evidence: `relPath.includes('/scores/')`; a path like `scores/x.json` (root legacy, no leading slash) **is** locked, `2025-2026/scores/...` is not.

15. **D15 · `saveEntity` treats files without `_meta` as rev 0**
    - Where: `store.js:118`, `:543`
    - Evidence: a new exam has `baseRev` undefined -> 0. If a legacy/migrated file with the same slug id and no `_meta` exists, it is silently overwritten; with `_meta` the user gets a generic "changed by someone else" conflict for an id collision.
    - Port: distinguish "create" (must not exist) from "update at rev N".

16. **D16 · Field-merge writers bump `rev` without checking it**
    - Where: `store.js:558-566`, `:1265-1281`
    - Evidence: `setExamNTerm`/`setExamOpdrachten` stampMeta on the latest file; a colleague with the exam editor open then gets a conflict on save even though only the N-term changed.

17. **D17 · Exam `upsertExam` merges over the cached object**
    - Where: `store.js:526-530`
    - Evidence: `{ ...arr[i], ...updated }` — a field the caller leaves out keeps the cached value (not the on-disk value); only an explicit `undefined` clears it (dropped by `JSON.stringify`). `rev` comes from the merged object, so the cache's `_meta` decides the conflict check.

- Port: make "patch" vs "replace" explicit.

18. **D18 · Student id type is number, elsewhere string**
    - Where: `modals/leerling-edit.js:155`, `:254`; `presence.js:93`; `main.js:159`; CLAUDE.md says "numeric strings"
    - Evidence: UI stores `Number(...)`, presence stores `String(id)`, `listScoreFiles` returns strings, groups compare with `includes(studentId)` (type-sensitive, `store.js:511`, `:1337`).
    - Port: pick one id type and convert on load; keep path names identical.

19. **D19 · Score value semantics differ from CLAUDE.md**
    - Where: `screens/scores.js:677-684`, `:1404-1422`; `store.js:680`
    - Evidence: `null` means "N" (not evaluated), absence means "not filled", invalid input is stored as the raw **string**. CLAUDE.md says `null` = not filled and `'N'` = N.
    - Port: the Rust model needs `Absent | N | Points(f64) | Invalid(String)` and must also read legacy `'N'`.

20. **D20 · Presence user switch race / unvalidated user id**
    - Where: `main.js:428-433`; `presence.js:71-77`
    - Evidence: `presence:update(null)` with no state; `userId` used directly in a file name. Files are never deleted.

21. **D21 · Concurrent previews clobber each other**
    - Where: `main.js:747-754`
    - Evidence: each SVG render deletes **all** files in `temp/svg_preview/` (despite the per-run prefix) and uses a fixed wrapper `_assignment_svg_run.typ`; overlapping renders can return missing pages or compile the other run's wrapper. Same for the fixed `_rapport_run.typ` / `rapport_preview.pdf` and `_assignment_run.typ`.
    - Port: per-run temp dirs (or in-process Typst World without files).

22. **D22 · Preview copies are written into the synced folder**
    - Where: `main.js:752-756`, `:920-931`
    - Evidence: `data/opdrachten/_preview_<typFile>` is synced by OneDrive to colleagues; it is ignored by the watcher and deleted at start after 1 h.

23. **D23 · `toTypst({})` yields an empty array**
    - Where: `main.js:565-571`
    - Evidence: empty objects serialise as `()` (Typst array), not `(:)` (dictionary). Dictionary keys are emitted unquoted.
    - Port: match or fix deliberately (affects typst-contract).

24. **D24 · Dead or unreachable handlers**
    - Where: `preload.js:34`, `:57`, `:61`, `:101`; `modals/editor.js:68`
    - Evidence: `listScoreFiles`, `typstVersion`, `compileTypst` have no caller; `renderAssignmentPdf` is only behind the editor proxy case `rtti-render-assignment`, which `editor-init.js` never posts. Also `Store.saveStudents`, `Store.saveStudentScores` are unused (`store.js:405`, `:583`).
    - Port: candidates to drop.

25. **D25 · Editor proxy never answers on rejection**
    - Where: `modals/editor.js:61-95`; `editor-init.js:46-52`
    - Evidence: `.then(reply)` without `.catch`; a thrown handler error (e.g. invalid opdracht id in `opdrachtImagesDir`) leaves the iframe promise pending forever.

26. **D26 · Store ignores `deleteFile` results**
    - Where: `store.js:487`, `:572`, `:798`, `:1201`, `:1203`
    - Evidence: `{ ok:false, reason:'locked' }` is dropped; the cache is updated as if deleted.

27. **D27 · `opdracht:copyImages` does not create the target folder explicitly and cannot copy subfolders**
    - Where: `main.js:344-354`
    - Evidence: `create=false` for the target (writeFileAtomic mkdirs anyway); `readFileSync` on a subdirectory throws.

28. **D28 · Photo file name and user id can differ**
    - Where: `screens/gebruikers.js:220`, `:230`
    - Evidence: a new user gets `gebr-${Date.now()}` twice (photo path and user id), computed at different times.

29. **D29 · Watermark always read as SVG**
    - Where: `app.js:957`; `screens/school.js:146`, `:230`
    - Evidence: `school.watermerk` can be `fotos/school-watermerk.png`, but the background reads `fotos/school-watermerk.svg` only.

30. **D30 · `temp` in watcher ignore list is a no-op**
    - Where: `sync.js:21`; `main.js:549`
    - Evidence: temp files live in `<appDir>/temp`, not `data/temp`. Harmless.

31. **D31 · Typst arch folder name**
    - Where: `main.js:494`; `bin/typst/*/x_86_64`
    - Evidence: dev path uses `x_86_64` (matches the folders), while CLAUDE.md says `win/x86_64`. Every non-arm64 arch maps to `x_86_64`.

32. **D32 · Watcher poll covers only the active year**
    - Where: `sync.js:194-220`
    - Evidence: other year folders rely on `fs.watch` only (which OneDrive may swallow). `noteWrite` keys must equal the watcher's posix relPath; any renderer path with `\` or `./` would echo back as an external change.

33. **D33 · Batch output and progress**
    - Where: `main.js:853-857`, `:909-911`
    - Evidence: progress is sent to `event.sender`; `done` only counts successes; output `temp/opdrachten.pdf` / `antwoordsleutel.pdf` is overwritten by the next run (the PDF viewer may still hold it).

34. **D34 · Groups CSV re-import overwrites existing groups (data loss)**
    - Where: `renderer/modals/groep-edit.js:535-543`, `:565`; `renderer/store.js:478-482`
    - Evidence: every CSV row becomes a group object with `student_ids: []` and the CSV's
      `docenten`, saved through `upsertGroups` -> `upsertGroup(..., { force: true })`. There is no
      existence check and no confirmation, so re-importing a CSV with an existing group name empties
      that group's student list and replaces its teachers.
    - Port: pin with a test; ask the user whether to fix (merge or confirm) during the port.

35. **D35 · Watcher reports an untouched file as changed the first time its mtime moves**
    - Where: `sync.js:240-244` (initial snapshot without hash), `:149-157` (`check`)
    - Evidence: the snapshot stores only mtime/size, so the first event or poll that sees a new
      mtime reports `changed` even when the bytes are identical; later touches compare hashes.
      Found in Step 2a, pinned by storage spec S34.
    - Port: harmless (a spurious refresh); the Rust watcher may hash up front.

## B. Business logic

Paths in this section are relative to `_reference/renderer/`.

### B1. `N` means different things in different places

- **Where:** `store.js:680`, `:693-696`, `modals/toets-overzicht.js:108-112`, `:122-124`, `:1029`, `modals/rapport.js:47`, `:56`
- **Evidence:** `calcResults` treats `N` as 0 points out of `max_points`, and it makes the row
  gradeable. The overview's Vraaganalyse, its RTTI-per-cijfergroep chart and its exam comparison
  all skip `N`, so it adds to neither the score nor the max. The rapport's class average also skips
  `N`, but its leeradvies totals count `N` as 0 of max. CLAUDE.md calls `N` "not evaluated", while
  the UI tooltip says "Niet gemaakt".
- **Why it matters:** The same student data gives different RTTI percentages in the score grid and
  in the overview charts. The port has to choose one meaning.

### B2. Overview RTTI and question statistics include bonus and diag questions, and over-max values

- **Where:** `modals/toets-overzicht.js:110` (`filter(q => q.rtti === cat)` with no kind check), `:113`, `:125`, `:1027-1031`
- **Evidence:** The only filter is `num < 0` / NaN. An invalid stored value such as `"12"` on a
  10-point question passes `Number()` and is added. Bonus and diag questions are included.
  `calcResults` uses normal questions only, with valid values.
- **Why it matters:** Overview percentages can be above 100 % and do not match the RTTI % of the
  same students in the score grid.

### B3. An empty question counts as 0 for the grade but is left out of RTTI

- **Where:** `store.js:664-666`, `:678`, `:702`
- **Evidence:** The grade is `scored / normalMax`, where `normalMax` covers every normal question.
  RTTI skips `undefined` values.
- **Why it matters:** A half-entered row already shows a low grade next to RTTI values of up to
  100 %. This may be intended, but it is easy to "fix" by accident.

### B4. Score grid summary truncates totals and uses another max

- **Where:** `screens/scores.js:597`, `:604-607`, `:634-637`
- **Evidence:** `parseInt('12.5 / 20')` gives `12`, so half points are dropped before the mean is
  taken. The denominator shown is `Σ max_points` of **all** questions, bonus and diag included,
  while each row shows `normalMax`.
- **Why it matters:** "Gemiddelde Totaal" is wrong for any exam with half points or non-normal
  questions.

### B5. Totaal cell uses a decimal point

- **Where:** `screens/scores.js:582-585` (compare `modals/toets-overzicht.js:229-231`)
- **Evidence:** `${res.scored} / ${res.normalMax}` is not passed through `.replace('.', ',')`. Float
  sums can also show up raw, for example `0.30000000000000004 / 20`.
- **Why it matters:** It breaks the app's decimal-comma convention. Q4 parses this text back.

### B6. Averages differ between the score grid and the overview

- **Where:** `screens/scores.js:608-611` (parses back the displayed 1-decimal grade), against `modals/toets-overzicht.js:171-176` and `screens/toetsen.js:84-91` (unrounded)
- **Evidence:** The grid averages rounded grades. The exam card and the overview average unrounded
  grades. For n < 2 the grid shows an empty SD while the other two show `0,0`.
- **Why it matters:** The same exam can show two different averages, such as 6,4 and 6,5.

### B7. Histogram and grade groups use unrounded grades, but pass/fail is rounded

- **Where:** `modals/toets-overzicht.js:528-544`, `utils/grades.js:9-16`, compared with `utils/colors.js:204-206`
- **Evidence:** A grade of 5.47 is a pass (`isFail` rounds it to 5.5), yet it falls in the `<5,5`
  histogram bin and the `5–6` grade group, and it lies left of the pass line.
- **Why it matters:** The chart contradicts the "% onvoldoende" figure next to it.

### B8. `toFixed(1)` and `Math.round(x*10)/10` are used side by side

- **Where:** `app.js:365` (`Math.round` then `toFixed`), against `screens/toetsen.js:89-91`, `screens/scores.js:637-651`, `utils/grades.js:53`, `store.js:1259` (`toFixed` only)
- **Evidence:** `toFixed` rounds from the binary value, while `Math.round(x*10)` rounds the
  product, which has already been rounded to a double. The two can disagree at x.x5 boundaries. For
  example, `(1.005).toFixed(2)` gives `1.00`.
- **Why it matters:** Golden tests at rounding boundaries need to pin each path on its own.

### B9. Rapport reads the wrong advice file for bovenbouw wiskunde

- **Where:** `modals/rapport.js:250-251` (`rttiExplFilePath(subject, exam.jaarlaag)` with subject `wi`), against `:380-400` (the editor saves `wisa_4` … `wisd_6`)
- **Evidence:** The rapport looks for `rtti_expl_adv_wi_4.json`. That file is never written for
  jaarlaag 4–6, so the rapport falls back to `defaultTabData()` (empty advice, bounds 40/70).
  `exam.subcategory` is not used.
- **Why it matters:** Wiskunde A/B/C/D reports silently leave out all leeradvies.

### B10. Rapport leaves out students with only `N`s or only an override

- **Where:** `modals/rapport.js:202-205`
- **Evidence:** `hasEntry = some(v !== null && v !== undefined)`, and `null` is how `N` is stored.
  A student with an override and no scores has no `rec.scores[examId]`.
- **Why it matters:** These students do have a grade elsewhere (in the grid and the overview), but
  they get no report.

### B11. Rapport leeradvies has no I row and does not clamp invalid scores

- **Where:** `modals/rapport.js:101-114` (totals only for R, T1, T2), `:46-48` (`Math.max(0, Number(raw))`)
- **Evidence:** I never gets an advice row. An invalid string gives `NaN`, and `NaN` spreads to
  `scored`, giving `"NaN / 10 (NaN%)"`. An over-max value is taken as is.
- **Why it matters:** The report can show NaN, and the totals can be above 100 %.

### B12. Rapport class percentage is computed from an already rounded average

- **Where:** `modals/rapport.js:61-63`
- **Evidence:** `classAvg` is first `parseFloat((sum/count).toFixed(1))`, and `class_pct` is then
  `round(classAvg/max*100)`.
- **Why it matters:** Double rounding can make `class_pct` off by one or more percentage points.

### B13. Best-attempt logic is implemented 4 times with small differences

- **Where:** `store.js:1045-1077` (`computeBestGradeMap`), `store.js:1083-1134` (`resolveBestAttempts`), `modals/groep-leerlingen.js:77-84`, `modals/profiel.js:637-662`
- **Evidence:** The handling of a null grade differs. `resolveBestAttempts` uses `?? -1` and keeps
  the original even when its grade is null. The others skip nulls. `resolveBestAttempts` also calls
  `calcResults` again for `best` on every comparison.
- **Why it matters:** Edge cases (all null, an original with a null grade) give different results
  depending on the screen.

### B14. Summary overview mixes question structures across attempts

- **Where:** `modals/toets-overzicht.js:73-77`, `:105-129` (the parent `exam.questions` against the best attempt's `questionScores`)
- **Evidence:** `qStats` and `rttiAccum` iterate over the **parent's** question ids, while the
  values come from the resit's score map. The ids are `q1..qN` in both, but the resit's questions
  can have different `max_points` and `rtti`. The tabs that show these are disabled, but
  `groupEntries` is filtered on `qStats.totalMax > 0` (`:162-164`), so it decides which groups get
  histograms and boxplots.
- **Why it matters:** A group can disappear from the summary charts.

### B15. Profile mixes best attempts and all attempts

- **Where:** `modals/profiel.js:73-85`, `:496`, `:913-915`
- **Evidence:** "Cijferverloop" uses best attempts. "Per schooljaar" and the RTTI tab use every
  attempt with a grade. The RTTI "Gem." bar is the mean of per-exam percentages, not pooled points.
  The `'se'` filter includes resit attempts of PTA exams.
- **Why it matters:** The RTTI averages in the profile differ from the overview's pooled figures.

### B16. Profile's jaarlaag-SE average compares across years

- **Where:** `modals/profiel.js:720-737`
- **Evidence:** The peers come from `Store.getStudentsSync(year)`, the currently selected year,
  filtered by the jaarlaag of the student's **last history year**.
- **Why it matters:** When an older year is selected, the peer group can be empty or wrong.

### B17. The "Cijfer onder" threshold rejects 1,0 but the message allows it

- **Where:** `modals/opdrachten-genereren.js:446-449`
- **Evidence:** The check is `n <= 1 || n > 10`, while the toast says "tussen 1,0 en 10,0". A
  threshold of 1,0 would be useless anyway (no grade is `< 1`).
- **Why it matters:** This is a small inconsistency in input validation.

### B18. "Cijfer onder" uses this exam's grade only, not the best attempt

- **Where:** `store.js:1327`
- **Evidence:** It uses `examResults(rec, exam)`. A student who passed the resit still gets the
  card's opdrachten when the cards are on the original.
- **Why it matters:** This may be intended (per-exam remediation), but it differs from every other
  use of resit results.

### B19. Three different rules for "the student's group"

- **Where:** `store.js:1337-1339` (same jaarlaag, else the first group), `modals/rapport.js:207` (the first group of the subject), `modals/toets-overzicht.js:50-56` (the first group of all groups)
- **Evidence:** A student in more than one group can be shown under different groups in the
  rapport, the overview and the opdrachten PDF.
- **Why it matters:** Sorting and headers in the outputs disagree.

### B20. Observatie availability and opdracht fit treat empty lists differently

- **Where:** `modals/toets-edit.js:379-386` against `store.js:1215-1226`
- **Evidence:** An observatie with empty `jaarlagen` is never offered on an exam, while an opdracht
  with empty `jaarlagen` always fits. The Observaties screen filter treats empty lists as "passes"
  (`screens/observaties.js:94-133`). The save form forbids empty jaarlagen
  (`screens/observaties.js:361-364`), so the empty case only occurs in legacy data.
- **Why it matters:** The same "empty list" means something different in each place.

### B21. Imported student ids are numbers, so a re-import can duplicate students

- **Where:** `modals/leerling-edit.js:253` (`id: Number(...)`), `store.js:431` (`s.id === flat.id`)
- **Evidence:** CLAUDE.md says ids are numeric strings, and students created manually or migrated
  may have string ids. Importing over string ids does not match them, so duplicate rows are
  appended. `group.student_ids.includes(s.id)` (`screens/scores.js:379`, `store.js:1337`) also fails
  when the types are mixed. Leading zeros are lost.
- **Why it matters:** This silently corrupts the roster. The port needs a single id type.

### B22. CSV parsing does not strip the BOM, assumes UTF-8 and has no `""` escape

> **Correction (Step 2a):** the BOM part is wrong. `parseCSV` starts with `text.trim()`, which
> removes U+FEFF, so a BOM header still matches (`tests/golden/logic/csv.json`,
> `parseCSV-bom`); `File.text()` also strips it. The rest stands: `""` inside quotes is dropped,
> not unescaped (`parseCSV-doubled-quotes`), and an unbalanced quote swallows the delimiter.

- **Where:** `utils/csv.js:59-97`, `modals/leerling-edit.js:223`
- **Evidence:** `File.text()` always decodes UTF-8. An Excel "CSV UTF-8" file starts with a BOM,
  so the first header becomes `﻿Leerlingnummer` and `r['Leerlingnummer']` is undefined. Every
  row is then dropped (`filter(s => s.id && …)`). An ANSI file turns é into U+FFFD. A doubled `""`
  inside quotes is not handled, and a newline inside quotes breaks the row.
- **Why it matters:** The usual Excel exports may import zero students without any error.
- **Fixed in the port (Step 3a, `ui/src/domain/csv.ts`):** `""` inside quotes is a literal quote;
  files that are not valid UTF-8 decode as Windows-1252. Still line-based: a newline inside quotes
  and an unbalanced quote behave as before (`parseCSV-unbalanced-quote`). Tests:
  `ui/tests/domain/csv.test.ts` ("B22").

### B23. Score input accepts hex and exponent notation

- **Where:** `screens/scores.js:655-657`, `:677-684`
- **Evidence:** `Number('0x1')` is 1 and `Number('1e0')` is 1, so both are stored as valid numbers.
  `replace(',', '.')` only replaces the first comma.
- **Why it matters:** A stricter parser in the port would reject input that the reference accepts.

### B24. Adding a question after a deletion can repeat a question id

- **Where:** `modals/toets-edit.js:673` (`id: q${exam.questions.length + 1}`), `:621-626`
- **Evidence:** Starting from q1, q2, q3, deleting q1 leaves [q2, q3]. Adding a question then
  creates `q3`, a duplicate. Deletion is only possible while the exam has no scores, but the
  duplicate stays.
- **Why it matters:** Two questions share one score slot, which corrupts grades and RTTI.

### B25. Resits copy every parent field, including the opdrachten coupling and `_meta`

- **Where:** `modals/herkansing.js:120-137` (`...parent`)
- **Evidence:** `opdrachten`, `opdrachtenCijfer`, `volgnummer` and `_meta` (rev, createdBy) are all
  inherited. `obs_ids` is reset to `[]`, so the inherited coupling has nothing to match, but the
  cards (`opdrachtenCijfer`) still apply to the resit. Because `_meta` is inherited, saving a resit
  whose generated id already exists either conflicts or overwrites, depending on whether the revs
  match.
- **Why it matters:** The resit gets unexpected "Cijfer onder" cards, and its metadata is wrong.

### B26. Exam ids collide on the same title

- **Where:** `store.js:757-763`, `:519-531`
- **Evidence:** The slug only keeps `[a-z0-9]`, so "Toets één" and "Toets n" can collide. A new exam
  with an existing id goes down the merge path (`i >= 0`) with `baseRev` undefined, which gives a
  conflict error, or it overwrites when it is not cached.
- **Why it matters:** The id scheme is not unique, and creating such an exam fails confusingly.

### B27. `volgnummer` overflows above 99 exams per jaarlaag

- **Where:** `store.js:537-541`
- **Evidence:** `jl*100 + max(volgnummer % 100) + 1`. The 100th exam gives `jl*100 + 100`, which is
  `(jl+1)*100`, and its `% 100` is 0.
- **Why it matters:** This is unlikely in practice, but it changes sorting and labels.

### B28. Unknown `rtti` tag makes `calcResults` crash

- **Where:** `store.js:684`, `:691`, `:694`
- **Evidence:** `cats[q.rtti][1]` throws a TypeError when `rtti` is not one of R, T1, T2 or I. This
  could happen with legacy or hand-edited data.
- **Why it matters:** A single bad question breaks every screen that uses the exam.

### B29. `calcGrade` checks the bounds in sequence instead of taking the min/max

- **Where:** `store.js:749-752`
- **Evidence:** When `raw > lo1` it returns `lo1` without checking `hi1`. This is safe only while
  `n ≤ 4`; the UI clamps to `[0, 3]`, but nothing validates the n-term in the file.
- **Why it matters:** A port that writes this as `min(raw, lo1, hi1)` must make sure it is
  equivalent in the reachable range, or keep the same sequence.

### B30. "Partial" warning requires diag and bonus questions

- **Where:** `screens/scores.js:929-945`, `screens/toetsen.js:97-118`
- **Evidence:** A row counts as complete only when every question is filled, including optional
  bonus and diag questions.
- **Why it matters:** An exam can show ⚠ "onvolledig" for every student who skipped the bonus.

### B31. Results depend on the order files come back from the folder

- **Where:** `main.js:163-176` (`fs:readAllJson` returns `readdirSync` order, unsorted), used by
  `store.js:283-293` for exams and groups. Order-sensitive consumers: `store.js:1337-1339`
  (`getOpdrachtAssignments` picks the first group of the exam's jaarlaag), `rapport.js`
  `compileRapport` (`groups.find`), `toets-overzicht.js:49-54` (first group per student), and float
  sums over exams (`profiel.js` `yearAvg`).
- **Evidence (Step 2a review M2):** a student in two groups of the same jaarlaag gets the group whose
  file name sorts first on NTFS (`g-10a` before `g-9b`); with the listing reversed the student gets
  the other group and sorts elsewhere. Averages change in the last float digit.
- **Why it matters:** on Windows the order is stable (NTFS returns names sorted case-insensitively),
  so the app is consistent there, but the port and a macOS build must pick the order on purpose. The
  harness pins NTFS order (`docs/testing.md`, harness assumptions).

## T. Typst

### T1. The rapport needs network access: cetz/oxifmt/unify are not vendored

- `include/templates/rtti_export.typ:17-18`; `main.js:503-516`; `include/packages/` only holds `preview/zero/0.7.1`.
- Evidence: compiling with an empty `--package-cache-path` printed `downloading @preview/cetz:0.3.4`, `@preview/oxifmt:0.2.1` and `@preview/unify:0.8.0` (verified). `--package-path` replaces only the data dir. The default cache `%LOCALAPPDATA%\typst\packages` still had them on the dev machine.
- Why it matters: CLAUDE.md claims "compiling never needs internet", but on an offline or fresh machine the rapport fails. The Rust World must ship all four packages.

### T2. Emoji depend on system fonts (Segoe UI Emoji); without them they fail silently

- `lib.typ:75`, `main.js:631`, `store.js:1258`, `rtti_export.typ:240,273,628,631`; no `--ignore-system-fonts` in `main.js:510-516`.
- Evidence: `pdffonts` shows `SegoeUIEmoji` in opdracht and rapport PDFs. With `--ignore-system-fonts` the exit code is 0, there is no warning, and ❌/5️⃣ render as tofu boxes (verified PNGs `inject.png` / `inject_nosys.png`).
- Why it matters: a sandboxed World with only bundled fonts loses every observatie icon without any error. Parity needs the same emoji font.

### T3. The rapport also uses Typst's embedded Libertinus Serif

- `rtti_export.typ:184` (`*Jij (●)*`, `*Gemiddeld (◇)*`).
- Evidence: `pdffonts` lists `LibertinusSerif-Bold` (verified). Source Serif 4 lacks ● and ◇, so Typst falls back to its embedded font.
- Why it matters: the Rust build must enable the typst-assets fonts, or the glyphs change.

### T4. A missing watermark breaks the whole rapport

- `rtti_export.typ:32` `image("/data/fotos/school-watermerk.svg")`.
- Evidence: without the file, `error: file not found (searched at \\?\C:\…\data\fotos\school-watermerk.svg)` and exit 1 (verified). Uploading the watermark is optional in the UI (`screens/school.js`).
- Why it matters: a school without a watermark cannot generate rapports at all.

### T5. `toTypst` turns `{}` into `()`, an array rather than a dictionary; keys are emitted raw

- `main.js:569-571`, `580` (`toTypst(examInfo ?? {})`).
- Evidence: `toTypst({}) === "()"` (verified). Keys are inserted without quoting, so a key with a space, a leading digit or a reserved word would produce invalid Typst.
- Why it matters: if the port uses JSON or a dictionary in the World instead, its behaviour must still match. Today the keys are fixed, so this only bites with `examInfo == null` (field access on an array fails).

### T6. Numbers reach Typst with a decimal point and float noise; some are shown raw

- `main.js:561`; `rtti_export.typ:651` (`#student.score / #student.max_score`), `:136` (`#q.score` in the dot).
- Evidence: the rapport text reads "Je hebt 7.5 / 12 punten" (verified), against the app-wide comma convention. JS `0.1+0.2`-style sums would print `0.30000000000000004`. NaN/Infinity silently become `0`, and `1e21` becomes `1e+21`.
- Why it matters: parity requires reproducing these exact strings, not "fixing" them to commas.

### T7. Fractional question scores are truncated in the scoretabel

- `rtti_export.typ:191` `str(int(q.score))`.
- Evidence: Typst `int(1.5)` = 1 (verified: `#str(int(1.5))` → `1`). A half point shows as "1 / 3", while the dot inside the track shows `1.5`.
- Why it matters: this is visible wrong data, and it is part of the spec output.

### T8. The rapport footer always says "/ 2"

- `rtti_export.typ:41` `place(left, [#pg / 2])`.
- Evidence: the total is hard-coded. A student whose first section overflows gets 3+ pages labelled `3 / 2`.
- Why it matters: this is spec behaviour that golden tests must expect.

### T9. Histogram and ranking: the comments, thresholds and texts disagree

- `rtti_export.typ:489` says "Skipped … when fewer than 3 grades", but `:496` uses `< 10`. Ranking `:626-631` prints "beste 33%" for `idx < n/10 - 0.99` (about the top 10%) and "beste 67%" for `idx < 2n/10 - 0.99` (about the top 20%). Ties use `position(g => g == grade)`, so the first match decides.
- Evidence: with 12 students, only the top 1 got "33%" and the second got "67%" (verified).
- Why it matters: the shown percentages are wrong, and the port must copy the formula exactly.

### T10. Rapport crashes on edge-case data

- `rtti_export.typ:651` divides by `student.max_score`. `:162` runs `range(0, global_max + 1)` with `global_max` from `rapport.js:242-244` = max `max_points`, including bonus/diag.
- Evidence (code reading): `max_score == 0` (only bonus/diag questions) causes a division-by-zero compile error. A fractional `max_points` (e.g. 1.5) makes `range` fail on a float. `rapport.js:151` reads `adviesData.grenswaarden[cat]` without a fallback when a saved file lacks `grenswaarden`.
- Why it matters: one bad exam config makes the rapport fail for the whole class.

### T11. Teacher markup is `eval`ed with only a `$`-count guard; `uitleg_rtti` has no guard at all

- `rapport.js:129-136`, `153`, `164`; `rtti_export.typ:276`, `:480`; `rapport.js:273-278` (uitleg is not sanitised).
- Evidence: only an odd number of `$` is caught. Unbalanced `[`, a stray `#`, `\`, unknown functions, or `<label>` in leeradvies/uitleg text abort the whole class rapport. Teacher text can also call any Typst function, such as `read("/data/…")`, inside the root.
- Why it matters: both escaping parity and a security boundary for the World (the root includes all of `data/`).

### T12. Fixed temp file names: concurrent renders race

- `main.js:585-586` (`_rapport_run.typ`, `rapport_preview.pdf`), `:552-555` (`temp/rtti_export.typ` overwritten every run), `:704-705`, `:754`.
- Evidence: two rapport compiles at once (two windows, or a quick reopen while compiling) overwrite each other's wrapper/PDF. The first finisher unlinks the wrapper the second still needs. Only the SVG preview and batch use per-run prefixes.
- Why it matters: the port should not copy this, but tests must not rely on it either.

### T13. The SVG preview wipes the whole `svg_preview` dir and writes a preview copy into the synced data folder

- `main.js:750` deletes every file in `temp/svg_preview` before each render. `:752-756` writes `data/opdrachten/_preview_<typFile>`.
- Evidence: the deletion is unconditional, so an overlapping render would lose its pages. The preview copy lands in the OneDrive-synced folder. It is hidden from this app's watcher (`sync.js:76`), but OneDrive uploads it, colleagues see it, and two teachers previewing the same opdracht write the same file name. Crash leftovers are only removed at startup after 1 h (`main.js:920-931`).
- Why it matters: an in-memory World removes the need for this. The port must still produce identical diagnostics with the real file name (see Q14).

### T14. Diagnostic text is raw CLI stderr with absolute `\\?\` paths; preview names are swapped by string replace

- `main.js:597`, `716`, `781`, `822`, `876`.
- Evidence: the error text starts with `error: …` and then `┌─ \\?\C:\Users\…\app\temp\rtti_export.typ:32:15` (verified). `split(previewName).join(typFile)` also rewrites unrelated occurrences. Warnings are discarded on success.
- Why it matters: it exposes machine paths in the UI, and the port has to choose an equivalent rendering of diagnostics.

### T15. `temp/` lives inside the app dir, which is inside the OneDrive share

- `main.js:17-20`, `549`, `843-846`, `909`.
- Evidence: `appDir` = the folder of the portable exe, the same folder whose `data/` is synced. `temp/` (wrappers, `rapport_preview.pdf`, `opdrachten.pdf`, `svg_preview/`, `opdrachten_run/`) is a sibling. Code comments confirm that OneDrive locks deletions ("deleting it on OneDrive gives EPERM", `main.js:745-746`, `844`).
- Why it matters: it causes sync churn and file locks. Also `--root appDir` gives teacher code read access to the app folder.

### T16. Output PDFs are reused, so a PDF open in Acrobat blocks the next run

- `main.js:586`, `705`, `909-910`; `rapport.js:316` / `opdrachten-genereren.js:494` open those paths with `shell.openPath` for printing.
- Evidence: after "Afdrukken", the external viewer may hold `rapport_preview.pdf` / `opdrachten.pdf`. The next compile or `fs.writeFileSync` then fails on Windows with an access-denied error. The rapport iframe URL has no cache-buster (`rapport.js:307-309`); opdrachten has one (`opdrachten-genereren.js:404`).
- Why it matters: this is a user-visible failure and a likely source of stale previews.

### T17. `file:///` URLs are built without percent-encoding

- `rapport.js:307`, `opdrachten-genereren.js:404`.
- Evidence: `'file:///' + path.replace(/\\/g,'/')` keeps spaces, `#` and `%` raw before `encodeURIComponent` wraps the whole URL for the query string. An app folder containing `#` or `%` (OneDrive folder names allow them) breaks pdf.js loading. Spaces happen to work ("OneDrive - CVO").
- Why it matters: this is a Windows path issue for the viewer.

### T18. `lib.typ` ping-pongs between app versions on a shared data folder

- `main.js:968-974` writes `data/opdrachten/lib.typ` whenever its SHA-1 differs from the bundled copy.
- Evidence: two teachers running different app versions overwrite each other's `lib.typ` on every start. Compiles use the data copy (`main.js:650`), so output depends on who started last. The comment at `lib.typ:2` says "always overwritten", but the code writes only when the hash differs.
- Why it matters: the Rust port must decide which `lib.typ` is authoritative. Golden tests should pin it.

### T19. Empty `observaties` produces an empty header cell instead of the `Geen observatie` default

- `main.js:668-680` always emits `observaties: (…)`; `lib.typ:79` uses the default only for `none`.
- Evidence: a wrapper with `observaties: ()` renders a blank right cell (verified). Paths B and C always have one placeholder observatie, so this only shows up in batch when a job has no reasons (normally impossible) or for hand-built jobs.

### T20. A `vraag` outside an `opgave` is numbered as opgave 0

- `lib.typ:171`, `209`, `234`.
- Evidence: a `#vraag(antwoord: [x])` in `render_uitleg()` shows up in the answer list as `0x` (verified, `o2.pdf`). The uitleg goes before the page break, so in the answer key it is listed first.

### T21. The import path and title are interpolated unescaped; `renderAssignmentPdf` skips `typFile` validation

- `main.js:652` `#import "${importPath}"`; `:693-702` (no basename check, unlike `:738`, `:833`).
- Evidence: a `typFile` containing `"` or `..` would break or redirect the import. Today `typFile` is always `opdracht_<ts>.typ` (`store.js:1181`, `screens/opdrachten.js:359`).

### T22. Dead or unused Typst IPC

- `main.js:519-540` (`typst:version`, `typst:compile` without `--root`, so root = the input's folder), `:693-721` (`app:renderAssignmentPdf`, proxied by `modals/editor.js:68` but never sent by `editor-init.js`).
- Why it matters: these do not need porting unless kept for API parity. `typst:compile` would also run without `--root`, which changes absolute path semantics.

### T23. The batch reports only the first failure, and progress counts finished jobs only

- `main.js:875-877`.
- Evidence: `failure = failure ?? …`. The other workers stop after their current job. The user fixes one opdracht at a time.

### T24. pdf-lib merge discards Typst metadata, outlines and named destinations

- `main.js:896-911`.
- Evidence: `PDFDocument.create()` defaults set Producer/Creator to pdf-lib and the dates to the merge time. Only pages are copied. Single-document paths (rapport) keep `Creator: Typst 0.14.2` (verified via `pdfinfo`).
- Why it matters: a metadata comparison in golden tests must exclude these fields, or reproduce them.

### T25. The rapport sets no `lang`, but opdrachten use `lang: "nl"`

- `rtti_export.typ:46` against `lib.typ:39`.
- Evidence: the rapport uses English hyphenation and smart-quote rules, and is not justified. Any figure or reference supplements in the rapport would read "Figure".
- Why it matters: parity, so do not "fix" it to nl.

### T26. One invalid typed score makes the whole rapport fail

- Where: `renderer/modals/rapport.js:48` (`Math.max(0, Number(raw))`), `:29-37` (`scoreDotColor`), `include/templates/rtti_export.typ:133` (`rgb(q.dot_color)`).
- Evidence (found in Step 2b, golden `tests/golden/typst/rapport-tiny`): a score kept as typed (e.g. `abc`, quirk B23/BR 2.1) becomes `NaN`, `scoreDotColor` returns `#NaNNaNNaN`, and Typst stops with "color string contains non-hexadecimal letters". `toTypst(NaN)` also turns the score into `0`.
- Why it matters: one typo in the score grid blocks the rapport for the whole class.
- **Decision (user, 2026-10-26): fix in the port.** A score that is not a number must not break the
  rapport. Failing test first: the `rapport-tiny` golden is the old (failing) behaviour; the port's
  test expects a compiled rapport. Data side (`assembleVragen`/`scoreDotColor`) in Step 3a, template
  side in Step 5. Proposed treatment, confirm with a test: no points and a grey dot, like an empty
  score, consistent with `calcResults` (BR 3.1).

### T27. The unclosed-`$` guard breaks the rapport it is meant to protect

- Where: `renderer/modals/rapport.js:129-136` (`sanitizeTypstMarkup`), `include/templates/rtti_export.typ:276` (`eval(r.advies, mode: "markup")`).
- Evidence (found in Step 2b, golden `tests/golden/typst/rapport-markup`): with an odd number of `$` the guard escapes them but prepends `#text(...)[$-teken niet gesloten — …]`. That warning contains an unescaped `$`, so `eval` fails with "unclosed delimiter" and the whole rapport fails. Related to T11.
- Why it matters: the guard never works; an odd `$` in a leeradvies text always breaks the rapport.
- **Decision (user, 2026-10-26): fix in the port.** The warning text must not contain an unescaped
  `$`, so the guarded text compiles and shows the red warning. Failing test first: the
  `rapport-markup` golden is the old (failing) behaviour. `sanitizeTypstMarkup` in Step 3a; the
  `uitleg_rtti` fields (T11, no guard at all) get the same treatment in Step 5.

## U. UI

Read from code only; "probable" means the code path is clear but not confirmed in the running app.

### U1. Score modal: app-level Ctrl+Z / Ctrl+Y listener and undo-button state are removed right after setup

- `screens/scores.js:199-214` (inside `openScoreModal`'s `onShow`) sets `undoBtnEl`, `redoBtnEl` and
  adds `undoKeydownHandler` on `document`.
- Then `scores.js:289` awaits `loadScoreGrid(...)`, whose first statement is `destroyHotInstances()`
  (`scores.js:412`), which sets `undoBtnEl = redoBtnEl = null` and removes `undoKeydownHandler`
  (`scores.js:129-134`).
- Evidence: order of execution in the same `onShow`; no code re-adds the handler afterwards.
- Effect (probable): Ctrl+Z / Ctrl+Y no longer reach the app's undo stack; inside a grid they fall
  through to Handsontable's built-in UndoRedo (enabled by default, not disabled in the settings at
  `scores.js:1249-1448`), which re-applies values through `afterChange` and pushes them as _new_
  history entries. The ↶/↷ buttons keep working via their click listeners but are never disabled
  (`updateUndoRedoBtns` no-ops with null refs, `scores.js:84-87`).
- Why it matters: undo semantics a replacement grid must define (and the parity tests must pin down);
  two competing undo systems today.

### U2. Score grid: changes arriving while an earlier save is in flight are dropped (not saved)

- `scores.js:1360-1362`: `afterChange: async (changes) => { if (!changes || guard.processing) return; guard.processing = true; … await saveCell(…) …}`.
- Each change awaits an IPC CAS write (`Store.setScore` → `update`, `store.js:69-87`). While that is
  pending, the next `afterChange` (user types the next score and presses Enter quickly, a paste,
  numpad `.`→`N` via `setDataAtCell`, `scores.js:1468`) returns early.
- Effect (probable): Handsontable has already put the new value in `gridData` and the cell shows it,
  but it is never written to disk, never gets an undo entry, and row totals are not recomputed for it.
  On reopen the score is gone. Fast numpad entry is exactly the intended workflow.
- Why it matters: silent data loss; the replacement must queue, not drop, changes.

### U3. Score grid: save errors other than CAS conflicts are invisible

- `afterChange` is async and Handsontable does not await it; a rejection from `Store.update`
  (`'Bestand … is onleesbaar'`, `'Save failed for …'`, `store.js:73,80,84`) becomes an unhandled
  rejection. `app.js:964-973` only handles `reason.code === 'conflict'` and otherwise does nothing
  (no `preventDefault`, no toast).
- Effect: the cell shows the value as saved; the user is not told (OneDrive lock, disk full, broken
  JSON).

### U4. Score grid: pasting or auto-filling into observatie columns is not saved

- Observatie cells are editable (`cells`, `scores.js:1283-1286`) and HOT's CopyPaste/Autofill are on
  by default. `afterChange` skips every column outside the question range (`scores.js:1370`:
  `if (col < 2 || col >= 2 + N) continue;`).
- Effect (probable): pasted `TRUE`/`1`/text replaces the boolean in `gridData`, the checkbox renders
  unchecked (`value === true` fails, `scores.js:1228`), nothing is saved, and the next save of that
  student keeps the old observations. A paste range spanning questions and observaties saves only the
  question part.

### U5. Score grid: average Totaal truncates half points; Totaal uses a decimal point

- `recomputeRow` writes `${res.scored} / ${res.normalMax}` (`scores.js:583-586`) with the raw JS
  number: `12.5 / 20` (point, not comma; float artefacts possible with 0,1 steps, e.g. `3.3000000000000003`).
- `recomputeSummaryRow` parses it back with `parseInt(totaalStr, 10)` (`scores.js:606`) → `12`, so
  the "Gemiddelde" and "Standaarddeviatie" of Totaal ignore the decimals.
- Why it matters: wrong statistic shown to teachers; violates the decimal-comma convention; parity
  goldens must decide whether to keep it.

### U6. RTTI uitleg modal: teacher texts inserted into `<textarea>` without escaping

- `modals/rapport.js:446,455-457`: `<textarea …>${data.uitleg[cat]}</textarea>` and
  `${data.leeradvies[cat].laag|midden|hoog}`; the data comes from the shared JSON files
  `templates/RTTI explanations and advices/rtti_expl_adv_<vak>_<jaar>.json` (`rapport.js:403-405,
545`).
- Effect: a teacher who types `a &lt; b` gets `a < b` after save + reopen (entity decoded and saved
  back); `</textarea>` in the text breaks the form. Script execution is blocked by the CSP.
- Same modal: saves all tabs with plain `writeJson` (no CAS, no `_meta`) (`rapport.js:735-737`), so
  it silently overwrites a colleague's edits of the same files, and has no `Sync` subscription.

### U7. Login screen builds user badges from unescaped user data

- `screens/startup.js:26-35`: `data-foto="${user.foto}"`, `data-user-id="${user.id}"`,
  `style="--badge-color: ${user.kleur …}"`, `${initials}`, `${user.voornaam}`; `gebruikers.js:48`
  also puts `user.kleur` raw into `style`. Elsewhere (`gebruikers.js:49`) the same initials are
  escaped.
- Effect: a first name or abbreviation with `<`, `&` or `"` renders wrong or injects markup on the
  very first screen; inconsistent with the rest of the app.

### U8. Exam description unescaped in a `title` attribute

- `modals/groep-leerlingen.js:182`: `title="${(fromExam.description ?? '').trim()}"`.
- Effect: a resit description containing `"` cuts the attribute and the badge markup.

### U9. Typst editor: last edits can be lost on close

- Autosave runs 600 ms after the last keystroke (`editor-init.js:649-653`). Closing via the app title
  (`editor-init.js:275-277`) or the badge/logout (`:285-287`) makes the parent set `frame.src = ''`
  immediately (`modals/editor.js:40-49, 96-102`), discarding the pending `saveTimer` and any
  in-flight `postToParent` promise (the parent listener is removed, so `_pending` never resolves).
- Also: `.typ` saves use `writeTextFile` without CAS or Sync, so two teachers editing the same
  opdracht overwrite each other without notice.

### U10. Editor iframe proxy: untyped, path-based, and reachable by CDN code

- `modals/editor.js:61-95` forwards `rtti-read-text`/`rtti-write-text` with a caller-supplied
  `rest.path` (only the main process's data-dir check limits it), plus image, clipboard and render
  calls. The iframe runs CodeMirror loaded from `https://esm.sh/...@6` with major-only versions
  (`editor-init.js:14-39`), and its own response listener accepts messages from any sender
  (`editor-init.js:54-60`).
- Effect: a compromised or changed esm.sh build can read/write any file in the shared data folder via
  the proxy; builds are not reproducible (version drift). The main window similarly runs jsdelivr
  scripts with full `window.rtti` access and no SRI (`index.html:308-310`).
- Dead branch: `rtti-render-assignment` (`modals/editor.js:68-70`) is never sent by the editor.

### U11. Filter popover "Alles/Niets" listeners pile up on every login

- `buildSchoolsoortPopover` adds new click listeners to `#pop-ss-alles` / `#pop-ss-niets`
  (`app.js:623-636`) and `buildVakkenPopover` to `#pop-vak-alles` (`app.js:436-442`) each time a
  user logs in (`initFilterBar`, `app.js:882-910`); the jaarlaag popovers avoid this with the
  `cloneNode` trick (`app.js:678-699, 748-768`).
- Effect: after N logins one click runs N handlers (N `saveFilterState` writes, N re-renders).

### U12. CustomSelects created inside modals are never destroyed

- `new CustomSelect(...)` in `modals/herkansing.js:95`, `modals/leerling-edit.js:115`,
  `modals/toets-edit.js:207`, `utils/csv.js:78` each add `click` and `keydown` listeners on
  `document` (`custom-select.js:57-64`); `destroy()` (`custom-select.js:107-110`) is never called.
- Effect: listeners and detached DOM accumulate per modal open (small leak; each keydown/click runs
  all of them).

### U13. Legacy migration runs on every start, in every client, without coordination

- `Store.preload()` → `migrate()` (`store.js:318-319`) → `migrateLegacyToPerYear` /
  `migrateToPerSubject` (`store.js:828-991`), from the renderer, before login.
- Effect: normally a few cheap reads (`students.json`, `observaties.json`, `<year>/exams.json`); but
  if a legacy file reappears (OneDrive restore), several teachers' PCs would migrate the shared
  folder concurrently with plain writes. Dead weight for the port.

### U14. RTTI uitleg modal bypasses the shared close/guard mechanism

- Own `_dirty` flag and inline confirm bar, with capture-phase listeners on `#modal-overlay` and
  `#modal-close` (`rapport.js:575-628`) removed only in `cleanupAndClose`; not registered through
  `onModalCleanup`/`guardModalClose`. Its overlay check ignores the "press must start on the
  backdrop" rule (`app.js:151-158`) and, unlike `requestCloseModal`, does not check for an open
  `.app-dialog-backdrop`.
- Effect: inconsistent behaviour; if the modal is ever replaced by another `showModal`, the capture
  listeners stay and swallow the next modal's ✕ / backdrop clicks.

### U15. `showModal` over an open modal drops the previous `onClose`

- `showModal` overwrites `_onCloseModal` (`app.js:127`) without calling the previous one, while
  `closeModal` calls it (`app.js:139-141`). E.g. the score modal passes `deps.renderToetsenList` as
  `onClose` (`scores.js:298`).
- Effect: a modal replaced by another (not closed first) never runs its close callback (list not
  refreshed, presence/`setScoreModal(null)` relies on `onModalCleanup`, which is fine).

### U16. Student id type drift (number vs string)

- Lists bind `Number(b.dataset.id)` (`leerlingen.js:176-183`) and the profile looks up
  `s.id === studentId` (`profiel.js:54`); CSV import stores `Number(r['Leerlingnummer'])`
  (`leerling-edit.js:254`); the grid and sync compare `String(st.id) === String(studentId)`
  (`scores.js:794,843`) and presence stores `String(studentId)` (`presence.js:93`); CLAUDE.md calls
  ids "numeric strings".
- Why it matters: any id stored as a string breaks the strict-equality lookups; the port's typed
  model must pick one representation and normalise on read.

### U17. Smaller observations

- No Escape-to-close for modals and no `beforeunload` guard (`app.js` has none); unsaved guards only
  in the exam editor and the observatie modal (`toets-edit.js:218-219,734-735`,
  `observaties.js:382-383`); groep, leerling, gebruiker, opdracht and herkansing forms close without
  asking.
- `escHtml` does not escape `'` (`app.js:355-361`); safe today because no attribute uses single
  quotes.
- The F-key toggle accepts F1–F99 (`scores.js:1564`) but only F1–F12 exist/are advertised
  (`scores.js:905`).
- `afterSelection` re-renders the whole grid on every cell move (`scores.js:1337-1340`) for the
  cross-hair highlight; with several groups this is O(cells) per keystroke.
- `navigateTo` does not await the async screen render (`app.js:59`); a slow render of the previous
  screen can still finish after the user switched (each screen writes only its own container, so
  the effect is limited to wasted work).
- Logout (`app.js:946-953`) does not clear `Store`'s active user/subject or the filter state; the next
  login overwrites them.
- `toTypst` emits object keys unquoted (`main.js:570`), so any key that is not a valid Typst
  identifier (e.g. one starting with a digit or containing a space) would break the rapport compile; today the keys are fixed field names, so this is latent.
